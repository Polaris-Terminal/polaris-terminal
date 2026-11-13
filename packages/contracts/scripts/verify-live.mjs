// pnpm testnet:verify | pnpm mainnet:verify — live, interactive proof that every Polaris contract is verified & published.
// Testnet checks Blockscout. Mainnet's Blockscout API sits behind a bot wall, so it checks Sourcify and reads the
// proxy → implementation link straight from the ERC-1967 slot on-chain.
// Every value shown comes from the chain RPC and the verifier API at run time; nothing is faked for the recording.
// Non-TTY (CI, pipes): no prompts or animation, exits 1 if any contract is not verified.
import { readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";

const NETS = {
  testnet: {
    file: "robinhoodTestnet", label: "Robinhood Chain Testnet", source: "Blockscout",
    rpcs: ["https://rpc.testnet.chain.robinhood.com"], explorer: "https://explorer.testnet.chain.robinhood.com",
  },
  mainnet: {
    file: "robinhood", label: "Robinhood Chain Mainnet", source: "Sourcify", env: { VERIFY_PROVIDER: "sourcify" },
    rpcs: ["https://rpc.mainnet.chain.robinhood.com", "https://robinhood.drpc.org", "https://robinhood-rpc.publicnode.com"],
    explorer: "https://robinhoodchain.blockscout.com",
  },
};
const ENV = process.argv[2] || "testnet";
const NET = NETS[ENV];
if (!NET) { console.error(`usage: verify-live.mjs testnet|mainnet`); process.exit(2); }
const dep = JSON.parse(readFileSync(new URL(`../deployments/${NET.file}.json`, import.meta.url), "utf8"));
const EXPLORER = NET.explorer;
// The testnet PolarisToken stays hidden, same as the site: $POLARIS launches elsewhere and this CA would mislead viewers.
const HIDDEN = new Set(["token"]);

const tty = process.stdout.isTTY && process.stdin.isTTY;
const PACE = tty ? 320 : 0;
const out = (s) => process.stdout.write(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rgb = (hex) => hex.match(/\w\w/g).map((h) => parseInt(h, 16));
const paint = (hex) => (s) => `\x1b[38;2;${rgb(hex).join(";")}m${s}\x1b[0m`;
const c = {
  green: paint("00ff41"), mint: paint("b8ffc9"), text: paint("d6ffe0"), dim: paint("54906a"),
  warn: paint("ffd60a"), bad: paint("ff3d61"), bold: (s) => `\x1b[1m${s}\x1b[22m`,
};
const link = (url) => `\x1b]8;;${url}\x1b\\${c.mint(`\x1b[4m${url}\x1b[24m`)}\x1b]8;;\x1b\\`;
const explorerUrl = (addr) => `${EXPLORER}/address/${addr}?tab=contract`;
const label = (key) => key.replace(/([A-Z])/g, " $1").replace(/^./, (m) => m.toUpperCase());

process.on("exit", () => out("\x1b[?25h"));
if (tty) out("\x1b[?25l");

function gradient(line, from = "00ff41", to = "b8ffc9") {
  const [a, b] = [rgb(from), rgb(to)];
  return [...line].map((ch, i) => {
    const t = i / Math.max(1, line.length - 1);
    return `\x1b[38;2;${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(";")}m${ch}`;
  }).join("") + "\x1b[0m";
}

async function type(s, speed = 14) {
  if (!tty) return out(s + "\n");
  for (const ch of s) { out(ch); await sleep(speed); }
  out("\n");
}

function key() {
  return new Promise((res) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once("data", (b) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      const k = b.toString();
      if (k === "\x03") process.exit(130);
      res(k);
    });
  });
}

const FRAMES = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏";
async function step(text, fn) {
  let i = 0;
  const timer = tty && setInterval(() => out(`\r\x1b[2K   ${c.green(FRAMES[i++ % FRAMES.length])} ${c.text(text)}`), 70);
  try {
    const [detail] = await Promise.all([fn(), sleep(PACE)]);
    out(`\r\x1b[2K   ${c.green("✔")} ${c.text(text)} ${c.dim(detail ?? "")}\n`);
  } catch (e) {
    out(`\r\x1b[2K   ${c.bad("✖")} ${c.text(text)} ${c.bad(e.message)}\n`);
    throw e;
  } finally {
    clearInterval(timer);
  }
}

// Walks the RPC list until one answers, then sticks with it; a node-level error (a revert, a bad param) is final.
let rpcAt = 0;
async function rpc(method, params = []) {
  for (; rpcAt < NET.rpcs.length; rpcAt++) {
    let j;
    try {
      const r = await fetch(NET.rpcs[rpcAt], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15_000),
      });
      j = await r.json();
    } catch (e) {
      if (rpcAt === NET.rpcs.length - 1) throw new Error(`rpc unreachable (${e.cause?.code || e.message})`);
      continue;
    }
    if (j.error) throw new Error(j.error.message);
    return j.result;
  }
}
const rpcHost = () => new URL(NET.rpcs[rpcAt]).host;

const getJson = (url) => fetch(url, { signal: AbortSignal.timeout(15_000) }).then((r) => (r.ok ? r.json() : null));
const api = (path) => getJson(`${EXPLORER}/api/v2/${path}`);
const sourcify = (a) => getJson(`https://sourcify.dev/server/v2/contract/${dep.chainId}/${a}?fields=compilation`);

// One shape for both verifiers: { name, compiler, runs, evm, verifiedAt }; throws unless the address itself is fully verified.
async function source(addr, what) {
  if (NET.source === "Sourcify") {
    const s = await sourcify(addr);
    if (s?.match !== "exact_match") throw new Error(`${what} not verified`); // partial matches do not count
    const cs = s.compilation.compilerSettings;
    return { name: s.compilation.name, compiler: "v" + s.compilation.compilerVersion, runs: cs.optimizer?.runs, evm: cs.evmVersion, verifiedAt: s.verifiedAt };
  }
  // Blockscout can serve a twin's source at an unverified address, so require its own full verification.
  const s = await api(`smart-contracts/${addr}`);
  if (!s?.is_verified || s.is_partially_verified || s.is_fully_verified === false) throw new Error(`${what} not verified`);
  return { name: s.name, compiler: s.compiler_version, runs: s.optimization_runs, evm: s.evm_version, verifiedAt: s.verified_at };
}

const IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"; // ERC-1967 implementation slot
async function linked(proxy, impl) {
  const is = (a) => a?.toLowerCase() === impl.toLowerCase();
  if (NET.source === "Sourcify") return is("0x" + (await rpc("eth_getStorageAt", [proxy, IMPL_SLOT, "latest"])).slice(-40));
  return !!(await api(`addresses/${proxy}`))?.implementations?.some((x) => is(x.address_hash));
}

const BANNER = [
  "██████╗  ██████╗ ██╗      █████╗ ██████╗ ██╗███████╗",
  "██╔══██╗██╔═══██╗██║     ██╔══██╗██╔══██╗██║██╔════╝",
  "██████╔╝██║   ██║██║     ███████║██████╔╝██║███████╗",
  "██╔═══╝ ██║   ██║██║     ██╔══██║██╔══██╗██║╚════██║",
  "██║     ╚██████╔╝███████╗██║  ██║██║  ██║██║███████║",
  "╚═╝      ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝╚══════╝",
];

// ── intro ────────────────────────────────────────────────────────────────
if (tty) out("\x1b[2J\x1b[H");
out("\n");
for (const line of BANNER) { out("   " + gradient(line) + "\n"); await sleep(PACE / 4); }
out("\n");
await type(`   ${c.bold(c.green("SMART CONTRACT VERIFICATION"))} ${c.dim(`· ${NET.label} · ${NET.source}`)}`);
out(c.dim("   " + "─".repeat(64)) + "\n\n");

const entries = Object.entries(dep.contracts).filter(([k]) => !HIDDEN.has(k));

out(`   ${c.text("Network")}    ${c.mint(NET.label)} ${c.dim(`(chainId ${dep.chainId})`)}\n`);
out(`   ${c.text("Explorer")}   ${link(EXPLORER)}\n`);
if (NET.source === "Sourcify") out(`   ${c.text("Verifier")}   ${link("https://sourcify.dev")} ${c.dim("exact match")}\n`);
out(`   ${c.text("Contracts")}  ${c.mint(String(entries.length))} ${c.dim("UUPS proxies + implementations")}\n\n`);

if (tty) {
  out(`   ${c.green("▸")} ${c.text("Press")} ${c.bold(c.green("ENTER"))} ${c.text("to start verification")} ${c.dim("(q to quit)")}`);
  const k = await key();
  if (k === "q" || k === "\x1b") process.exit(0);
  out("\r\x1b[2K\n");
}

// ── network ──────────────────────────────────────────────────────────────
out(`   ${c.bold(c.mint("[ NETWORK ]"))}\n`);
await step("Connecting to RPC", async () => {
  const t0 = Date.now();
  const id = parseInt(await rpc("eth_chainId"), 16);
  if (id !== dep.chainId) throw new Error(`wrong chain ${id}, expected ${dep.chainId}`);
  return `chainId ${id} · ${rpcHost()} · ${Date.now() - t0}ms`;
});
await step("Reading latest block", async () => `#${parseInt(await rpc("eth_blockNumber"), 16).toLocaleString("en-US")}`);
await step(`Pinging ${NET.source} API`, async () => {
  const up = NET.source === "Sourcify" ? (await fetch("https://sourcify.dev/server/health", { signal: AbortSignal.timeout(15_000) })).ok : await api("stats");
  if (!up) throw new Error(`${NET.source} API unreachable`);
  return "online";
});
out("\n");

// ── contracts ────────────────────────────────────────────────────────────
const results = [];
for (const [i, [key_, ct]] of entries.entries()) {
  const tag = `${String(i + 1).padStart(2, "0")}/${String(entries.length).padStart(2, "0")}`;
  out(`   ${c.bold(c.mint(`[ ${tag} ]`))} ${c.bold(c.green(ct.name))} ${c.dim("· " + label(key_))}\n`);
  const r = { key: key_, name: ct.name, address: ct.proxy, ok: false };
  try {
    let impl;
    await step("Fetching on-chain bytecode", async () => {
      const code = await rpc("eth_getCode", [ct.proxy, "latest"]);
      if (code === "0x") throw new Error("no contract at address");
      return `${((code.length - 2) / 2).toLocaleString("en-US")} bytes`;
    });
    await step("Matching implementation source", async () => {
      impl = await source(ct.implementation, "implementation");
      return `${impl.name} · solc ${impl.compiler.replace(/^v|\+.*$/g, "")}${NET.source === "Sourcify" ? " · exact match" : ""}`;
    });
    await step("Matching proxy source", async () => {
      await source(ct.proxy, "proxy");
      return "PolarisProxy · ERC-1967";
    });
    await step("Checking proxy → implementation link", async () => {
      if (!(await linked(ct.proxy, ct.implementation))) throw new Error("proxy does not point at the deployed implementation");
      return NET.source === "Sourcify" ? "linked · ERC-1967 slot on-chain" : "linked";
    });
    r.ok = true;
    const when = new Date(impl.verifiedAt).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    out(`\n   ${c.dim("│")} ${c.text("Contract ")}  ${c.bold(c.mint(ct.name))}\n`);
    out(`   ${c.dim("│")} ${c.text("Address  ")}  ${c.green(ct.proxy)}\n`);
    out(`   ${c.dim("│")} ${c.text("Logic    ")}  ${c.dim(ct.implementation + "  (implementation)")}\n`);
    out(`   ${c.dim("│")} ${c.text("Compiler ")}  ${c.dim(`${impl.compiler} · optimizer ${impl.runs} · ${impl.evm}`)}\n`);
    out(`   ${c.dim("│")} ${c.text("Status   ")}  ${c.bold(c.green("✔ VERIFIED & PUBLISHED"))} ${c.dim(when)}\n`);
    out(`   ${c.dim("│")} ${c.text("Explorer ")}  ${link(explorerUrl(ct.proxy))}\n\n`);
  } catch {
    out(`\n   ${c.dim("│")} ${c.text("Status   ")}  ${c.bold(c.bad("✖ NOT VERIFIED"))}\n\n`);
  }
  results.push(r);
}

// ── summary ──────────────────────────────────────────────────────────────
const passed = results.filter((r) => r.ok).length;
const all = passed === results.length;
const W = Math.max(...results.map((r) => r.name.length + label(r.key).length + 3));
const row = (r, sel) => {
  const status = r.ok ? c.green("✔ verified") : c.bad("✖ unverified");
  const name = `${r.name} · ${label(r.key)}`.padEnd(W);
  const line = `${sel ? c.green("▸") : " "} ${sel ? c.bold(c.mint(name)) : c.text(name)}  ${c.green(r.address)}  ${status}`;
  return `   ${line}\x1b[K\n`;
};

out(c.dim("   " + "─".repeat(64)) + "\n");
out(`   ${c.bold(c.mint("[ SUMMARY ]"))}  ${all ? c.bold(c.green(`${passed}/${results.length} VERIFIED & PUBLISHED`)) : c.bold(c.warn(`${passed}/${results.length} verified`))}\n\n`);

if (!tty) {
  for (const r of results) out(row(r, false) + `     ${explorerUrl(r.address)}\n`);
  process.exit(all ? 0 : 1);
}

if (!all) {
  out(`   ${c.warn("!")} ${c.text("Some contracts are not verified. Run Hardhat verification now?")} ${c.dim("[y/N]")}`);
  if ((await key()).toLowerCase() === "y") {
    out("\n\n");
    spawnSync("pnpm", ["--filter", "@polaris/contracts", "exec", "hardhat", "run", "scripts/verify.ts", "--network", NET.file], { stdio: "inherit", env: { ...process.env, ...NET.env } });
    out(`\n   ${c.text("Done. Run")} ${c.green(`pnpm ${ENV}:verify`)} ${c.text("again to re-check.")}\n\n`);
    process.exit(0);
  }
  out("\r\x1b[2K");
}

// Interactive picker: ↑/↓ choose, ENTER opens the contract on the explorer, q quits.
let sel = 0;
const draw = (first) => {
  if (!first) out(`\x1b[${results.length + 3}A`);
  for (const [i, r] of results.entries()) out(row(r, i === sel));
  out(`\n   ${c.dim("explorer")} ${link(explorerUrl(results[sel].address))}\x1b[K\n`);
  out(`   ${c.dim("↑/↓ select · ENTER open in browser · q quit")}\x1b[K\n`);
};
draw(true);
for (;;) {
  const k = await key();
  if (k === "q" || k === "\x1b") break;
  if (k === "\x1b[A" || k === "k") sel = (sel + results.length - 1) % results.length;
  if (k === "\x1b[B" || k === "j") sel = (sel + 1) % results.length;
  if (k === "\r") spawn(process.platform === "darwin" ? "open" : "xdg-open", [explorerUrl(results[sel].address)], { detached: true, stdio: "ignore" }).unref();
  draw(false);
}
if (all) out(`\n   ${c.green("★")} ${c.text("Polaris · all systems nominal")}\n\n`);
process.exit(all ? 0 : 1);
