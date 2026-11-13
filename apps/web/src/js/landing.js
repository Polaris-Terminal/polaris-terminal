import {
  CONFIG, $, $$, esc, boot, smoothScroll, api, rpc, setText, tween, compact, usd, int, pct, age, short, copy, toast, friendly,
  wallet, onWallet, openWalletModal, sendTx, sel, explorerAddr, TICK, ICON,
} from "./core.js";
import { mountRadar } from "./radar.js";
import { lineChart, projection } from "./chart.js";
import { loadVaults, loadBeacon } from "./chain.js";
import { northScore } from "./score.js";

boot();
const net = CONFIG.testnet ? "Testnet" : "Mainnet";
$$("[data-net-tag]").forEach((el) => (el.textContent = el.closest(".legal") ? CONFIG.chain.name : net));
$$("[data-explorer]").forEach((a) => (a.href = CONFIG.chain.explorer));
$$("[data-faucet]").forEach((a) => (CONFIG.chain.faucet ? (a.href = CONFIG.chain.faucet) : a.closest("li").remove()));
const logDate = new Date(CONFIG.deployedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
$$("[data-date]").forEach((el) => (el.textContent = logDate));

// ---------- hero star ----------
let pings = 1;
import("./star3d.js")
  .then(({ mountStar }) => {
    const star = mountStar($("#sky"), { onPing: () => tween("#pingCount", ++pings) });
    addEventListener("scroll", () => star.setScroll(Math.min(1, scrollY / innerHeight)), { passive: true });
  })
  .catch((e) => console.warn("webgl", e));

// ---------- motion ----------
addEventListener("load", () => {
  smoothScroll();
  if (!window.gsap) return $$(".reveal").forEach((el) => el.classList.remove("reveal"));
  gsap.registerPlugin(ScrollTrigger);
  gsap.from(".hero-copy > *", { opacity: 0, y: 10, duration: 0.5, stagger: 0.05, ease: "power3.out" });
  ScrollTrigger.batch(".reveal", {
    start: "top 88%",
    once: true,
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power3.out" }),
  });
});

// ---------- live block ----------
async function block() {
  try { tween("#hBlock", Number(BigInt(await rpc("eth_blockNumber")))); } catch { /* keep last value */ }
}
block();
setInterval(block, 4000);

// ---------- pulse ----------
function pulse() {
  api("/api/pulse", (p) => {
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
const radar = mountRadar($("#radar"), { tip: $("#radarTip"), onSelect: showToken });

function showToken(t) {
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
  radar.select(t);
}

function drift() {
  api("/api/drift?limit=60", (d) => {
    if (!d?.tokens?.length) return;
    radar.set(d.tokens);
    tween("#dHour", d.born1h || d.born24h);
    if (!d.born1h) setText($("#dHour").previousElementSibling, "Born in the last 24h");
    tween("#dTracked", d.tracked);
    $("#pullers").innerHTML = d.tokens.slice(0, 5).map((t, i) => `<a class="puller" href="${CONFIG.chain.explorer}/token/${t.address}" target="_blank" rel="noopener"><span class="num muted">${i + 1}</span><b>$${esc(t.symbol)}</b><span class="bar${i ? "" : " lead"}"><i style="--w:${(t.score / d.tokens[0].score) * 100}%"></i></span><span class="num">${t.score}</span></a>`).join("");
    setText("#dTop", "$" + d.tokens[0].symbol);
    if (!$("#tokenCard").dataset.set) { $("#tokenCard").dataset.set = 1; showToken(d.tokens[0]); }
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
  const dayName = (k) => new Date((today - (lit ? lit - 1 : 0) + k) * 864e5).toLocaleDateString("en-US", { weekday: "short" });
  const nodes = NODES.map(([x, y], i) => `<circle class="node${i < lit ? " lit" : ""}${me?.pingedToday && i === lit - 1 ? " today" : ""}" cx="${x}" cy="${y}" r="${i < lit ? 8 : 6}"/><text x="${x}" y="${y + 28}" text-anchor="middle">${dayName(i)}</text>`).join("");
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
function board() {
  api("/api/beacon", (d) => {
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
  token: "$POLARIS, fixed supply, ERC-20 with permit",
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

// ---------- token ----------
const tokenAddr = CONFIG.contracts.find((c) => c.key === "token")?.proxy;
if (tokenAddr) {
  $("#caAddr").textContent = tokenAddr;
  $("#caLink").href = `${CONFIG.chain.explorer}/token/${tokenAddr}`;
  $("#caCopy").addEventListener("click", (e) => copy(tokenAddr, e.currentTarget));
}
