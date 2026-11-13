// Polaris signal API. Watches Robinhood Chain for freshly minted tokens (the Drift), keeps chain
// pulse stats, the Beacon leaderboard and contract verification status, and serves them as JSON.
// Zero dependencies: node >= 22.
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, extname, resolve } from "node:path";
import { northScore, hourly } from "./score.mjs";

const NETS = {
  robinhoodTestnet: { rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com" },
  robinhood: { rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com" },
};
const NETWORK = process.env.NETWORK || "robinhoodTestnet";
const RPC = process.env.RPC_URL || NETS[NETWORK].rpc;
const EXPLORER = process.env.EXPLORER_URL || NETS[NETWORK].explorer;
const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const DATA = resolve(process.env.DATA_DIR || "data");
const STATIC = process.env.STATIC_DIR && resolve(process.env.STATIC_DIR);
const DEPLOY = resolve(process.env.DEPLOYMENTS || `../../packages/contracts/deployments/${NETWORK}.json`);
const WINDOW_MS = +(process.env.DRIFT_HOURS || 48) * 3600e3;
const SEED_BLOCKS = +(process.env.SEED_BLOCKS || 60_000);
const CHUNK = 2_000;
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const ZERO_TOPIC = "0x" + "0".repeat(64);

const deployments = existsSync(DEPLOY) ? JSON.parse(readFileSync(DEPLOY, "utf8")) : null;
// $POLARIS launches elsewhere: the testnet token stays off the site (contracts list and drift) until then
const hiddenToken = deployments?.contracts?.token?.proxy?.toLowerCase();
const listed = (addr) => addr?.toLowerCase() !== hiddenToken;
const STATE_FILE = join(DATA, `state-${NETWORK}.json`);
mkdirSync(DATA, { recursive: true });

const state = {
  head: 0, scanned: 0, beaconScanned: 0,
  tokens: {},   // address -> token in the drift window
  old: {},      // address -> true, born before the window; never re-enriched
  pulse: {},
  stars: {},    // beacon observer -> { xp, streak, best, pings, last }
  contracts: {},
  ...(existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {}),
};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state));

// ---------- upstream helpers ----------
let rpcId = 0;
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

// Blockscout is rate limited, so every explorer call goes through one paced queue.
let explorerChain = Promise.resolve();
function explorer(path) {
  const run = explorerChain.then(async () => {
    await new Promise((r) => setTimeout(r, 220));
    const r = await fetch(EXPLORER + "/api/v2" + path, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`explorer ${r.status} ${path}`);
    return r.json();
  });
  explorerChain = run.catch(() => {});
  return run;
}

const hex = (n) => "0x" + n.toString(16);

// ---------- the drift: mint scanner ----------
const pending = new Set();
const queue = [];

// One token at a time, newest first: each token is fully dated before the next starts,
// so the radar fills from the freshest blocks instead of waiting on the whole backlog.
async function enrichWorker() {
  for (;;) {
    const a = queue.pop();
    if (!a) { await new Promise((r) => setTimeout(r, 1000)); continue; }
    await enrich(a).catch((e) => { pending.delete(a); console.warn("enrich", a, e.message); });
  }
}

async function scanMints() {
  const head = Number(BigInt(await rpc("eth_blockNumber", [])));
  state.head = head;
  let from = state.scanned ? state.scanned + 1 : Math.max(1, head - SEED_BLOCKS);
  while (from <= head) {
    const to = Math.min(head, from + CHUNK - 1);
    const logs = await rpc("eth_getLogs", [{ fromBlock: hex(from), toBlock: hex(to), topics: [TRANSFER, ZERO_TOPIC] }]);
    for (const l of logs) {
      if (l.topics.length !== 3) continue; // ERC-721 mints carry the id as a 4th topic
      const a = l.address.toLowerCase();
      if (state.old[a]) continue;
      const t = state.tokens[a];
      if (t) { t.mints++; t.lastMint = Date.now(); }
      else if (!pending.has(a)) { pending.add(a); queue.push(a); }
    }
    state.scanned = to;
    from = to + 1;
  }
}

async function enrich(a) {
  const addr = await explorer(`/addresses/${a}`);
  const txHash = addr?.creation_transaction_hash || addr?.creation_tx_hash;
  if (!txHash) { state.old[a] = true; pending.delete(a); return; }
  const tx = await explorer(`/transactions/${txHash}`);
  const bornAt = Date.parse(tx?.timestamp);
  if (!bornAt || Date.now() - bornAt > WINDOW_MS) { state.old[a] = true; pending.delete(a); return; }
  const tok = await explorer(`/tokens/${a}`);
  if (!tok || tok.type !== "ERC-20" || !tok.symbol) { state.old[a] = true; pending.delete(a); return; }
  state.tokens[a] = {
    address: addr.hash || a, name: tok.name || tok.symbol, symbol: tok.symbol, decimals: +tok.decimals || 18,
    holders: +tok.holders_count || 0, supply: tok.total_supply, bornAt, bornBlock: +tx.block_number || +tx.block,
    creator: addr.creator_address_hash, verified: !!addr.is_verified, mints: 1, lastMint: Date.now(),
  };
  pending.delete(a);
}

async function refreshHolders() {
  const now = Date.now();
  for (const [a, t] of Object.entries(state.tokens)) {
    if (now - t.bornAt > WINDOW_MS) { delete state.tokens[a]; state.old[a] = true; continue; }
    const c = await explorer(`/tokens/${a}/counters`).catch(() => null);
    if (c) { t.holders = +c.token_holders_count || t.holders; t.transfers = +c.transfers_count || t.transfers; }
  }
}

// ---------- pulse ----------
async function refreshStats() {
  const s = await explorer("/stats");
  if (!s) return;
  Object.assign(state.pulse, {
    txToday: +s.transactions_today || state.pulse.txToday,
    addresses: +s.total_addresses || state.pulse.addresses,
    blockTime: s.average_block_time ? +s.average_block_time / 1000 : state.pulse.blockTime,
    gasGwei: s.gas_prices?.average ?? state.pulse.gasGwei,
  });
  const chart = await explorer("/stats/charts/transactions").catch(() => null);
  if (chart?.chart_data) state.pulse.txHistory = chart.chart_data.slice(0, 30).reverse().map((p) => [p.date, +p.transactions_count]);
}

// ---------- beacon leaderboard ----------
async function scanBeacon() {
  const c = deployments?.contracts?.beacon;
  const topic = deployments?.selectors?.PolarisBeacon?.["event:Pinged"];
  if (!c || !topic) return;
  let from = state.beaconScanned ? state.beaconScanned + 1 : deployments.startBlock;
  const head = state.head;
  while (from <= head) {
    const to = Math.min(head, from + 50_000 - 1);
    const logs = await rpc("eth_getLogs", [{ address: c.proxy, fromBlock: hex(from), toBlock: hex(to), topics: [topic] }]);
    for (const l of logs) {
      const who = "0x" + l.topics[1].slice(26);
      const d = l.data.slice(2);
      const streak = parseInt(d.slice(0, 64), 16), xp = parseInt(d.slice(64, 128), 16);
      const s = (state.stars[who] ||= { pings: 0, best: 0 });
      s.pings++; s.streak = streak; s.xp = xp; s.best = Math.max(s.best, streak);
      s.lastDay = parseInt(l.topics[2], 16);
    }
    state.beaconScanned = to;
    from = to + 1;
  }
}

// ---------- contract registry (verification status) ----------
async function refreshContracts() {
  for (const [key, c] of Object.entries(deployments?.contracts || {})) {
    const [p, i] = await Promise.all([explorer(`/addresses/${c.proxy}`), explorer(`/addresses/${c.implementation}`)]);
    state.contracts[key] = { key, name: c.name, proxy: c.proxy, implementation: c.implementation, verified: !!(p?.is_verified && i?.is_verified) };
  }
}

// ---------- views ----------
function drift(limit = 40) {
  const now = Date.now();
  const list = Object.values(state.tokens)
    .filter((t) => listed(t.address))
    .map((t) => ({ ...t, ...northScore(t, now, WINDOW_MS), ageMin: Math.max(1, Math.round((now - t.bornAt) / 60e3)) }))
    .sort((a, b) => b.score - a.score);
  return {
    window: WINDOW_MS / 3600e3,
    born24h: list.filter((t) => now - t.bornAt < 24 * 3600e3).length,
    born1h: list.filter((t) => now - t.bornAt < 3600e3).length,
    tracked: list.length,
    hourly: hourly(list.map((t) => t.bornAt), now),
    tokens: list.slice(0, limit),
  };
}

function leaderboard() {
  const rows = Object.entries(state.stars).map(([address, s]) => ({ address, ...s })).sort((a, b) => b.xp - a.xp);
  return { observers: rows.length, pings: rows.reduce((n, r) => n + r.pings, 0), top: rows.slice(0, 25) };
}

const routes = {
  "/api/health": () => ({ ok: true, network: NETWORK, head: state.head, scanned: state.scanned, tracked: Object.keys(state.tokens).length }),
  "/api/pulse": () => ({ network: NETWORK, block: state.head, ...state.pulse, drift: { born24h: drift().born24h, born1h: drift().born1h } }),
  "/api/drift": (q) => drift(Math.min(100, +q.get("limit") || 40)),
  "/api/beacon": () => leaderboard(),
  "/api/contracts": () => ({ network: NETWORK, explorer: EXPLORER, contracts: Object.values(state.contracts).filter((c) => listed(c.proxy)) }), // filtered on read: older state files still hold the token
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const route = routes[url.pathname];
  if (route) {
    try {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=5" });
      res.end(JSON.stringify(route(url.searchParams)));
    } catch (e) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }
  // Static site (Traefik in front handles TLS, compression and security headers).
  if (STATIC && (req.method === "GET" || req.method === "HEAD")) {
    let p = join(STATIC, decodeURIComponent(url.pathname));
    if (!p.startsWith(STATIC)) return res.writeHead(403).end();
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, "index.html");
    if (!existsSync(p) && existsSync(p + ".html")) p += ".html";
    const found = existsSync(p);
    if (!found) p = join(STATIC, "index.html");
    const ext = extname(p);
    const cache = ext === ".html" ? "no-cache" : p.includes("/assets/") ? "public, max-age=604800" : "public, max-age=300, must-revalidate";
    res.writeHead(found ? 200 : 404, { "content-type": MIME[ext] || "application/octet-stream", "cache-control": cache });
    return req.method === "HEAD" ? res.end() : createReadStream(p).pipe(res);
  }
  res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not found"}');
}).listen(PORT, HOST, () => console.log(`polaris ${HOST}:${PORT} ${NETWORK}`));

// ---------- loops ----------
function every(ms, fn, name) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try { await fn(); } catch (e) { console.warn(name, e.message); } finally { busy = false; }
  };
  tick();
  setInterval(tick, ms);
}
enrichWorker();
every(12_000, scanMints, "mints");
every(15_000, scanBeacon, "beacon");
every(150_000, refreshHolders, "holders");
every(300_000, refreshStats, "stats");
every(600_000, refreshContracts, "contracts");
setInterval(save, 60_000);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { save(); process.exit(0); });
