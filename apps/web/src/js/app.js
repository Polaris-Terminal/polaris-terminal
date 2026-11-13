import {
  CONFIG, $, $$, esc, boot, api, rpc, setText, tween, compact, usd, int, pct, age, short, toast, friendly,
  wallet, onWallet, openWalletModal, sendTx, switchChain, sel, encAddr, encU, parseUnits, fromUnits, TICK,
} from "./core.js";
import { mountRadar } from "./radar.js";
import { lineChart, projection } from "./chart.js";
import { loadVaults, loadBalances, loadBeacon } from "./chain.js";
import { northScore } from "./score.js";
import { scramble, decodeOnHover, ripples, clock } from "./fx.js";
import { mountConsole, pad, meter } from "./console.js";
import { startTour, seenTour } from "./tour.js";
import { mountSpace } from "./space.js";

boot();
mountSpace($("#space"));
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
$$(".stat, .panel").forEach((el) => el.classList.add("spot"));
ripples(".btn, .icon-btn, .seg button, .rank-row, .side-nav a");
decodeOnHover(".btn, .side-nav a, .st-tabs a");
clock($("#clock"));

// ---------- activity log: a tail -f of what the terminal sees. msg is HTML, so chain data must be escaped ----------
function log(msg, cls = "") {
  const box = $("#log"), ln = document.createElement("div");
  ln.className = cls;
  ln.innerHTML = `<span class="t">${new Date().toISOString().slice(11, 19)}</span> ${msg}`;
  box.append(ln);
  while (box.childElementCount > 40) box.firstElementChild.remove();
}
log(`session open · ${esc(CONFIG.chain.name.toLowerCase())}`, "dim");
$$("[data-net-tag]").forEach((el) => (el.textContent = CONFIG.testnet ? "Testnet" : "Mainnet"));
$$("[data-explorer]").forEach((a) => (a.href = CONFIG.chain.explorer));
$$("[data-faucet]").forEach((a) => (CONFIG.chain.faucet ? (a.href = CONFIG.chain.faucet) : a.remove()));
if (!CONFIG.testnet) $("#faucet")?.remove();
const A = CONFIG.asset;
setText("#fUnit", A.symbol);
setText("#vBalL", `Wallet ${A.symbol}`);

// ---------- tabs ----------
const TITLES = { radar: "Drift Radar", vaults: "North Vaults", beacon: "Beacon" };
function route() {
  const tab = TITLES[location.hash.slice(1)] ? location.hash.slice(1) : "radar";
  $$(".view").forEach((v) => (v.hidden = v.id !== "v-" + tab));
  $$("a[data-tab]").forEach((a) => a.classList.toggle("on", a.dataset.tab === tab));
  $("#pageTitle").textContent = tab;
  scramble($(".top-title .path"), 300);
  document.title = `${TITLES[tab]} · Polaris`;
  document.body.classList.remove("side-open");
  if (tab === "vaults") requestAnimationFrame(drawChart);
}
addEventListener("hashchange", route);
route();
$("#sideToggle").addEventListener("click", () => document.body.classList.toggle("side-open"));
$(".main").addEventListener("click", (e) => { if (!e.target.closest("#sideToggle")) document.body.classList.remove("side-open"); });
// / opens the shell, ? replays the tour, 1-3 switch views, j/k walk the drift table
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && $("#qc").classList.contains("on")) return shell(false);
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  if (e.key === "/" || e.key === "`") { e.preventDefault(); return shell(true); }
  if (e.key === "?") return runTour();
  const tab = { 1: "radar", 2: "vaults", 3: "beacon" }[e.key];
  if (tab) return (location.hash = tab);
  if ((e.key === "j" || e.key === "k") && !$("#v-radar").hidden && tokens.length) {
    const rows = $$("#tRows .trow"), i = rows.findIndex((r) => r.classList.contains("on"));
    const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === "j" ? 1 : -1)))];
    detail(tokens.find((t) => t.address === next.dataset.a));
    next.scrollIntoView({ block: "nearest" });
  }
});

// ---------- network ----------
let polls = 0;
async function block() {
  try {
    const t0 = performance.now(), b = Number(BigInt(await rpc("eth_blockNumber")));
    $("#netBlock").textContent = "#" + b.toLocaleString("en-US");
    setText("#stLat", `rpc ${Math.round(performance.now() - t0)}ms`);
    if ($("#netDot").classList.contains("off")) log("rpc back online", "ok");
    $("#netDot").classList.remove("off");
    if (polls++ % 4 === 0) log(`head #${b.toLocaleString("en-US")}`, "dim");
  } catch {
    if (!$("#netDot").classList.contains("off")) log("rpc unreachable, retrying", "err");
    $("#netDot").classList.add("off");
    $("#netBlock").textContent = "reconnecting";
  }
}
block();
setInterval(block, 4000);

// ---------- radar ----------
let tokens = [], sortBy = "score", current = null;
const radar = mountRadar($("#radarCanvas"), {
  tip: $("#radarTip"),
  onSelect: (t) => detail(t),
  onHover: (t) => $$("#tRows .trow").forEach((r) => r.classList.toggle("hl", r.dataset.a === t?.address)),
});
// hover readouts for the small bar charts: the bar under the pointer writes its story into a label
function readout(box, out, base) {
  box.addEventListener("pointerover", (e) => { const b = e.target.closest("[data-tip]"); if (b) out.textContent = b.dataset.tip; });
  box.addEventListener("pointerleave", () => (out.textContent = base()));
}
let hourBase = "newborn tokens";
readout($("#rSpark"), $("#rHourD"), () => hourBase);
function spark(hours) {
  if (!hours?.length) return;
  const max = Math.max(...hours, 1), last = hours.length - 1;
  $("#rSpark").innerHTML = hours.map((n, i) => `<i style="--h:${Math.max(6, (n / max) * 100)}%"${i === last ? ' class="now"' : ""} data-tip="${i === last ? "last hour" : `${last - i}-${last - i + 1}h ago`} · ${n} born"></i>`).join("");
}

function detail(t) {
  if (!t) return;
  current = t;
  setText("#dName", `${t.name} · $${t.symbol}`);
  tween("#dScore", t.score);
  const f = t.f || northScore(t).f;
  $("#dFactors").innerHTML = [["Holders", f.holders], ["Mint activity", f.activity], ["Freshness", f.fresh], ["Source", f.trust]]
    .map(([k, v], i) => `<div class="factor"><span>${k}</span><div class="bar${i === 0 ? " lead" : ""}"><i style="--w:${Math.max(4, v * 100)}%"></i></div><span class="num">${Math.max(1, Math.round(v * 100))}</span></div>`).join("");
  const facts = [
    ["Born", `${age(t.ageMin)} ago`],
    ["Birth block", t.bornBlock ? "#" + t.bornBlock.toLocaleString("en-US") : null],
    ["Holders", int(t.holders) ?? "first holder"],
    ["Mints seen", int(t.mints)],
    ["Creator", t.creator ? short(t.creator) : null],
    ["Source", t.verified ? "verified" : "unverified"],
  ].filter(([, v]) => v);
  $("#dFacts").innerHTML = facts.map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${esc(v)}</dd></div>`).join("");
  $("#dLink").href = `${CONFIG.chain.explorer}/token/${t.address}`;
  radar.select(t);
  $$("#tRows .trow").forEach((r) => r.classList.toggle("on", r.dataset.a === t.address));
}

function table() {
  const list = [...tokens].sort((a, b) => sortBy === "age" ? a.ageMin - b.ageMin : sortBy === "holders" ? b.holders - a.holders : b.score - a.score);
  $("#tRows").innerHTML = list.map((t, i) => `<div class="trow${t === current ? " on" : ""}" data-a="${t.address}">
    <span class="rk">${i + 1}</span>
    <span class="tk"><b>${t === tokens[0] ? TICK + " " : ""}${esc(t.name)}</b><small>$${esc(t.symbol)}</small></span>
    <span>${age(t.ageMin)}</span><span>${int(t.holders) ?? "first"}</span><span>${int(t.mints) ?? "first"}</span>
    <span class="sc"><span>${t.score}</span><span class="bar${t === tokens[0] ? " lead" : ""}"><i style="--w:${t.score}%"></i></span></span></div>`).join("");
  $$("#tRows .trow").forEach((r) => {
    const t = () => tokens.find((x) => x.address === r.dataset.a);
    r.addEventListener("click", () => detail(t()));
    r.addEventListener("pointerenter", () => radar.link(t())); // the radar draws a bearing to the row under the pointer
    r.addEventListener("pointerleave", () => radar.link(null));
  });
}
$$("#sortSeg button").forEach((b) => b.addEventListener("click", () => {
  $$("#sortSeg button").forEach((x) => x.classList.toggle("on", x === b));
  sortBy = b.dataset.s;
  table();
}));

function drift() {
  api("/api/drift?limit=100", (d) => {
    if (!d?.tokens?.length) return;
    const seen = new Set(tokens.map((t) => t.address));
    if (!seen.size) log(`scan: <b>${d.tracked}</b> tokens in the ${d.window}h window`);
    else d.tokens.filter((t) => !seen.has(t.address)).forEach((t) => log(`<b>+ $${esc(t.symbol)}</b> born · NS ${t.score}`));
    tokens = d.tokens;
    if (current) current = tokens.find((t) => t.address === current.address) || null;
    radar.set(tokens);
    table();
    detail(current || tokens[0]);
    if (d.born1h) { tween("#rHour", d.born1h); }
    else { setText($("#rHour").previousElementSibling, "Tracked in the window"); tween("#rHour", d.tracked); setText("#rHourD", (hourBase = `last ${d.window}h of mints`)); }
    spark(d.hourly);
    tween("#rDay", d.born24h || d.tracked);
    setText("#rTop", "$" + tokens[0].symbol);
    setText("#rTopD", `North Score ${tokens[0].score}`);
    setText("#nRadar", int(d.tracked));
  });
  api("/api/health", (h) => tween("#rHead", h?.scanned));
}
drift();
setInterval(drift, 20_000);

// ---------- vaults ----------
let V = null, chosen = null, bal = null, mode = "dep", maxMode = false, lastPick = null, orbs = [];
function pickVault(v) { chosen = v; maxMode = false; $("#amt").value = ""; vaults(); }

// the orrery: each North Vault circles Polaris on its rank's ring, as fast as its APY, as big as its deposits
const MARK_PATH = "M0,-15Q1.6,-1.6 12,0Q1.6,1.6 0,15Q-1.6,1.6 -12,0Q-1.6,-1.6 0,-15Z";
function orbit() {
  const maxT = Math.max(...V.ranked.map((v) => v.tvl), 1);
  $("#orbit").innerHTML = `<circle class="sun-halo" r="34"/><path class="sun" d="${MARK_PATH}"/>` + V.ranked.map((v, i) => {
    const R = 70 + i * 34, s = 5 + 8 * Math.sqrt(v.tvl / maxT), on = v === chosen ? " on" : "";
    return `<circle class="track${on}" r="${R}"/>
      <g class="orb${on}" data-a="${v.address}" data-r="${R}" data-w="${(3 + v.apy * 0.8).toFixed(2)}" tabindex="0" role="button" aria-label="${esc(v.name)}, ${pct(v.apy)} APY">
        <path class="trail" d="M${(R * Math.cos(-0.8)).toFixed(1)},${(R * Math.sin(-0.8)).toFixed(1)}A${R},${R} 0 0 1 ${R},0"/>
        <circle class="hit" cx="${R}" r="${(s + 10).toFixed(1)}"/><circle class="body" cx="${R}" r="${s.toFixed(1)}"/>
        <text x="${R}" data-d="${(s + 8).toFixed(1)}" text-anchor="middle">${esc(v.name)} ${pct(v.apy)}</text>
      </g>`;
  }).join("");
  orbs = $$("#orbit .orb").map((g) => {
    const pick = () => pickVault(V.ranked.find((v) => v.address === g.dataset.a));
    g.addEventListener("click", pick);
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    const text = g.querySelector("text");
    return { g, text, r: +g.dataset.r, w: +g.dataset.w, d: +text.dataset.d };
  });
  spinOrbit(performance.now());
}
function spinOrbit(t) {
  orbs.forEach((o, i) => {
    const deg = (i * 137 + (reduce ? 0 : (t / 1000) * o.w)) % 360; // clockwise; the label counter-turns so it sits upright, above the body
    o.g.setAttribute("transform", `rotate(${deg.toFixed(2)})`);
    o.text.setAttribute("transform", `rotate(${(-deg).toFixed(2)} ${o.r} 0) translate(0 ${-o.d})`);
  });
}
if (!reduce) (function loop(t) { requestAnimationFrame(loop); if (!$("#v-vaults").hidden) spinOrbit(t); })(0);

async function vaults() {
  try { V = await loadVaults(); } catch (e) { return console.warn("vaults", e); }
  if (!V.ranked.length) return;
  chosen = V.ranked.find((v) => v.address === chosen?.address) || V.pick;
  if (V.pick.address !== lastPick) { lastPick = V.pick.address; log(`north pick → <b>${esc(V.pick.name)}</b> ${pct(V.pick.apy)}`); }
  const maxS = V.pick.score;
  $("#rankRows").innerHTML = V.ranked.map((v, i) => `
    <button class="rank-row${v === chosen ? " on" : ""}" data-a="${v.address}">
      <span class="rk">${i + 1}</span>
      <span class="vn"><b>${v === V.pick ? TICK : ""}${esc(v.name)}</b><small>${esc(v.symbol)} · ${A.symbol}</small></span>
      <span class="apy">${pct(v.apy)}</span>
      <span class="fac">×${v.f.depth.toFixed(2)}<span class="bar"><i style="--w:${v.f.depth * 100}%"></i></span></span>
      <span class="fac">×${v.f.liq.toFixed(2)}<span class="bar"><i style="--w:${v.f.liq * 100}%"></i></span></span>
      <span class="fac">${v.score.toFixed(2)}<span class="bar${v === V.pick ? " lead" : ""}"><i style="--w:${(v.score / maxS) * 100}%"></i></span></span>
    </button>`).join("");
  $$("#rankRows .rank-row[data-a]").forEach((b) => b.addEventListener("click", () => pickVault(V.ranked.find((v) => v.address === b.dataset.a))));
  orbit();
  tween("#vTvl", V.vaults.reduce((s, v) => s + (v.tvl || 0), 0), (x) => usd(x));
  setText("#vTvlD", `across ${V.ranked.length} North Vaults`);
  setText("#vPick", pct(V.pick.apy));
  setText("#vPickN", `${V.pick.name} · North Pick`);
  setText("#nVaults", pct(V.pick.apy, 1));
  const daysLeft = Math.max(1, Math.round((chosen.rewardEnd - Date.now()) / 864e5));
  $("#vDetail").innerHTML = [
    ["APY", pct(chosen.apy)], ["In vault", usd(chosen.tvl)],
    ["Yield stream", `${(chosen.rate * 86400).toLocaleString("en-US", { maximumSignificantDigits: 3 })} ${A.symbol}/day`],
    ["Stream runs", chosen.rewardEnd > Date.now() ? `${daysLeft} more day${daysLeft > 1 ? "s" : ""}` : "topping up"],
  ].map(([k, v]) => `<div><span class="label">${k}</span><b>${esc(v)}</b></div>`).join("");
  drawChart();
  renderForm();
}

function drawChart() {
  if (!chosen || $("#v-vaults").hidden) return;
  const amt = Math.max(fromUnits(parseUnits($("#amt").value, A.decimals), A.decimals), positionOf(chosen) || 1000);
  lineChart($("#vChart"), {
    points: projection(amt, chosen.apy, 365),
    baseline: amt,
    fmtX: (d) => (Math.round(d) ? `day ${Math.round(d)}` : "today"),
    fmtY: (y) => "$" + y.toLocaleString("en-US", { maximumFractionDigits: 2 }),
  });
}

const positionOf = (v) => (bal ? fromUnits(bal.assets[v.address] || 0n, A.decimals) : 0);

function renderForm() {
  if (!chosen) return;
  const btn = $("#goBtn");
  $$("#modeSeg button").forEach((b) => b.classList.toggle("on", b.dataset.m === mode));
  const amt = parseUnits($("#amt").value, A.decimals);
  const avail = bal ? (mode === "dep" ? bal.asset : bal.assets[chosen.address] || 0n) : 0n;
  setText("#fLabel", mode === "dep" ? `Deposit into ${chosen.name}` : `Withdraw from ${chosen.name}`);
  setText("#fAvail", !wallet.account ? "Connect a wallet to see your balance"
    : avail ? `${mode === "dep" ? "Wallet" : "In vault"}: ${fromUnits(avail, A.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${A.symbol}`
    : mode === "dep" ? `No ${A.symbol} in this wallet yet` : "Nothing deposited here yet");
  const yearly = (fromUnits(amt, A.decimals) * chosen.apy) / 100;
  $("#fPreview").innerHTML = amt
    ? (mode === "dep"
      ? `<div><span>Earns at today's APY</span><b>+${yearly.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${A.symbol}/yr</b></div><div><span>Steps</span><b>${bal && bal.allowance[chosen.address] >= amt ? "deposit" : "approve, deposit"}</b></div>`
      : `<div><span>Receive</span><b>${fromUnits(amt, A.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${A.symbol}</b></div><div><span>Exit</span><b>${maxMode ? "redeem all shares" : "withdraw"}</b></div>`)
    : `<div><span>Vault asset check</span><b>${chosen.ok ? "matches registry" : "blocked"}</b></div>`;
  if (!wallet.account) { btn.textContent = "Connect wallet"; btn.disabled = false; return; }
  if (!wallet.chainOk) { btn.textContent = `Switch to ${CONFIG.chain.name}`; btn.disabled = false; return; }
  if (!amt) { btn.textContent = "Enter an amount"; btn.disabled = true; return; }
  if (amt > avail) { btn.textContent = `Not enough ${A.symbol}`; btn.disabled = true; return; }
  btn.textContent = mode === "dep" ? `Deposit into ${chosen.name}` : `Withdraw from ${chosen.name}`;
  btn.disabled = false;
}

async function balances() {
  if (!wallet.account) {
    bal = null;
    setText("#vPos", "Connect"); setText("#vPosD", "Link a wallet to see your share");
    setText("#vBal", "Connect"); setText("#vBalD", CONFIG.testnet ? "then claim a daily drip" : `bridge ${A.symbol} to start`);
    renderForm();
    return;
  }
  try { bal = await loadBalances(wallet.account); } catch (e) { return console.warn("balances", e); }
  const pos = Object.values(bal.assets).reduce((s, x) => s + fromUnits(x, A.decimals), 0);
  if (pos > 0) { setText("#vPos", usd(pos)); setText("#vPosD", `in ${Object.values(bal.assets).filter((x) => x > 0n).length} vault(s)`); }
  else { setText("#vPos", "Ready"); setText("#vPosD", "Pick a vault and deposit"); }
  const a = fromUnits(bal.asset, A.decimals);
  setText("#vBal", a > 0 ? compact(a) : "Empty");
  setText("#vBalD", a > 0 ? `${A.symbol} ready to deposit` : CONFIG.testnet ? "Claim a drip below" : `Bridge ${A.symbol} to start`);
  renderForm();
  drawChart();
}

$$("#modeSeg button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.m; maxMode = false; $("#amt").value = ""; renderForm(); }));
$("#amt").addEventListener("input", (e) => { e.target.value = e.target.value.replace(",", ".").replace(/[^\d.]/g, ""); maxMode = false; renderForm(); drawChart(); });
$("#maxBtn").addEventListener("click", () => {
  if (!bal) return;
  const v = mode === "dep" ? bal.asset : bal.assets[chosen.address] || 0n;
  $("#amt").value = fromUnits(v, A.decimals).toFixed(A.decimals).replace(/\.?0+$/, "");
  maxMode = mode === "wd";
  renderForm();
});

async function runSteps(title, steps) {
  const m = $("#txModal"), ol = $("#txSteps"), done = $("#txDone");
  $("#txTitle").textContent = "Confirm in your wallet";
  $("#txSub").textContent = title;
  ol.innerHTML = steps.map((s, i) => `<li><span class="s">${i + 1}</span>${esc(s.label)}<small>waiting</small></li>`).join("");
  done.hidden = true;
  m.classList.add("on");
  const lis = $$("li", ol);
  try {
    for (let i = 0; i < steps.length; i++) {
      lis[i].querySelector("small").textContent = "sign in wallet";
      const { hash } = await sendTx(steps[i].to, steps[i].data);
      lis[i].classList.add("done");
      log(`tx ${short(hash)} <b>confirmed</b>`);
      lis[i].querySelector("small").innerHTML = `<a href="${CONFIG.chain.explorer}/tx/${hash}" target="_blank" rel="noopener">confirmed</a>`;
    }
    $("#txTitle").textContent = "All steps confirmed";
    toast(title.replace(/\.$/, "") + " confirmed");
  } catch (e) {
    const li = lis.find((l) => !l.classList.contains("done"));
    if (li) { li.classList.add("err"); li.querySelector("small").textContent = "stopped"; }
    $("#txTitle").textContent = "Stopped";
    log(esc(friendly(e)), "err");
    toast(friendly(e), true, e.hash);
  }
  done.hidden = false;
  done.onclick = () => m.classList.remove("on");
}

$("#goBtn").addEventListener("click", async () => {
  if (!wallet.account) return openWalletModal();
  if (!wallet.chainOk) return switchChain().catch((e) => toast(friendly(e), true));
  const v = chosen, amt = parseUnits($("#amt").value, A.decimals);
  if (!amt) return;
  bal = await loadBalances(wallet.account); // re-read right before signing
  const me = wallet.account;
  const steps = [];
  if (mode === "dep") {
    if (amt > bal.asset) return toast(`Balance changed, not enough ${A.symbol}`, true);
    if (bal.allowance[v.address] < amt) steps.push({ label: `Approve ${fromUnits(amt, A.decimals).toLocaleString("en-US")} ${A.symbol}`, to: A.address, data: sel("ERC20", "approve") + encAddr(v.address) + encU(amt) });
    steps.push({ label: `Deposit into ${v.name}`, to: v.address, data: sel("PolarisVault", "deposit") + encU(amt) + encAddr(me) });
  } else if (maxMode) {
    steps.push({ label: "Redeem all shares", to: v.address, data: sel("PolarisVault", "redeem") + encU(bal.shares[v.address]) + encAddr(me) + encAddr(me) });
  } else {
    steps.push({ label: `Withdraw ${fromUnits(amt, A.decimals).toLocaleString("en-US")} ${A.symbol}`, to: v.address, data: sel("PolarisVault", "withdraw") + encU(amt) + encAddr(me) + encAddr(me) });
  }
  await runSteps(`${mode === "dep" ? "Depositing into" : "Withdrawing from"} ${v.name}`, steps);
  $("#amt").value = "";
  maxMode = false;
  await Promise.all([balances(), vaults()]);
});

$("#dripBtn")?.addEventListener("click", async () => {
  if (!wallet.account) return openWalletModal();
  const b = $("#dripBtn");
  b.disabled = true;
  try {
    const { hash } = await sendTx(A.address, sel("PolarisDollar", "drip"));
    toast(`10,000 ${A.symbol} landed in your wallet`, false, hash);
    log(`drip <b>+10,000 ${A.symbol}</b>`);
    balances();
  } catch (e) { toast(friendly(e), true, e.hash); }
  b.disabled = false;
});

vaults();
setInterval(vaults, 30_000);

// ---------- beacon ----------
const NODES = [[40, 150], [120, 96], [200, 128], [280, 60], [360, 104], [440, 44], [520, 88]];
function constellation(me, today) {
  const lit = me ? Math.min(7, me.live) : 0;
  const links = NODES.slice(1).map((n, i) => `<path class="link${i + 1 < lit ? " lit" : ""}" d="M${NODES[i][0]},${NODES[i][1]}L${n[0]},${n[1]}"/>`).join("");
  const dayName = (k) => new Date((today - (lit ? lit - 1 : 0) + k) * 864e5).toLocaleDateString("en-US", { weekday: "short" });
  $("#constel").innerHTML = links + NODES.map(([x, y], i) => `<circle class="node${i < lit ? " lit" : ""}" cx="${x}" cy="${y}" r="${i < lit ? 8 : 6}"/><text x="${x}" y="${y + 28}" text-anchor="middle">${dayName(i)}</text>`).join("");
}
function resetClock() {
  const ms = 864e5 - (Date.now() % 864e5);
  const h = Math.floor(ms / 36e5), m = Math.max(1, Math.floor((ms % 36e5) / 6e4));
  setText("#bReset", h ? `${h}h ${m}m` : `${m}m`);
}
resetClock();
setInterval(resetClock, 30_000);

async function beacon() {
  const b = await loadBeacon(wallet.account).catch(() => null);
  const today = b?.today || Math.floor(Date.now() / 864e5);
  constellation(b?.me, today);
  xpCurve(b?.me ? (b.me.pingedToday ? b.me.live : b.me.live + 1) : 1);
  setText("#bDay", new Date(today * 864e5).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }) + " UTC");
  const btn = $("#pingBtn"), star = $("#bigPing");
  const me = b?.me;
  star.classList.toggle("done", !!me?.pingedToday);
  if (!wallet.account) {
    btn.textContent = "Connect to ping"; btn.disabled = false;
    setText("#bHead", "Look up"); setText("#bSub", "One ping per UTC day keeps your streak lit");
    return;
  }
  if (!me) return;
  setText("#bStreak", me.live ? `${me.live} day${me.live > 1 ? "s" : ""}` : "Day one");
  setText("#bBest", me.best ? `${me.best} day${me.best > 1 ? "s" : ""}` : "Ahead");
  setText("#bXp", me.xp ? me.xp.toLocaleString("en-US") : "First light");
  if (me.pingedToday) {
    btn.textContent = "Pinged today"; btn.disabled = true;
    setText("#bHead", "Lit for today"); setText("#bSub", `Next ping earns +${me.nextGain} XP after UTC midnight`);
  } else {
    btn.textContent = `Ping for +${me.nextGain} XP`; btn.disabled = false;
    setText("#bHead", me.pings ? (me.live ? "Keep it lit" : "Relight it") : "First light");
    setText("#bSub", me.pings ? (me.live ? `Day ${me.live + 1} of your streak is waiting` : "Your streak cooled. One ping starts it again") : "Your first ping puts you on the board");
  }
}
function board() {
  api("/api/beacon", (d) => {
    const me = wallet.account?.toLowerCase();
    $("#board").innerHTML = d?.top?.length
      ? d.top.map((r, i) => `<div class="board-row"><span class="${r.address === me ? "me" : ""}">${i + 1}. ${short(r.address)}${r.address === me ? " · you" : ""}</span><span>${r.streak}d</span><span>${r.xp.toLocaleString("en-US")}</span></div>`).join("")
      : `<p class="board-empty">The board is open. The first observer to ping takes the top spot</p>`;
    setText("#bTotals", d?.observers ? `${d.observers} observer${d.observers > 1 ? "s" : ""} · ${d.pings} pings` : null);
    setText("#nBeacon", int(d?.observers));
  });
}
async function ping() {
  if (!wallet.account) return openWalletModal();
  const btn = $("#pingBtn"), star = $("#bigPing");
  btn.disabled = true;
  star.classList.remove("burst"); void star.offsetWidth; star.classList.add("burst");
  try {
    const { hash } = await sendTx(CONFIG.beacon, sel("PolarisBeacon", "ping"));
    toast("Ping landed on-chain", false, hash);
    log("beacon <b>ping landed</b>");
    await beacon();
    board();
  } catch (e) {
    toast(friendly(e), true, e.hash);
    btn.disabled = false;
  }
}
$("#pingBtn").addEventListener("click", ping);
$("#bigPing").addEventListener("click", ping);
setInterval(board, 30_000);

// ---------- XP curve: what a ping earns on each day of a streak (PolarisBeacon.previewGain) ----------
const xpFor = (day) => 10 + 5 * Math.min(20, Math.max(0, day - 1));
let xpBase = "hover a day";
readout($("#xpCurve"), $("#xpcRead"), () => xpBase);
function xpCurve(day) {
  xpBase = `your next ping · day ${day} · ${xpFor(day)} XP`;
  $("#xpcRead").textContent = xpBase;
  $("#xpCurve").innerHTML = Array.from({ length: 30 }, (_, k) => {
    const d = k + 1, xp = xpFor(d);
    return `<i class="${d < day ? "past" : d === day ? "now" : ""}" style="--h:${(xp / 110) * 100}%" data-tip="day ${d} · ${xp} XP · ${Math.floor(xp * 1.5)} holding 10K $POLARIS"></i>`;
  }).join("");
}
xpCurve(1);

// ---------- drop-down shell: commands drive the terminal; nothing here signs on its own ----------
const VIEWS = { radar: "radar", drift: "radar", vaults: "vaults", vault: "vaults", beacon: "beacon" };
const findVault = (name) => V?.ranked.find((v) => v.name.toLowerCase() === String(name).toLowerCase());
const view = (tab) => { if (location.hash.slice(1) !== tab) { location.hash = tab; route(); } };
function prepare(m, amt, name, out) {
  if (!V?.ranked.length) return out("vaults are still loading", "dim");
  if (name && !findVault(name)) return out(`no vault named ${esc(name)} · try ${V.ranked.map((v) => v.name.toLowerCase()).join(", ")}`, "err");
  if (amt !== "max" && !(+amt > 0)) return out(`usage: ${m === "dep" ? "deposit <amount>" : "withdraw <amount|max>"} [vault]`, "err");
  view("vaults");
  if (name) chosen = findVault(name);
  mode = m;
  if (amt === "max") { if (!bal) return out("connect a wallet first · run connect", "err"); $("#maxBtn").click(); }
  else { $("#amt").value = amt; maxMode = false; }
  renderForm(); drawChart();
  if (name) vaults(); // re-rank so the rows and the orbit show the new pick
  const go = $("#goBtn");
  go.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
  go.classList.remove("nudge"); void go.offsetWidth; go.classList.add("nudge");
  out(`${m === "dep" ? "deposit" : "withdrawal"} of <b>${esc(amt)} ${A.symbol}</b> ${m === "dep" ? "into" : "from"} <b>${esc(chosen.name)}</b> is set up · press <b>${esc(go.textContent)}</b> to sign it in your wallet`);
}
const SH_HELP = [
  ["cd radar|vaults|beacon", "switch instrument (or 1, 2, 3)"],
  ["top [n]", "strongest newborn tokens"],
  ["token <symbol>", "lock a token on the radar"],
  ["sort score|new|holders", "re-sort the drift table"],
  ["vaults · vault <name>", "rank the vaults, pick one"],
  ["deposit <amt> [vault]", "fill in a deposit, you sign it"],
  ["withdraw <amt|max> [vault]", "fill in a withdrawal"],
  ["drip · ping", "testnet pUSD faucet, beacon check-in"],
  ["xp <day>", "what a ping earns on streak day n"],
  ["connect · whoami", "your wallet session"],
  ["tour · theme · clear", "walkthrough, colours, clean screen"],
];
const sh = mountConsole($("#qc"), {
  prompt: () => `${$("#whoami").textContent}:~/${$("#pageTitle").textContent}$`,
  commands: {
    help: (_, out) => {
      out("<b>polaris shell</b> · commands drive the terminal · tab completes · esc closes");
      SH_HELP.forEach(([c, d]) => out(`<span class="hc">${esc(c)}</span><span class="dim">${esc(d)}</span>`, "help"));
    },
    cd: ([v], out) => { const tab = VIEWS[String(v).toLowerCase()]; if (!tab) return out("usage: cd radar|vaults|beacon", "err"); view(tab); out(`~/${tab}`, "dim"); },
    top: ([n], out) => {
      if (!tokens.length) return out("the drift is still loading", "dim");
      view("radar");
      out(`<span class="dim">${esc(pad("#", 4) + pad("SYMBOL", 12) + pad("NS", 5) + pad("AGE", 6) + pad("HOLDERS", 9))}PULL</span>`);
      tokens.slice(0, Math.max(1, Math.min(20, +n || 8))).forEach((t, i) => out(`${esc(pad(i + 1, 4))}<b>${esc(pad("$" + t.symbol, 11))}</b> ${esc(pad(t.score, 5) + pad(age(t.ageMin), 6) + pad(int(t.holders) ?? "1", 9))}${meter(t.score / tokens[0].score, innerWidth < 560 ? 6 : 12)}`));
      out(`<span class="dim">try <b>token ${esc(tokens[0].symbol)}</b></span>`);
    },
    token: ([sym], out) => {
      const want = String(sym ?? "").replace(/^\$/, "").toLowerCase(), t = want && tokens.find((x) => x.symbol.toLowerCase() === want);
      if (!t) return out(want ? `no $${esc(want)} in the drift window` : "usage: token <symbol>", "err");
      view("radar");
      detail(t);
      $(".radar-panel").scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
      const f = t.f || northScore(t).f;
      out(`<b>${esc(t.name)} · $${esc(t.symbol)}</b>  North Score <b>${t.score}</b> · locked on the radar`);
      [["holders", f.holders], ["mint activity", f.activity], ["freshness", f.fresh], ["source", f.trust]].forEach(([k, v]) => out(`  ${esc(pad(k, 15))}${meter(v)} ${Math.round(v * 100)}`));
    },
    sort: ([k], out) => {
      const s = { score: "score", new: "age", newest: "age", age: "age", holders: "holders" }[String(k).toLowerCase()];
      if (!s) return out("usage: sort score|new|holders", "err");
      view("radar");
      $(`#sortSeg [data-s="${s}"]`).click();
      out(`drift table sorted by ${s === "age" ? "newest" : s}`, "dim");
    },
    vaults: (_, out) => {
      view("vaults");
      if (!V?.ranked.length) return out("vaults are still loading", "dim");
      out(`<span class="dim">${esc(pad("#", 4) + pad("VAULT", 10) + pad("APY", 9) + pad("TVL", 10))}SCORE</span>`);
      V.ranked.forEach((x, i) => out(`${esc(pad(i + 1, 4))}<b>${esc(pad(x.name, 10))}</b>${esc(pad(pct(x.apy), 9) + pad(usd(x.tvl) ?? "-", 10) + x.score.toFixed(2))}${x === V.pick ? " <b>★ north pick</b>" : ""}`));
    },
    vault: ([name], out) => {
      const v = findVault(name);
      if (!v) return out(`usage: vault ${V?.ranked.map((x) => x.name.toLowerCase()).join("|") || "<name>"}`, "err");
      view("vaults");
      pickVault(v);
      out(`selected <b>${esc(v.name)}</b> · ${pct(v.apy)} APY`);
    },
    deposit: ([amt, name], out) => prepare("dep", amt, name, out),
    withdraw: ([amt, name], out) => prepare("wd", amt, name, out),
    drip: (_, out) => {
      if (!$("#dripBtn")) return out("the pUSD faucet only runs on testnet", "err");
      view("vaults");
      if (!wallet.account) { openWalletModal(); return out("connect a wallet to claim", "dim"); }
      $("#dripBtn").click();
      out("claim sent to your wallet for signing", "dim");
    },
    ping: (_, out) => {
      view("beacon");
      if (!wallet.account) { openWalletModal(); return out("connect a wallet to ping", "dim"); }
      if ($("#pingBtn").disabled) return out("already pinged today · the next ping opens after UTC midnight", "dim");
      $("#pingBtn").click();
      out("ping sent to your wallet for signing", "dim");
    },
    xp: ([d], out) => {
      const day = Math.max(1, Math.floor(+d) || 1), xp = xpFor(day);
      out(`streak day ${day} earns <b>${xp} XP</b> a ping · <b>${Math.floor(xp * 1.5)} XP</b> holding 10K $POLARIS`);
      out(`  ${meter(xp / 110, 22)} ${day >= 21 ? "capped from day 21" : `${21 - day} more day${day === 20 ? "" : "s"} to the cap`}`);
    },
    connect: (_, out) => { openWalletModal(); out("opening wallet picker", "dim"); },
    whoami: (_, out) => out(wallet.account ? `observer <b>${short(wallet.account)}</b> · ${wallet.chainOk ? "on " + esc(CONFIG.chain.name) : "wrong network"}` : "guest · run <b>connect</b> to sign in with a wallet"),
    tour: () => { shell(false); runTour(); },
    theme: (_, out) => { $("#theme").click(); out(`theme: ${document.documentElement.dataset.theme || "dark"}`, "dim"); },
    clear: () => sh.clear(),
    sudo: (_, out) => out("permission denied: Polaris answers to no one", "err"),
  },
});
let shellOpened = false;
function shell(on = !$("#qc").classList.contains("on")) {
  const qc = $("#qc"), input = $("#qcIn");
  qc.classList.toggle("on", on);
  qc.setAttribute("aria-hidden", String(!on));
  $("#qcOpen").setAttribute("aria-expanded", String(on));
  if (on) {
    input.focus({ preventScroll: true });
    if (!shellOpened) { shellOpened = true; sh.run("help"); }
  } else if (document.activeElement === input) input.blur();
}
$("#qcOpen").addEventListener("click", () => shell());

// ---------- walkthrough: first visit, or ? / the tour command ----------
const TOUR = [
  { title: "Welcome to the terminal", text: "Polaris reads Robinhood Chain live: every newborn token, the stablecoin vaults and a daily on-chain check-in. Here is a 30 second tour. Leave any time with Got it." },
  { target: "#qcOpen", title: "This is a real shell", text: "Click the prompt or press / to drop the shell down. Try top, token, vault or deposit 1000. Commands move the terminal for you; anything on-chain still waits for your signature." },
  { target: ".side-nav", title: "Three instruments", text: "Drift Radar, North Vaults and the Beacon. Switch here or with the keys 1, 2 and 3." },
  { target: ".stats", title: "The pulse", text: "Live counters. Hover the bars under Born in the last hour to see how many tokens were born in each of the last 24 hours." },
  { target: ".radar-panel", title: "The Drift Radar", text: "Every token born in the last 48 hours is a blip. The closer to Polaris at the centre, the stronger its North Score. Hover to read one, click to lock on." },
  { target: "#detail", title: "Why it scores", text: "The locked token's North Score split into holders, mint activity, freshness and source, all read from chain data." },
  { target: ".table-panel", title: "Every newborn, ranked", text: "Sort by score, age or holders. Hover a row and the radar draws a bearing to it; walk the list with j and k." },
  { target: ".side-foot", title: "tail -f", text: "Everything the terminal sees lands here as it happens: head blocks, newborn tokens, your transactions." },
  { target: ".status", title: "Status line", text: "Network, head block, RPC round trip and UTC time. A red dot means the RPC stopped answering and Polaris is retrying." },
  { target: "#walletBtn", title: "Connect to act", text: "Reading is free. Connect a wallet to deposit into the North Vaults and ping the Beacon. Every action is signed in your own wallet." },
];
function runTour() {
  shell(false);
  const was = location.hash.slice(1) || "radar"; // the tour walks the radar, then hands back the page you were on
  startTour(TOUR, { onStart: () => { view("radar"); scrollTo(0, 0); }, onEnd: () => view(was) });
}
$("#tourBtn").addEventListener("click", runTour);
if (!seenTour()) setTimeout(runTour, 900);

onWallet(() => {
  const who = wallet.account ? short(wallet.account) : "guest";
  if ($("#whoami").textContent !== who + "@polaris") log(wallet.account ? `session <b>${who}</b>` : "session: guest", "dim");
  $("#whoami").textContent = who + "@polaris";
  balances(); beacon(); board();
});
