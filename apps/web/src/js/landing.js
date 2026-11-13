import {
  CONFIG, $, $$, esc, boot, smoothScroll, api, rpc, setText, tween, compact, usd, int, pct, age, short, copy, toast, friendly,
  wallet, onWallet, openWalletModal, sendTx, sel, explorerAddr, TICK, ICON,
} from "./core.js";
import { lineChart, projection } from "./chart.js";
import { loadVaults, loadBeacon } from "./chain.js";
import { northScore } from "./score.js";
import { scramble, decodeOnHover, cursorHud, spotlight, ripples, scrollSpy, clock } from "./fx.js";
import { splash } from "./splash.js";
import { mountConsole, pad, meter } from "./console.js";

boot();
const net = CONFIG.testnet ? "Testnet" : "Mainnet";
$$("[data-net-tag]").forEach((el) => (el.textContent = el.closest(".legal") ? CONFIG.chain.name : net));
$$("[data-explorer]").forEach((a) => (a.href = CONFIG.chain.explorer));
$$("[data-faucet]").forEach((a) => (CONFIG.chain.faucet ? (a.href = CONFIG.chain.faucet) : a.closest("li").remove()));
const logDate = new Date(CONFIG.deployedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
$$("[data-date]").forEach((el) => (el.textContent = logDate));

// ---------- interaction layer ----------
cursorHud($("#hud"));
spotlight(".spot");
ripples(".btn, .icon-btn, .chip, .seg button, .rank-row");
decodeOnHover(".btn, .nav-links a, .chip, .tlink, .foot a");
scrollSpy($$(".nav-links a[href^='#']"));
clock($("#clock"));

// ---------- radar planet ----------
let globe = null, pings = 0, drifted = [], planetLoaded;
const planetReady = new Promise((r) => (planetLoaded = r));
const tokenTip = (t) => `<b>${esc(t.name)} · $${esc(t.symbol)}</b><span>North Score <b class="num">${t.score}</b></span><span>Born ${age(t.ageMin)} ago · ${int(t.holders) ?? "first"} holder${t.holders === 1 ? "" : "s"}</span>`;
const globeReady = import("./globe.js")
  .then(({ mountGlobe }) => {
    globe = mountGlobe({
      layer: $("#globeLayer"), canvas: $("#globe"), target: $("#globeTarget"), hint: $("#globeHint"), tip: $("#globeTip"),
      describe: tokenTip,
      onPing: () => tween("#pingCount", ++pings),
      onSelect: (t) => showToken(t, true),
      onReady: planetLoaded,
      intro: document.documentElement.classList.contains("splashing"),
    });
    if (drifted.length) globe.setTokens(drifted);
    return globe;
  })
  .catch((e) => { console.warn("webgl", e); planetLoaded(); $("#globeLayer").classList.add("off"); $("#globeHint").remove(); $("#globeTarget").remove(); });
$("#globePause").addEventListener("click", (e) => {
  const paused = globe?.pause();
  e.currentTarget.setAttribute("aria-pressed", String(!!paused));
  e.currentTarget.textContent = paused ? "resume" : "pause";
});
$("#globeReset").addEventListener("click", () => globe?.reset());

// ---------- splash, then motion ----------
const headBlock = () => rpc("eth_blockNumber").then((b) => Number(BigInt(b))).catch(() => null);
const splashed = document.documentElement.classList.contains("splashing");
const opened = splash($("#splash"), { ready: planetReady, lines: [
  `POLARIS TERMINAL v1.0.0 · ${CONFIG.chain.name.toLowerCase()} (${CONFIG.chain.id})`,
  `[ OK ] rpc handshake ......... ${new URL(CONFIG.chain.rpcs[0]).host}`,
  async () => { const b = await Promise.race([headBlock(), new Promise((r) => setTimeout(r, 900))]); return `[ OK ] head block ............ ${b ? "#" + b.toLocaleString("en-US") : "syncing"}`; },
  `[ OK ] drift scanner ......... online`,
  `[ OK ] north vaults .......... ${CONFIG.vaults.length} in registry`,
  `[ OK ] beacon ................ ${short(CONFIG.beacon)}`,
  `> calibrating north .......... locked on Polaris`,
] }).then(() => {
  // the iris is opening: the planet leaves the reticle for the hero while the page fades in around it
  document.documentElement.classList.remove("splashing");
  globeReady.then((g) => g?.reveal());
});

addEventListener("load", async () => {
  await opened;
  smoothScroll();
  const lag = splashed ? 0.5 : 0;
  setTimeout(() => scramble($(".hero-h"), 900), lag * 1000);
  if (!window.gsap) return $$(".reveal").forEach((el) => el.classList.remove("reveal"));
  gsap.registerPlugin(ScrollTrigger);
  gsap.from(".hero-copy > *", { opacity: 0, y: splashed ? 22 : 12, duration: splashed ? 0.9 : 0.6, delay: lag, stagger: 0.08, ease: "power3.out" });
  if (splashed) gsap.from(".nav .wrap > *", { opacity: 0, y: -10, duration: 0.7, delay: lag, stagger: 0.08, ease: "power3.out" });
  ScrollTrigger.batch(".reveal", {
    start: "top 88%",
    once: true,
    onEnter: (els) => {
      gsap.to(els, { opacity: 1, y: 0, duration: 0.45, stagger: 0.06, ease: "power3.out" });
      els.forEach((el) => $$(".kicker, .h2", el).forEach((t) => scramble(t, 700)));
    },
  });
});

// ---------- live block ----------
async function block() {
  try { tween("#hBlock", Number(BigInt(await rpc("eth_blockNumber")))); } catch { /* keep last value */ }
}
block();
setInterval(block, 4000);

// ---------- pulse ----------
let lastPulse = null;
function pulse() {
  api("/api/pulse", (p) => {
    lastPulse = p;
    tween("#pBorn", p.drift?.born24h);
    setText("#pBornH", p.drift?.born1h ? `${p.drift.born1h} in the last hour` : null);
    tween("#pTx", p.txToday, (v) => compact(v));
    if (p.txHistory?.length > 1) {
      const prev = p.txHistory.at(-2)[1], last = p.txHistory.at(-1)[1];
      if (prev && last) setText("#pTxD", `${last >= prev ? "+" : "−"}${Math.abs(((last - prev) / prev) * 100).toFixed(1)}% vs the day before`);
    }
    if (p.blockTime) setText("#pBt", p.blockTime < 1 ? `${Math.round(p.blockTime * 1000)}ms` : `${p.blockTime.toFixed(1)}s`);
    if (p.gasGwei) setText("#pGas", `gas ${p.gasGwei} gwei`);
  });
}
pulse();
setInterval(pulse, 20_000);

// ---------- drift ----------
function showToken(t, fromGlobe = false) {
  if (!t) return;
  setText("#tName", t.name);
  setText("#tSym", "$" + t.symbol);
  $("#tAva").textContent = t.symbol.slice(0, 2);
  tween("#tScore", t.score);
  const f = t.f || northScore(t).f;
  $("#tFactors").innerHTML = [["Holders", f.holders], ["Mint activity", f.activity], ["Freshness", f.fresh], ["Source", f.trust]]
    .map(([k, v], i) => `<div class="factor"><span>${k}</span><div class="bar${i === 0 ? " lead" : ""}"><i style="--w:${Math.max(4, v * 100)}%"></i></div><span class="num">${Math.max(1, Math.round(v * 100))}</span></div>`).join("");
  setText("#tMeta", `Born ${age(t.ageMin)} ago · ${int(t.holders) ?? "first"} holder${t.holders === 1 ? "" : "s"}${t.verified ? " · verified" : ""}`);
  $("#tLink").href = `${CONFIG.chain.explorer}/token/${t.address}`;
  scramble($("#tName"), 420);
  if (!fromGlobe) globe?.select(t);
}

function drift() {
  api("/api/drift?limit=60", (d) => {
    if (!d?.tokens?.length) return;
    drifted = d.tokens;
    globe?.setTokens(d.tokens);
    tween("#dHour", d.born1h || d.born24h);
    if (!d.born1h) setText($("#dHour").previousElementSibling, "Born in the last 24h");
    tween("#dTracked", d.tracked);
    $("#pullers").innerHTML = d.tokens.slice(0, 5).map((t, i) => `<a class="puller" href="${CONFIG.chain.explorer}/token/${t.address}" target="_blank" rel="noopener"><span class="num muted">${i + 1}</span><b>$${esc(t.symbol)}</b><span class="bar${i ? "" : " lead"}"><i style="--w:${(t.score / d.tokens[0].score) * 100}%"></i></span><span class="num">${t.score}</span></a>`).join("");
    setText("#dTop", "$" + d.tokens[0].symbol);
    if (!$("#tokenCard").dataset.set) { $("#tokenCard").dataset.set = 1; showToken(d.tokens[0], true); }
    const newest = [...d.tokens].sort((a, b) => a.ageMin - b.ageMin).slice(0, 24);
    const item = (t) => `<a class="tape-item" href="${CONFIG.chain.explorer}/token/${t.address}" target="_blank" rel="noopener"><b>$${esc(t.symbol)}</b>${age(t.ageMin)} old<span class="ns">NS ${t.score}</span></a>`;
    $("#tape").innerHTML = newest.map(item).join("") + newest.map(item).join("");
  });
}
drift();
setInterval(drift, 30_000);

// ---------- north score tuner ----------
const tuner = () => {
  const H = +$("#sH").value, M = +$("#sM").value, A = +$("#sA").value, V = $("#sV").checked;
  const { score } = northScore({ holders: H, mints: M, bornAt: Date.now() - A * 60e3, verified: V });
  $("#oH").textContent = H.toLocaleString("en-US");
  $("#oM").textContent = M.toLocaleString("en-US");
  $("#oA").textContent = age(A);
  $("#dialVal").textContent = score;
  $("#dialArc").style.strokeDashoffset = 327 * (1 - score / 100);
  $$("#tuner input[type=range]").forEach((r) => r.style.setProperty("--p", ((r.value - r.min) / (r.max - r.min)) * 100 + "%"));
};
$$("#tuner input").forEach((i) => i.addEventListener("input", tuner));
tuner();

// ---------- vaults ----------
let V = null, chosen = null, days = 365;
async function vaults() {
  try { V = await loadVaults(); } catch (e) { return console.warn("vaults", e); }
  if (!V.ranked.length) return;
  chosen = V.ranked.find((v) => v.address === chosen?.address) || V.pick;
  const maxS = V.pick.score;
  $("#rankRows").innerHTML = V.ranked.map((v, i) => `
    <button class="rank-row${v === chosen ? " on" : ""}" data-a="${v.address}">
      <span class="rk">${i + 1}</span>
      <span class="vn"><b>${v === V.pick ? TICK : ""}${esc(v.name)}</b><small>${esc(v.symbol)} · ${CONFIG.asset.symbol}</small></span>
      <span class="apy">${pct(v.apy)}</span>
      <span class="fac">×${v.f.depth.toFixed(2)}<span class="bar"><i style="--w:${v.f.depth * 100}%"></i></span></span>
      <span class="fac">×${v.f.liq.toFixed(2)}<span class="bar"><i style="--w:${v.f.liq * 100}%"></i></span></span>
      <span class="fac">${v.score.toFixed(2)}<span class="bar${v === V.pick ? " lead" : ""}"><i style="--w:${(v.score / maxS) * 100}%"></i></span></span>
    </button>`).join("");
  $$(".rank-row[data-a]").forEach((b) => b.addEventListener("click", () => { chosen = V.ranked.find((v) => v.address === b.dataset.a); vaults(); }));
  const perDay = V.ranked.reduce((s, v) => s + v.rate * 86400, 0);
  $("#rankFacts").innerHTML = [
    ["Total in orbit", usd(V.ranked.reduce((s, v) => s + v.tvl, 0))],
    ["Streaming", `${Math.round(perDay).toLocaleString("en-US")} ${CONFIG.asset.symbol}/day`],
    ["Registry asset", `${CONFIG.asset.symbol} · ${short(CONFIG.asset.address)}`],
    ["Standard", "ERC-4626 · UUPS"],
  ].map(([k, v]) => `<div><span class="label">${k}</span><b>${esc(v)}</b></div>`).join("");
  setText("#pApy", pct(V.pick.apy));
  setText("#pApyN", `${V.pick.name} · North Pick`);
  drawProjection();
}
function drawProjection() {
  if (!chosen) return;
  const amt = +$("#projAmt").value;
  const pts = projection(amt, chosen.apy, days);
  const end = pts.at(-1).y;
  $("#projAmtO").textContent = "$" + amt.toLocaleString("en-US");
  $("#projAmt").style.setProperty("--p", ((amt - 100) / (100000 - 100)) * 100 + "%");
  setText("#projLabel", `${chosen.name} at ${pct(chosen.apy)} APY`);
  setText("#projValue", "$" + Math.round(end).toLocaleString("en-US"));
  setText("#projGain", `+$${Math.round(end - amt).toLocaleString("en-US")} in ${days === 365 ? "a year" : days + " days"}`);
  lineChart($("#projChart"), {
    points: pts, baseline: amt,
    fmtX: (d) => (Math.round(d) ? `day ${Math.round(d)}` : "today"),
    fmtY: (y) => "$" + Math.round(y).toLocaleString("en-US"),
    tipHtml: (p) => `${Math.round(p.x) ? "day " + Math.round(p.x) : "today"} · <b>$${p.y.toLocaleString("en-US", { maximumFractionDigits: 2 })}</b>`,
  });
}
$("#projAmt").addEventListener("input", drawProjection);
$$("#projDays button").forEach((b) => b.addEventListener("click", () => {
  $$("#projDays button").forEach((x) => x.classList.toggle("on", x === b));
  days = +b.dataset.d;
  drawProjection();
}));
addEventListener("resize", () => requestAnimationFrame(drawProjection));
vaults();
setInterval(vaults, 30_000);

// ---------- beacon ----------
const NODES = [[40, 150], [120, 96], [200, 128], [280, 60], [360, 104], [440, 44], [520, 88]];
function constellation(me, today) {
  const lit = me ? Math.min(7, me.live) : 0;
  const links = NODES.slice(1).map((n, i) => `<path class="link${i + 1 < lit ? " lit" : ""}" d="M${NODES[i][0]},${NODES[i][1]}L${n[0]},${n[1]}"/>`).join("");
  const day = (k) => new Date((today - (lit ? lit - 1 : 0) + k) * 864e5);
  const nodes = NODES.map(([x, y], i) => `<circle class="node${i < lit ? " lit" : ""}${me?.pingedToday && i === lit - 1 ? " today" : ""}" cx="${x}" cy="${y}" r="${i < lit ? 8 : 6}"><title>${day(i).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" })}${i < lit ? " · lit" : ""}</title></circle><text x="${x}" y="${y + 28}" text-anchor="middle">${day(i).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })}</text>`).join("");
  $("#constel").innerHTML = links + nodes;
}
async function beacon() {
  const b = await loadBeacon(wallet.account).catch(() => null);
  constellation(b?.me, b?.today || Math.floor(Date.now() / 864e5));
  const btn = $("#pingBtn"), label = btn.querySelector("span");
  if (!wallet.account) { label.textContent = "Connect to ping"; btn.disabled = false; setText("#constelCap", "Seven days, seven stars. Connect a wallet to light yours"); }
  else if (b?.me?.pingedToday) { label.textContent = "Pinged today"; btn.disabled = true; setText("#constelCap", `${b.me.live}-day streak · ${b.me.xp.toLocaleString("en-US")} XP · next ping +${b.me.nextGain} XP after UTC midnight`); }
  else if (b?.me) { label.textContent = `Ping for +${b.me.nextGain} XP`; btn.disabled = false; setText("#constelCap", b.me.pings ? `${b.me.live ? b.me.live + "-day streak, keep it lit" : "Streak cooled, ping to restart it"} · ${b.me.xp.toLocaleString("en-US")} XP` : "Your first ping lights the first star"); }
}
let lastBoard = null;
function board() {
  api("/api/beacon", (d) => {
    lastBoard = d;
    const me = wallet.account?.toLowerCase();
    $("#board").innerHTML = d?.top?.length
      ? d.top.slice(0, 5).map((r, i) => `<div class="board-row"><span class="${r.address === me ? "me" : ""}">${i + 1}. ${short(r.address)}${r.address === me ? " · you" : ""}</span><span>${r.streak}d</span><span>${r.xp.toLocaleString("en-US")}</span></div>`).join("")
      : `<p class="board-empty">The board is open. The first observer to ping takes the top spot</p>`;
  });
}
$("#pingBtn").addEventListener("click", async () => {
  if (!wallet.account) return openWalletModal();
  const btn = $("#pingBtn");
  btn.disabled = true;
  try {
    const { hash } = await sendTx(CONFIG.beacon, sel("PolarisBeacon", "ping"));
    toast("Ping landed on-chain", false, hash);
    globe?.ping();
    await beacon();
    board();
  } catch (e) {
    toast(friendly(e), true, e.hash);
    btn.disabled = false;
  }
});
onWallet(() => { beacon(); board(); });
setInterval(board, 30_000);

// ---------- contracts ----------
const ROLES = {
  beacon: "Daily check-in, streaks and XP",
  registry: "Allowlist of vaults the terminal routes into",
  dollar: "pUSD, the testnet stable with a daily drip",
  vaultVega: "North Vault · Vega",
  vaultSirius: "North Vault · Sirius",
  vaultAltair: "North Vault · Altair",
};
function contracts(status = {}) {
  $("#cRows").innerHTML = CONFIG.contracts.map((c) => {
    const ok = status[c.key]?.verified;
    return `<div class="crow">
      <span class="cn">${esc(c.name)}<small>v${esc(c.version || "1.0.0")} · UUPS</small></span>
      <span class="role">${esc(ROLES[c.key] || c.key)}</span>
      <span class="addr">${short(c.proxy)}</span>
      <span>${ok === false ? `<span class="tag">Verifying</span>` : `<span class="tag ok"><span class="dot"></span>Verified</span>`}</span>
      <span class="acts"><button class="icon-btn" data-copy="${c.proxy}" aria-label="Copy address">${ICON.copy}</button><a class="icon-btn" href="${explorerAddr(c.proxy)}" target="_blank" rel="noopener" aria-label="Open in explorer">${ICON.ext}</a></span>
    </div>`;
  }).join("");
  $$("[data-copy]").forEach((b) => (b.onclick = () => copy(b.dataset.copy, b)));
}
contracts();
api("/api/contracts", (d) => contracts(Object.fromEntries((d?.contracts || []).map((c) => [c.key, c]))));

// ---------- console ----------
const minutes = (s) => { const m = /^(\d+(?:\.\d+)?)(m|h|d)?$/i.exec(s || ""); return m ? +m[1] * ({ h: 60, d: 1440 }[m[2]?.toLowerCase()] || 1) : NaN; };
const HELP = [
  ["drift [n]", "newborn tokens ranked by North Score"],
  ["token <symbol>", "read one token and lock it on the planet"],
  ["score <holders> <mints> <age>", "run the North Score, age like 90m, 3h or 2d"],
  ["vaults", "North Vaults ranked, read from chain"],
  ["pulse", "chain pulse: block, tx today, block time, gas"],
  ["beacon", "top observers on the Beacon board"],
  ["contracts", "every Polaris contract and its proxy"],
  ["ping", "measure the round trip to the RPC"],
  ["whoami · connect", "your wallet session"],
  ["open <app|docs|radar|vaults|beacon>", "jump somewhere"],
  ["clear", "clear the screen, or ctrl+l"],
];
const term = mountConsole($("#term"), {
  prompt: "guest@polaris:~$",
  commands: {
    help: (_, out) => {
      out(`<b>Polaris Terminal</b> · ${esc(CONFIG.chain.name)} · tab completes, ↑ ↓ walk history`);
      HELP.forEach(([c, d]) => out(`<span class="hc">${esc(c)}</span><span class="dim">${esc(d)}</span>`, "help"));
    },
    drift: async ([n], out) => {
      const d = await api("/api/drift?limit=60");
      if (!d?.tokens?.length) return out("the drift is quiet right now", "dim");
      const k = Math.max(1, Math.min(20, +n || 8));
      out(`<span class="dim">${esc(pad("#", 4) + pad("SYMBOL", 12) + pad("NS", 5) + pad("AGE", 6) + pad("HOLDERS", 9))}PULL</span>`);
      d.tokens.slice(0, k).forEach((t, i) => out(`${esc(pad(i + 1, 4))}<b>${esc(pad("$" + t.symbol, 12))}</b>${esc(pad(t.score, 5) + pad(age(t.ageMin), 6) + pad(int(t.holders) ?? "1", 9))}${meter(t.score / d.tokens[0].score, innerWidth < 560 ? 6 : 12)}`));
      out(`<span class="dim">${d.tracked} tracked · ${d.born24h ?? 0} born in 24h · try <b>token ${esc(d.tokens[0].symbol)}</b></span>`);
    },
    token: async ([sym], out) => {
      if (!sym) return out("usage: token &lt;symbol&gt;", "err");
      const d = await api("/api/drift?limit=100");
      const t = d?.tokens?.find((x) => x.symbol.toLowerCase() === sym.replace(/^\$/, "").toLowerCase());
      if (!t) return out(`no token $${esc(sym.replace(/^\$/, ""))} in the drift window`, "err");
      const f = t.f || northScore(t).f;
      out(`<b>${esc(t.name)} · $${esc(t.symbol)}</b>  North Score <b>${t.score}</b>`);
      [["holders", f.holders], ["mint activity", f.activity], ["freshness", f.fresh], ["source", f.trust]].forEach(([k, v]) => out(`  ${esc(pad(k, 15))}${meter(v)} ${Math.round(v * 100)}`));
      out(`  born ${age(t.ageMin)} ago · ${int(t.holders) ?? "first"} holders · <a href="${CONFIG.chain.explorer}/token/${t.address}" target="_blank" rel="noopener">${short(t.address)}</a>`);
      showToken(t);
    },
    score: ([h, m, a], out) => {
      const H = +h, M = +m, A = minutes(a);
      if (![H, M, A].every((x) => Number.isFinite(x) && x > 0)) return out("usage: score &lt;holders&gt; &lt;mints&gt; &lt;age&gt;   e.g. score 800 120 90m", "err");
      const { score, f } = northScore({ holders: H, mints: M, bornAt: Date.now() - A * 60e3, verified: true });
      [["holders", f.holders], ["mint activity", f.activity], ["freshness", f.fresh]].forEach(([k, v]) => out(`  ${esc(pad(k, 15))}${meter(v)} ${Math.round(v * 100)}`));
      out(`  North Score <b>${score}</b> <span class="dim">(verified source; unverified scores ×0.7)</span>`);
    },
    vaults: async (_, out) => {
      const v = V || (await loadVaults());
      if (!v.ranked.length) return out("no ranked vaults yet", "dim");
      out(`<span class="dim">${esc(pad("#", 4) + pad("VAULT", 10) + pad("APY", 9) + pad("TVL", 10))}SCORE</span>`);
      v.ranked.forEach((x, i) => out(`${esc(pad(i + 1, 4))}<b>${esc(pad(x.name, 10))}</b>${esc(pad(pct(x.apy), 9) + pad(usd(x.tvl) ?? "-", 10) + x.score.toFixed(2))}${x === v.pick ? " <b>★ north pick</b>" : ""}`));
    },
    pulse: async (_, out) => {
      const p = (await api("/api/pulse")) || lastPulse;
      if (!p) return out("pulse unavailable, try again", "err");
      out(`  block       <b>#${(p.block || 0).toLocaleString("en-US")}</b>`);
      out(`  tx today    ${esc(compact(p.txToday) ?? "n/a")}`);
      out(`  block time  ${p.blockTime ? (p.blockTime < 1 ? Math.round(p.blockTime * 1000) + "ms" : p.blockTime.toFixed(1) + "s") : "n/a"}`);
      out(`  gas         ${p.gasGwei ? esc(p.gasGwei) + " gwei" : "n/a"}`);
    },
    beacon: async (_, out) => {
      const d = (await api("/api/beacon")) || lastBoard;
      if (!d?.top?.length) return out("the board is open, the first ping takes the top spot", "dim");
      d.top.slice(0, 5).forEach((r, i) => out(`  ${i + 1}. ${esc(pad(short(r.address), 16))}${esc(pad(r.streak + "d", 6))}<b>${r.xp.toLocaleString("en-US")} XP</b>`));
    },
    contracts: (_, out) => CONFIG.contracts.forEach((c) => out(`  ${esc(pad(c.name + (c.key.startsWith("vault") ? " " + c.key.slice(5) : ""), 24))}<a href="${explorerAddr(c.proxy)}" target="_blank" rel="noopener">${c.proxy}</a>`)),
    ping: async (_, out) => {
      const t0 = performance.now(), b = await headBlock();
      if (!b) return out("rpc did not answer", "err");
      out(`pong from ${esc(new URL(CONFIG.chain.rpcs[0]).host)} · block <b>#${b.toLocaleString("en-US")}</b> · ${Math.round(performance.now() - t0)}ms`);
      globe?.ping();
    },
    whoami: (_, out) => out(wallet.account ? `observer <b>${short(wallet.account)}</b> · ${wallet.chainOk ? "on " + esc(CONFIG.chain.name) : "wrong network"}` : "guest · run <b>connect</b> to sign in with a wallet"),
    connect: (_, out) => { openWalletModal(); out("opening wallet picker", "dim"); },
    open: ([where], out) => {
      const to = { app: "/app", terminal: "/app", radar: "/app#radar", vaults: "/app#vaults", beacon: "/app#beacon", docs: "/docs" }[where];
      if (!to) return out("usage: open app|docs|radar|vaults|beacon", "err");
      out(`opening ${to}`, "dim");
      setTimeout(() => (location.href = to), 300);
    },
    clear: () => term.clear(),
    sudo: (_, out) => out("permission denied: Polaris answers to no one", "err"),
  },
});
new IntersectionObserver(([e], io) => { if (e.isIntersecting) { io.disconnect(); term.type("help"); } }, { threshold: 0.4 }).observe($("#term"));
