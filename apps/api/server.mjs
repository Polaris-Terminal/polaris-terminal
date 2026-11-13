// Polaris signal API. Watches Robinhood Chain for freshly minted tokens (the Drift), keeps chain
// pulse stats, the Beacon leaderboard and contract verification status, and serves them as JSON.
// Zero dependencies: node >= 22.
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, createReadStream } from "node:fs";
import { join, extname, resolve } from "node:path";
import { northScore, hourly } from "./score.mjs";
import { abiString, transferStats } from "./abi.mjs";
import { replay, grade, trackRecord, stockClaim } from "./signals.mjs";

const NETS = {
  robinhoodTestnet: { rpc: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com" },
  // The mainnet explorer's API sits behind a bot wall, so mainnet reads the drift straight from the chain,
  // checks source verification on Sourcify and only uses the (keyed, metered) Blockscout API for pulse stats if a key is set.
  robinhood: { rpc: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", api: "https://api.blockscout.com/4663/api/v2", sourcify: 4663 },
};
const NETWORK = process.env.NETWORK || "robinhoodTestnet";
const RPC = process.env.RPC_URL || NETS[NETWORK].rpc;
const EXPLORER = process.env.EXPLORER_URL || NETS[NETWORK].explorer;
const EXPLORER_API = process.env.EXPLORER_API || NETS[NETWORK].api || EXPLORER + "/api/v2";
const EXPLORER_KEY = process.env.EXPLORER_API_KEY;
const SOURCIFY = NETS[NETWORK].sourcify; // also marks a chain-read network
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
// pool births on any Uniswap-style venue: v2 PairCreated, v3 PoolCreated, v4 PoolManager.Initialize
const POOL_TOPICS = {
  "0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9": "v2",
  "0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118": "v3",
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438": "v4",
};
const POOL_CHUNK = +(process.env.POOL_CHUNK || 30_000); // the Robinhood RPC caps topic-only log ranges at 30k blocks
const VENUES = { UniswapV2Factory: "Uniswap v2", UniswapV3Factory: "Uniswap v3", PoolManager: "Uniswap v4" };
// Robinhood publishes no testnet registry; these five were read on-chain (name, symbol, 18 decimals) on 2026-11-14.
const TESTNET_STOCKS = {
  "0xc9f9c86933092bbbfff3ccb4b105a4a94bf3bd4e": "TSLA", "0x5884ad2f920c162cfbbacc88c9c51aa75ec09e02": "AMZN",
  "0x1fbe1a0e43594b3455993b5de5fd0a7a266298d0": "PLTR", "0x3b8262a63d25f0477c4dde23f83cfe22cb768c93": "NFLX",
  "0x71178bac73cbeb415514eb542a8995b82669778d": "AMD",
};
const STOCK_REGISTRY = "https://api.robinhood.com/rhj/assets";
// Holder tier: wallets holding HOLDER_MIN $POLARIS get faster alerts and the full score history.
const HOLDER_MIN = +(process.env.HOLDER_MIN || 10_000);

const deployments = existsSync(DEPLOY) ? JSON.parse(readFileSync(DEPLOY, "utf8")) : null;
// $POLARIS launches elsewhere: the testnet token stays off the site (contracts list and drift) until then
const hiddenToken = deployments?.contracts?.token?.proxy?.toLowerCase();
const listed = (addr) => addr?.toLowerCase() !== hiddenToken;
// the tier only reads a balance, so the testnet token can gate it without ever being shown
const HOLDER_TOKEN = (process.env.HOLDER_TOKEN || hiddenToken || "").toLowerCase();
const STATE_FILE = join(DATA, `state-${NETWORK}.json`);
mkdirSync(DATA, { recursive: true });

const state = {
  head: 0, scanned: 0, beaconScanned: 0,
  tokens: {},   // address -> token in the drift window
  old: {},      // address -> true, born before the window; never re-enriched
  pulse: {},
  stars: {},    // beacon observer -> { xp, streak, best, pings, last }
  contracts: {},
  poolScanned: 0,
  pools: {},    // pool (v4: manager:id) -> { pool, factory, kind, token0, token1, block }
  graded: {},   // address -> track record entry, kept 30 days after the token leaves the window
  labels: {},   // contract -> verified contract name, or null
  stocks: null, // { official: { address: ticker }, tickers: { TICKER: { name, address } }, at }
  ...(existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : {}),
};
const save = () => writeFileSync(STATE_FILE, JSON.stringify(state));
// every address is keyed lowercase; state files from v1.0 kept the explorer's checksummed spelling
for (const [a, t] of Object.entries(state.tokens)) { t.address = a; t.creator = t.creator?.toLowerCase(); }

// ---------- upstream helpers ----------
let rpcId = 0;
async function rpc(method, params, tries = 3) {
  const r = await fetch(RPC, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  const j = await r.json();
  if (j.error && tries > 1 && /too many/i.test(j.error.message)) return sleep(1500).then(() => rpc(method, params, tries - 1));
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Blockscout is rate limited, so every explorer call goes through one paced queue.
let explorerChain = Promise.resolve();
function explorer(path) {
  const run = explorerChain.then(async () => {
    await new Promise((r) => setTimeout(r, 220));
    const headers = { accept: "application/json", ...(EXPLORER_KEY && { authorization: `Bearer ${EXPLORER_KEY}` }) };
    const r = await fetch(EXPLORER_API + path, { signal: AbortSignal.timeout(15_000), headers });
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
    if (SOURCIFY && !state.pulse.blockTime) { await sleep(1000); continue; } // chain reads size the window from the block time
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

const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const sourcified = (a) => fetch(`https://sourcify.dev/server/v2/contract/${SOURCIFY}/${a}`, { signal: AbortSignal.timeout(15_000) })
  .then((r) => (r.ok ? r.json() : null)).then((j) => !!j?.match);

async function enrich(a) {
  if (SOURCIFY) return enrichFromChain(a);
  const addr = await explorer(`/addresses/${a}`);
  const txHash = addr?.creation_transaction_hash || addr?.creation_tx_hash;
  if (!txHash) { state.old[a] = true; pending.delete(a); return; }
  const tx = await explorer(`/transactions/${txHash}`);
  const bornAt = Date.parse(tx?.timestamp);
  if (!bornAt || Date.now() - bornAt > WINDOW_MS) { state.old[a] = true; pending.delete(a); return; }
  const tok = await explorer(`/tokens/${a}`);
  if (!tok || tok.type !== "ERC-20" || !tok.symbol) { state.old[a] = true; pending.delete(a); return; }
  state.tokens[a] = {
    address: a, name: tok.name || tok.symbol, symbol: tok.symbol, decimals: +tok.decimals || 18,
    holders: +tok.holders_count || 0, supply: tok.total_supply, bornAt, bornBlock: +tx.block_number || +tx.block,
    creator: addr.creator_address_hash?.toLowerCase(), launchpad: tx.to?.hash?.toLowerCase() || null,
    verified: !!addr.is_verified, mints: 1, lastMint: Date.now(),
  };
  pending.delete(a);
}

// A token's Transfer logs since `fromBlock`; null once it passes the RPC's 10k log cap.
const transfers = (a, fromBlock) => rpc("eth_getLogs", [{ address: a, fromBlock: hex(fromBlock), toBlock: "latest", topics: [TRANSFER] }])
  .catch((e) => { if (/exceeds limit/.test(e.message)) return null; throw e; });

// Chain-read networks: a token is newborn when all of its supply was minted inside the window, and that same
// history gives exact holders. shortcut: tokens past 10k transfers in the window count as old; page the logs if hot launches go missing.
async function enrichFromChain(a) {
  const old = () => { state.old[a] = true; pending.delete(a); };
  const logs = await transfers(a, Math.max(1, state.head - Math.round(WINDOW_MS / 1000 / state.pulse.blockTime)));
  const supply = logs && await call(a, "0x18160ddd").catch(() => "0x");
  const h = logs && transferStats(logs);
  if (!h?.mints || supply.length < 66 || h.minted !== BigInt(supply)) return old();
  const [name, symbol, decimals] = await Promise.all(["0x06fdde03", "0x95d89b41", "0x313ce567"].map((d) => call(a, d).catch(() => "0x")));
  const sym = symbol.length > 2 && abiString(symbol).trim();
  if (!sym || decimals.length < 66) return old(); // not an ERC-20
  const first = logs.find((l) => l.topics[1] === ZERO_TOPIC);
  const [block, tx, verified] = await Promise.all([
    rpc("eth_getBlockByNumber", [first.blockNumber, false]), rpc("eth_getTransactionByHash", [first.transactionHash]), sourcified(a).catch(() => false),
  ]);
  state.tokens[a] = {
    address: a, name: abiString(name).trim() || sym, symbol: sym, decimals: Number(BigInt(decimals)) || 18,
    holders: h.holders, transfers: h.transfers, supply: BigInt(supply).toString(), bornAt: Number(block.timestamp) * 1000,
    bornBlock: Number(first.blockNumber), creator: tx?.from?.toLowerCase(), launchpad: tx?.to?.toLowerCase() || null,
    verified, mints: h.mints, lastMint: Date.now(),
  };
  pending.delete(a);
}

// Tokens enriched before v2.0 lack their origin: the creation transaction's sender and target (launchpad).
async function backfillOrigin() {
  await Promise.all(Object.values(state.tokens).filter((x) => x.launchpad === undefined).slice(0, 4).map(async (t) => {
    const logs = await rpc("eth_getLogs", [{ address: t.address, fromBlock: hex(t.bornBlock), toBlock: hex(t.bornBlock) }]).catch(() => null);
    if (!logs) return; // RPC hiccup: try again next tick
    const tx = logs[0] && await rpc("eth_getTransactionByHash", [logs[0].transactionHash]).catch(() => null);
    t.launchpad = tx?.to?.toLowerCase() || null;
    if (tx?.from) t.creator = tx.from.toLowerCase();
  }));
}

// ---------- venues: every Uniswap-style pool born in the window ----------
const word = (data, i) => "0x" + data.slice(2 + i * 64 + 24, 2 + (i + 1) * 64);
const windowBlocks = () => Math.round(WINDOW_MS / 1000 / state.pulse.blockTime);
async function scanPools() {
  if (!state.pulse.blockTime || !state.head) return;
  const head = state.head;
  let from = Math.max(state.poolScanned + 1, head - windowBlocks());
  while (from <= head) {
    const to = Math.min(head, from + POOL_CHUNK - 1);
    const logs = await rpc("eth_getLogs", [{ fromBlock: hex(from), toBlock: hex(to), topics: [Object.keys(POOL_TOPICS)] }]);
    for (const l of logs) {
      const kind = POOL_TOPICS[l.topics[0]], f = l.address.toLowerCase();
      const [t0, t1] = kind === "v4" ? [l.topics[2], l.topics[3]] : [l.topics[1], l.topics[2]];
      if (!t0 || !t1) continue;
      const pool = kind === "v2" ? word(l.data, 0) : kind === "v3" ? word(l.data, 1) : f; // v4 pools all live in the PoolManager
      state.pools[kind === "v4" ? `${f}:${l.topics[1]}` : pool] = { pool, factory: f, kind, token0: "0x" + t0.slice(26), token1: "0x" + t1.slice(26), block: Number(l.blockNumber) };
    }
    state.poolScanned = to;
    from = to + 1;
  }
  const oldest = head - windowBlocks();
  for (const [k, p] of Object.entries(state.pools)) if (p.block < oldest) delete state.pools[k];
}
const poolsOf = (a) => Object.values(state.pools).filter((p) => p.token0 === a || p.token1 === a);
const blockAt = (b) => Date.now() - (state.head - b) * state.pulse.blockTime * 1000;

// Verified contract names label launchpads and venues; unverified ones show their address.
async function refreshLabels() {
  const want = new Set([...Object.values(state.tokens).map((t) => t.launchpad), ...Object.values(state.pools).map((p) => p.factory)]);
  for (const a of want) {
    if (!a || a in state.labels) continue;
    if (SOURCIFY) {
      const j = await fetch(`https://sourcify.dev/server/v2/contract/${SOURCIFY}/${a}?fields=compilation`, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => undefined);
      if (j === undefined) return;
      state.labels[a] = j?.compilation?.name || null;
    } else {
      const j = await explorer(`/addresses/${a}`).catch(() => undefined);
      if (j === undefined) return;
      state.labels[a] = j?.name || null;
    }
    return; // one lookup per tick keeps both upstreams calm
  }
}
const label = (a) => (a ? VENUES[state.labels[a]] || state.labels[a] || null : null);

// ---------- stock tokens: Robinhood's canonical registry ----------
async function refreshStocks() {
  const j = await fetch(STOCK_REGISTRY, { signal: AbortSignal.timeout(20_000), headers: { accept: "application/json" } }).then((r) => (r.ok ? r.json() : null));
  if (!j?.assets?.length) return;
  const official = {}, tickers = {};
  for (const s of j.assets) {
    const d = s.deployments?.find((x) => x.chainId === 4663);
    // off mainnet the registry only names the tickers; its addresses are not canonical there
    tickers[s.tokenSymbol.toUpperCase()] = { name: s.tokenName, address: (NETWORK === "robinhood" && d?.contractAddress?.toLowerCase()) || null };
    if (d && NETWORK === "robinhood") official[d.contractAddress.toLowerCase()] = s.tokenSymbol.toUpperCase();
  }
  if (NETWORK !== "robinhood") for (const [a, sym] of Object.entries(TESTNET_STOCKS)) { official[a] = sym; tickers[sym] = { ...tickers[sym], address: a }; }
  state.stocks = { official, tickers, at: Date.now() };
}
let stockMaps = null, stockMapsAt = 0;
function stocks() {
  if (!state.stocks) return { official: new Map(Object.entries(TESTNET_STOCKS)), tickers: new Map() };
  if (stockMapsAt !== state.stocks.at) {
    stockMaps = { official: new Map(Object.entries(state.stocks.official)), tickers: new Map(Object.entries(state.stocks.tickers)) };
    stockMapsAt = state.stocks.at;
  }
  return stockMaps;
}

// ---------- deep read: replay a token's whole transfer history (cached, one at a time) ----------
const deepCache = new Map();
// two lanes, so visitors never queue behind the background refresh and grader
const lanes = { fg: Promise.resolve(), bg: Promise.resolve() };
function deep(a, ttl = 90_000, lane = "fg") {
  const fresh = () => { const c = deepCache.get(a); return c && Date.now() - c.at < ttl ? c.r : null; };
  if (!state.tokens[a]) return Promise.resolve(null);
  if (fresh()) return Promise.resolve(fresh());
  const run = lanes[lane].then(async () => {
    const t = state.tokens[a];
    if (!t) return null;
    if (fresh()) return fresh();
    const logs = await transfers(a, t.bornBlock);
    const r = logs
      ? replay(logs, { bornAt: t.bornAt, bornBlock: t.bornBlock, head: state.head, now: Date.now(), creator: t.creator, pools: new Set(poolsOf(a).map((p) => p.pool)), verified: t.verified, windowMs: WINDOW_MS })
      : { capped: true };
    deepCache.set(a, { at: Date.now(), r });
    return r;
  });
  lanes[lane] = run.catch(() => {});
  return run;
}
function pruneDeep() { for (const [a, c] of deepCache) if (Date.now() - c.at > 600_000) deepCache.delete(a); }

// ---------- track record: grade every token a day after birth, oldest first ----------
async function gradeNext() {
  const now = Date.now();
  const t = Object.values(state.tokens).filter((x) => !state.graded[x.address] && now - x.bornAt > 24.5 * 3600e3 && listed(x.address)).sort((a, b) => a.bornAt - b.bornAt)[0];
  if (t) {
    const r = await deep(t.address, 3600e3, "bg");
    const g = r && !r.capped && grade(r);
    state.graded[t.address] = g
      ? { address: t.address, symbol: t.symbol, name: t.name, creator: t.creator, launchpad: t.launchpad, bornAt: t.bornAt, ...g }
      : { address: t.address, bornAt: t.bornAt, skip: true };
  }
  for (const [a, g] of Object.entries(state.graded)) if (now - g.bornAt > 30 * 864e5) delete state.graded[a];
}

// ---------- holder tier ----------
const tierCache = new Map();
async function tierOf(who) {
  if (!who || !HOLDER_TOKEN) return "public";
  const c = tierCache.get(who);
  if (c && Date.now() - c.at < 300_000) return c.tier;
  const [bal, dec] = await Promise.all([call(HOLDER_TOKEN, "0x70a08231" + who.slice(2).padStart(64, "0")), call(HOLDER_TOKEN, "0x313ce567")]).catch(() => ["0x", "0x"]);
  const tier = bal.length >= 66 && BigInt(bal) >= BigInt(HOLDER_MIN) * 10n ** BigInt(dec.length >= 66 ? dec : 18) ? "holder" : "public";
  tierCache.set(who, { at: Date.now(), tier });
  return tier;
}
const TIERS = { public: { watch: 5, historyH: 6, ttl: 60_000, poll: 60 }, holder: { watch: 25, historyH: 48, ttl: 15_000, poll: 15 } };

async function refreshHolders() {
  const now = Date.now();
  for (const [a, t] of Object.entries(state.tokens)) {
    if (now - t.bornAt > WINDOW_MS) { delete state.tokens[a]; state.old[a] = true; continue; }
    if (SOURCIFY) continue;
    const c = await explorer(`/tokens/${a}/counters`).catch(() => null);
    if (c) { t.holders = +c.token_holders_count || t.holders; t.transfers = +c.transfers_count || t.transfers; }
  }
  // replay the full history of the tokens on the radar: Orbit signals everywhere, exact holders on chain-read networks
  for (const { address } of drift(40).tokens) {
    const r = await deep(address, 60_000, "bg").catch(() => null), t = state.tokens[address];
    if (SOURCIFY && t && r && !r.capped) Object.assign(t, { holders: r.holders, transfers: r.transfers });
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

// Chain-read pulse: block time and gas from the RPC; transactions per day estimated from randomly sampled blocks.
async function chainPulse() {
  const head = Number(await rpc("eth_blockNumber", []));
  const [now, back] = await Promise.all([head, head - 100_000].map((n) => rpc("eth_getBlockByNumber", [hex(n), false])));
  const blockTime = (Number(now.timestamp) - Number(back.timestamp)) / 100_000, perDay = 86_400 / blockTime;
  const samples = (state.txSamples ||= []);
  for (let i = 0; i < 24; i++) {
    const b = await rpc("eth_getBlockByNumber", [hex(head - Math.floor(Math.random() * perDay)), false]);
    samples.push(b.transactions.length - 1); // every Arbitrum block opens with one internal ArbOS tx
  }
  samples.splice(0, samples.length - 600);
  const gwei = Number(BigInt(await rpc("eth_gasPrice", []))) / 1e9;
  Object.assign(state.pulse, {
    blockTime, gasGwei: +gwei.toPrecision(3), txEstimated: true,
    txToday: Math.round((samples.reduce((s, x) => s + x, 0) / samples.length) * perDay),
  });
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
const isVerified = (a) => (SOURCIFY ? sourcified(a) : explorer(`/addresses/${a}`).then((p) => !!p?.is_verified));
async function refreshContracts() {
  for (const [key, c] of Object.entries(deployments?.contracts || {})) {
    const [p, i] = await Promise.all([isVerified(c.proxy), isVerified(c.implementation)]);
    state.contracts[key] = { key, name: c.name, proxy: c.proxy, implementation: c.implementation, verified: p && i };
  }
}

// ---------- views ----------
const scored = (t, now = Date.now()) => {
  const claim = stockClaim(t, stocks());
  return { ...t, ...northScore(t, now, WINDOW_MS), ageMin: Math.max(1, Math.round((now - t.bornAt) / 60e3)), launchpadLabel: label(t.launchpad), ...(claim && { stock: claim }) };
};

function drift(limit = 40, pad = null) {
  const now = Date.now();
  const all = Object.values(state.tokens).filter((t) => listed(t.address)).map((t) => scored(t, now)).sort((a, b) => b.score - a.score);
  const list = pad ? all.filter((t) => (pad === "direct" ? !t.launchpad : t.launchpad === pad)) : all;
  return {
    window: WINDOW_MS / 3600e3,
    born24h: list.filter((t) => now - t.bornAt < 24 * 3600e3).length,
    born1h: list.filter((t) => now - t.bornAt < 3600e3).length,
    tracked: list.length,
    hourly: hourly(list.map((t) => t.bornAt), now),
    tokens: list.slice(0, limit),
  };
}

const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
const address = (v) => { if (!/^0x[0-9a-fA-F]{40}$/.test(v || "")) throw bad("expected a 0x address"); return v.toLowerCase(); };
const venueOf = (p) => ({ pool: p.pool, kind: p.kind, venue: label(p.factory), factory: p.factory, openedAt: blockAt(p.block) });

// One token, everything Orbit knows about it. The history window depends on the caller's tier.
async function tokenView(q) {
  const a = address(q.get("a")), tier = await tierOf(q.get("holder") && address(q.get("holder")));
  const t = state.tokens[a];
  if (!t || !listed(a)) return { address: a, tracked: false, graded: state.graded[a]?.skip ? null : state.graded[a] || null };
  const r = await deep(a, TIERS[tier].ttl);
  const s = scored(t), since = Date.now() - TIERS[tier].historyH * 3600e3;
  return {
    tracked: true, tier, token: s, capped: !!r?.capped,
    history: r?.series ? [...r.series.filter((p) => p.t >= since && p.t < Date.now() - 60e3), { t: Date.now(), score: s.score, holders: s.holders }] : [],
    historyHours: TIERS[tier].historyH,
    events: r?.events || [], cluster: r?.cluster || null, creator: r?.creator || null,
    pools: poolsOf(a).map(venueOf), graded: state.graded[a]?.skip ? null : state.graded[a] || null,
  };
}

// Watchlist alerts: new events on the tokens a visitor watches. Holders get more slots and fresher reads.
async function alerts(q) {
  const tier = await tierOf(q.get("holder") && address(q.get("holder")));
  const list = [...new Set(String(q.get("a") || "").split(",").filter(Boolean).map(address))].slice(0, TIERS[tier].watch);
  const out = [];
  for (const a of list) {
    const t = state.tokens[a];
    if (!t || !listed(a)) { out.push({ address: a, tracked: false }); continue; }
    const r = await deep(a, TIERS[tier].ttl).catch(() => null), s = scored(t);
    out.push({ address: a, tracked: true, symbol: s.symbol, name: s.name, score: s.score, holders: s.holders, events: r?.events || [], cluster: r?.cluster?.level || null });
  }
  return { tier, ...TIERS[tier], tokens: out };
}

// Deployer profile: every launch this wallet made that Polaris saw, and how it treated them.
async function deployerView(q) {
  const a = address(q.get("a")), now = Date.now();
  const live = Object.values(state.tokens).filter((t) => t.creator === a && listed(t.address)).map((t) => scored(t, now)).sort((x, y) => y.bornAt - x.bornAt);
  const past = Object.values(state.graded).filter((g) => g.creator === a && !g.skip && !state.tokens[g.address]);
  const [nonce, eth] = await Promise.all([rpc("eth_getTransactionCount", [a, "latest"]), rpc("eth_getBalance", [a, "latest"])]).catch(() => ["0x0", "0x0"]);
  const launches = [];
  for (const t of live.slice(0, 12)) {
    const r = launches.length < 6 ? await deep(t.address).catch(() => null) : null;
    launches.push({ address: t.address, symbol: t.symbol, name: t.name, score: t.score, holders: t.holders, ageMin: t.ageMin, launchpadLabel: t.launchpadLabel,
      soldPct: r?.creator?.soldPct ?? null, cluster: r?.cluster?.level ?? null, outcome: state.graded[t.address]?.outcome || null });
  }
  const graded = [...past, ...live.map((t) => state.graded[t.address]).filter((g) => g && !g.skip)];
  const sold = launches.filter((l) => l.soldPct >= 5).length + past.filter((g) => g.sold24h >= 5).length;
  const tags = [
    live.length >= 5 && "serial launcher",
    sold && `sold into ${sold} of its own pool${sold > 1 ? "s" : ""}`,
    graded.some((g) => g.outcome === "rugged") && "has a rugged launch",
    graded.some((g) => g.outcome === "thrived") && "has a launch that thrived",
    live.length + past.length === 1 && "first launch Polaris has seen",
  ].filter(Boolean);
  return {
    address: a, nonce: Number(BigInt(nonce)), eth: Number(BigInt(eth)) / 1e18,
    launches48h: live.length, launchesSeen: live.length + past.length,
    avgScore: live.length ? Math.round(live.reduce((s, t) => s + t.score, 0) / live.length) : null,
    outcomes: Object.fromEntries(["thrived", "faded", "rugged"].map((o) => [o, graded.filter((g) => g.outcome === o).length])),
    tags, launches, past: past.slice(-20).reverse(),
  };
}

// Launchpad coverage: where the Drift is born (creation target) and where it trades (pool factory).
function launchpads() {
  const now = Date.now(), pads = {}, venues = {};
  for (const t of Object.values(state.tokens)) {
    if (!listed(t.address)) continue;
    const k = t.launchpad || "direct", s = scored(t, now), p = (pads[k] ||= { address: t.launchpad || null, label: t.launchpad ? label(t.launchpad) : "Direct deploy", tokens: 0, born24h: 0, scoreSum: 0, top: null });
    p.tokens++; p.scoreSum += s.score;
    if (now - t.bornAt < 864e5) p.born24h++;
    if (!p.top || s.score > p.top.score) p.top = { symbol: s.symbol, score: s.score, address: s.address };
  }
  for (const p of Object.values(state.pools)) {
    const v = (venues[p.factory] ||= { factory: p.factory, label: label(p.factory), kind: p.kind, pools: 0, pools24h: 0, drift: 0 });
    v.pools++;
    if (now - blockAt(p.block) < 864e5) v.pools24h++;
    if (state.tokens[p.token0] || state.tokens[p.token1]) v.drift++;
  }
  const list = Object.values(pads).map(({ scoreSum, ...p }) => ({ ...p, avgScore: Math.round(scoreSum / p.tokens) })).sort((a, b) => b.tokens - a.tokens);
  return { window: WINDOW_MS / 3600e3, launchpads: list, venues: Object.values(venues).sort((a, b) => b.pools - a.pools), pools: Object.keys(state.pools).length };
}

// Stock-pair integrity: pools that pair a stock ticker, and whether that side is Robinhood's canonical contract.
// symbols of pool sides born before the window (WETH, stables, stock tokens), read in the background
const symbols = {};
const symbolOf = (a) => state.tokens[a]?.symbol ?? stocks().official.get(a) ?? symbols[a];
async function resolveSymbols() {
  const todo = [...new Set(Object.values(state.pools).flatMap((p) => [p.token0, p.token1]))].filter((a) => symbolOf(a) === undefined).slice(0, 10);
  for (const a of todo) symbols[a] = await call(a, "0x95d89b41").then((h) => (h.length > 2 ? abiString(h).trim() || null : null)).catch(() => null);
}
function integrity() {
  const st = stocks(), pairs = [];
  for (const p of Object.values(state.pools).sort((a, b) => b.block - a.block)) {
    const sides = [p.token0, p.token1].map((a) => {
      const sym = symbolOf(a);
      return { address: a, symbol: sym ?? null, claim: sym ? stockClaim({ address: a, symbol: sym, name: state.tokens[a]?.name }, st) : st.official.has(a) ? { ticker: st.official.get(a), official: true } : null };
    });
    if (sides.some((s) => s.claim)) pairs.push({ ...venueOf(p), sides, verdict: sides.some((s) => s.claim && !s.claim.official) ? "imitation" : "official" });
    if (pairs.length >= 60) break;
  }
  const imitations = Object.values(state.tokens).filter((t) => listed(t.address)).map((t) => scored(t)).filter((t) => t.stock && !t.stock.official).sort((a, b) => b.bornAt - a.bornAt).slice(0, 40);
  return { official: st.official.size, registry: state.stocks?.at || null, pairs, imitations };
}

function record() {
  const g = Object.values(state.graded).filter((x) => !x.skip);
  return { ...trackRecord(g), horizonH: 24, earlyAtH: 1, recent: g.sort((a, b) => b.bornAt - a.bornAt).slice(0, 30), pending: Object.values(state.tokens).filter((t) => !state.graded[t.address] && Date.now() - t.bornAt > 24.5 * 3600e3).length };
}

function leaderboard() {
  const rows = Object.entries(state.stars).map(([address, s]) => ({ address, ...s })).sort((a, b) => b.xp - a.xp);
  return { observers: rows.length, pings: rows.reduce((n, r) => n + r.pings, 0), top: rows.slice(0, 25) };
}

const routes = {
  "/api/health": () => ({ ok: true, network: NETWORK, head: state.head, scanned: state.scanned, tracked: Object.keys(state.tokens).length, pools: Object.keys(state.pools).length, poolScanned: state.poolScanned, graded: Object.keys(state.graded).length }),
  "/api/pulse": () => ({ network: NETWORK, block: state.head, ...state.pulse, drift: { born24h: drift().born24h, born1h: drift().born1h } }),
  "/api/drift": (q) => drift(Math.min(100, +q.get("limit") || 40), q.get("launchpad") === "direct" ? "direct" : q.get("launchpad") ? address(q.get("launchpad")) : null),
  "/api/token": tokenView,
  "/api/alerts": alerts,
  "/api/deployer": deployerView,
  "/api/launchpads": launchpads,
  "/api/integrity": integrity,
  "/api/record": record,
  "/api/tier": async (q) => { const tier = await tierOf(address(q.get("a"))); return { tier, min: HOLDER_MIN, ...TIERS[tier] }; },
  "/api/beacon": () => leaderboard(),
  "/api/contracts": () => ({ network: NETWORK, explorer: EXPLORER, contracts: Object.values(state.contracts).filter((c) => listed(c.proxy)) }), // filtered on read: older state files still hold the token
};

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2", ".ico": "image/x-icon" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const route = routes[url.pathname];
  if (route) {
    Promise.resolve().then(() => route(url.searchParams)).then((body) => {
      res.writeHead(200, { "content-type": "application/json", "cache-control": "public, max-age=5" });
      res.end(JSON.stringify(body));
    }, (e) => {
      res.writeHead(e.status || 500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    });
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
every(300_000, SOURCIFY && !EXPLORER_KEY ? chainPulse : refreshStats, "stats");
every(600_000, refreshContracts, "contracts");
every(12_000, scanPools, "pools");
every(1_500, backfillOrigin, "origins");
every(3_000, gradeNext, "grader");
every(5_000, refreshLabels, "labels");
every(6 * 3600e3, refreshStocks, "stocks");
every(2_000, resolveSymbols, "symbols");
setInterval(pruneDeep, 60_000);
setInterval(save, 60_000);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { save(); process.exit(0); });
