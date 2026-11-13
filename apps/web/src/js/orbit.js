// Orbit (v2.0): score history, clusters, deployer profiles, watchlist alerts, launchpad coverage,
// stock-pair integrity, the track record and the holder tier. Every value comes from the signal API,
// which reads it from chain data; chain strings are escaped before they reach innerHTML.
import { CONFIG, $, $$, esc, setText, tween, int, short, age, toast, store, wallet, onWallet, explorerAddr } from "./core.js";
import { lineChart } from "./chart.js";
import { pad, meter } from "./console.js";

const get = (path) => fetch(CONFIG.api + path, { signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
const ago = (ms) => age(Math.max(1, (Date.now() - ms) / 60e3)) + " ago";
const pctTxt = (p) => (p >= 10 ? Math.round(p) : p.toFixed(1)) + "%";
const share = (f) => (f > 0 ? pctTxt(f * 100) : "none"); // never print a bare 0
const tokenLink = (a) => `${CONFIG.chain.explorer}/token/${a}`;
const KIND = { liquidity: "liquidity", sell: "deployer sell", drop: "score drop" };

export function mountOrbit({ log, view, tokens, lock }) {
  // ---------- holder tier ----------
  let tier = { tier: "public", watch: 5, historyH: 6, poll: 60, min: 10_000 };
  const holderQ = () => (wallet.account && tier.tier === "holder" ? `&holder=${wallet.account}` : "");
  async function refreshTier() {
    tier = wallet.account ? await get(`/api/tier?a=${wallet.account}`).catch(() => tier) : { ...tier, tier: "public", watch: 5, historyH: 6, poll: 60 };
    const h = tier.tier === "holder";
    setText("#wTier", h ? "Holder" : "Public");
    setText("#wTierD", h ? `${int(tier.min)}+ $POLARIS in this wallet` : wallet.account ? `hold ${int(tier.min)} $POLARIS to upgrade` : "connect a wallet to check");
    $$("[data-tier-row]").forEach((r) => r.classList.toggle("on", r.dataset.tierRow === tier.tier));
    renderWatch();
    restartAlerts();
  }

  // ---------- watchlist (this browser only, per network) ----------
  const WKEY = "polaris-watch:" + CONFIG.network, SKEY = "polaris-seen:" + CONFIG.network;
  let watch = store.get(WKEY) || [], seen = store.get(SKEY) || {}, feed = [], last = {};
  const watching = (a) => watch.some((w) => w.address === a);
  function toggleWatch(t) {
    if (watching(t.address)) {
      watch = watch.filter((w) => w.address !== t.address);
      toast(`Stopped watching $${t.symbol}`);
    } else {
      if (watch.length >= tier.watch) return toast(tier.tier === "holder" ? `Watchlist full at ${tier.watch}` : `Public watchlists hold ${tier.watch}. Holders get 25`, true), false;
      watch.push({ address: t.address, symbol: t.symbol, name: t.name });
      seen[t.address] = Date.now(); // only alert on what happens from now on
      toast(`Watching $${t.symbol}. Alerts on liquidity, deployer sells and score drops`);
      log(`watch <b>$${esc(t.symbol)}</b>`);
    }
    store.set(WKEY, watch); store.set(SKEY, seen);
    renderWatch(); paintWatchBtn(); pollAlerts();
    return true;
  }

  let notifyOn = typeof Notification !== "undefined" && Notification.permission === "granted";
  function paintNotify() {
    const b = $("#wNotify");
    if (typeof Notification === "undefined") { b.textContent = "Not supported"; b.disabled = true; return; }
    b.textContent = notifyOn ? "Desktop alerts on" : Notification.permission === "denied" ? "Blocked in browser" : "Turn on desktop alerts";
    b.disabled = notifyOn || Notification.permission === "denied";
    setText("#wNote", notifyOn ? "On" : "In-app");
    setText("#wNoteD", notifyOn ? "desktop and in-app" : "toasts while this tab is open");
  }
  $("#wNotify").addEventListener("click", async () => { notifyOn = (await Notification.requestPermission()) === "granted"; paintNotify(); });

  function renderWatch() {
    setText("#wCount", `${watch.length} / ${tier.watch}`);
    setText("#nWatch", watch.length ? String(watch.length) : null);
    const rows = $("#wRows");
    if (!watch.length) {
      const pick = tokens().slice(0, 3);
      rows.innerHTML = `<p class="hint">Pin a token from the radar with <b>Watch</b>, or type <b>watch &lt;symbol&gt;</b> in the shell. Strong pulls right now:</p>` +
        pick.map((t) => `<div class="wrow"><span class="tk"><b>${esc(t.name)}</b><small>$${esc(t.symbol)}</small></span><span class="num">NS ${t.score}</span><span>${int(t.holders) ?? "first"} holders</span><span></span><button class="btn btn-ghost btn-sm" data-w="${t.address}">Watch</button></div>`).join("");
      $$("[data-w]", rows).forEach((b) => b.addEventListener("click", () => toggleWatch(tokens().find((t) => t.address === b.dataset.w))));
      return;
    }
    rows.innerHTML = watch.map((w) => {
      const s = last[w.address], ev = s?.events?.at(-1);
      return `<div class="wrow" data-a="${w.address}">
        <span class="tk"><b>${esc(s?.name || w.name)}</b><small>$${esc(s?.symbol || w.symbol)}</small></span>
        <span class="num">${s?.tracked === false ? "left window" : s ? "NS " + s.score : "reading"}</span>
        <span>${s?.cluster ? `<i class="lvl ${s.cluster}">${s.cluster}</i>` : ""}</span>
        <span class="dim">${ev ? `${esc(KIND[ev.kind])} · ${ago(ev.at)}` : "quiet so far"}</span>
        <button class="btn btn-ghost btn-sm" data-u="${w.address}">Unwatch</button></div>`;
    }).join("");
    $$("[data-u]", rows).forEach((b) => b.addEventListener("click", () => toggleWatch(watch.find((w) => w.address === b.dataset.u))));
    $$(".wrow[data-a]", rows).forEach((r) => r.addEventListener("click", (e) => { if (!e.target.closest("button")) lock(r.dataset.a); }));
  }

  function renderFeed() {
    const box = $("#wFeed");
    const day = feed.filter((e) => Date.now() - e.at < 864e5).length;
    if (day) tween("#wAlerts", day); else setText("#wAlerts", "Quiet");
    box.innerHTML = feed.length
      ? feed.slice(0, 40).map((e) => `<div class="frow ${e.kind}"><span class="t">${ago(e.at)}</span><b>$${esc(e.symbol)}</b><span>${esc(e.text)}</span></div>`).join("")
      : `<p class="hint">Alerts land here: <b>liquidity opened</b> when a pool is seeded, <b>deployer sold</b> when the creator sells into a pool, and <b>score drop</b> when the North Score falls 15 points under its last-hour high.</p>`;
  }

  async function pollAlerts() {
    if (!watch.length) { feed = []; renderFeed(); return; }
    const d = await get(`/api/alerts?a=${watch.map((w) => w.address).join(",")}${holderQ()}`).catch(() => null);
    if (!d) return;
    const fresh = [];
    feed = [];
    for (const t of d.tokens) {
      last[t.address] = t;
      for (const e of t.events || []) {
        const item = { ...e, symbol: t.symbol, address: t.address };
        feed.push(item);
        if (e.at > (seen[t.address] || 0)) fresh.push(item);
      }
      if (t.events?.length) seen[t.address] = Math.max(seen[t.address] || 0, t.events.at(-1).at);
    }
    feed.sort((a, b) => b.at - a.at);
    store.set(SKEY, seen);
    for (const e of fresh.slice(-5)) {
      toast(`$${e.symbol}: ${e.text}`, e.kind !== "liquidity");
      log(`alert <b>$${esc(e.symbol)}</b> ${esc(e.text)}`, e.kind === "liquidity" ? "ok" : "err");
      if (notifyOn && document.hidden) new Notification(`$${e.symbol} · Polaris`, { body: e.text, icon: "/assets/favicon.png", tag: e.address + e.at });
    }
    renderWatch(); renderFeed();
  }
  let alertTimer = null;
  function restartAlerts() { clearInterval(alertTimer); alertTimer = setInterval(pollAlerts, tier.poll * 1000); setText("#wPoll", `every ${tier.poll}s`); }

  // ---------- token detail: history, signals, watch ----------
  let current = null, detailReq = 0;
  function paintWatchBtn() {
    const b = $("#dWatch");
    if (!current) return;
    b.textContent = watching(current.address) ? "Watching" : "Watch";
    b.classList.toggle("on", watching(current.address));
  }
  async function detail(t) {
    current = t;
    paintWatchBtn();
    const stock = t.stock;
    $("#dTags").innerHTML = [
      t.launchpad ? `<span class="chip-s">${esc(t.launchpadLabel || "launchpad " + short(t.launchpad))}</span>` : `<span class="chip-s">direct deploy</span>`,
      stock && (stock.official ? `<span class="chip-s ok">official ${esc(stock.ticker)} stock token</span>` : `<span class="chip-s bad">imitates ${esc(stock.ticker)}</span>`),
    ].filter(Boolean).join("");
    const n = ++detailReq;
    const d = await get(`/api/token?a=${t.address}${holderQ()}`).catch(() => null);
    if (n !== detailReq || !d?.tracked) return;
    const pts = d.history.map((p) => ({ x: p.t, y: p.score, h: p.holders }));
    if (pts.length > 1) {
      lineChart($("#dHist"), {
        points: pts,
        fmtX: (x) => (Date.now() - x < 90e3 ? "now" : ago(x).replace(" ago", "")),
        fmtY: (y) => "NS " + Math.round(y),
        tipHtml: (p) => `${p.x > Date.now() - 90e3 ? "now" : ago(p.x)} · <b>NS ${p.y}</b> · ${int(p.h) ?? "first"} holders`,
      });
    }
    setText("#dHistR", d.tier === "holder" ? `${d.historyHours}h · holder tier` : `last ${d.historyHours}h · holders see 48h`);
    const c = d.cluster, cr = d.creator;
    const rows = [
      c && ["Cluster", `<i class="lvl ${c.level}">${c.level}</i> ${c.wallets ? `${c.wallets} linked wallets hold ${share(c.share / 100)}` : c.level === "clear" ? "no bundle or split found" : "supply sits in a few wallets"}`],
      c && ["Top 10 hold", share(c.top10 / 100) + " of supply"],
      c?.bundle && ["Launch bundle", `${c.bundle} wallets bought in the first 30s · ${share(c.bundleShare / 100)} still held`],
      cr && t.creator && ["Deployer", cr.soldPct ? `sold ${pctTxt(cr.soldPct)} into pools` : cr.holdPct ? `still holds ${pctTxt(cr.holdPct)}` : "holds none, sold none"],
      ["Pools", d.pools.length ? d.pools.map((p) => esc(p.venue || p.kind)).join(", ") : "no pool yet"],
      d.events.length && ["Last event", `${esc(d.events.at(-1).text)} · ${ago(d.events.at(-1).at)}`],
    ].filter(Boolean);
    $("#dSig").innerHTML = rows.map(([k, v]) => `<div><dt class="label">${k}</dt><dd>${v}</dd></div>`).join("");
    if (d.capped) $("#dSig").insertAdjacentHTML("beforeend", `<div><dt class="label">History</dt><dd>past the 10k transfer read limit</dd></div>`);
  }
  $("#dWatch").addEventListener("click", () => current && toggleWatch(current));
  $("#dDep").addEventListener("click", () => current?.creator && deployer(current.creator));

  // ---------- deployer profile ----------
  async function deployer(a) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(a || "")) return toast("Paste a 0x wallet address", true);
    $("#depIn").value = a; // before the view switch, so its route does not start a second read
    view("deployer");
    setText("#depHead", short(a));
    $("#depRows").innerHTML = `<p class="hint">Reading every launch from ${esc(short(a))}…</p>`;
    const d = await get(`/api/deployer?a=${a}`).catch(() => null);
    if (!d) return ($("#depRows").innerHTML = `<p class="hint">The signal API did not answer. Try again in a moment</p>`);
    log(`deployer <b>${short(a)}</b> · ${d.launchesSeen} launch${d.launchesSeen === 1 ? "" : "es"}`);
    setText("#depN", String(d.launches48h || d.launchesSeen || "None live"));
    setText("#depND", `${d.launchesSeen} seen in total`);
    setText("#depAvg", d.avgScore ? "NS " + d.avgScore : "Past only");
    setText("#depOut", `${d.outcomes.thrived} / ${d.outcomes.rugged}`);
    setText("#depW", `${d.nonce.toLocaleString("en-US")} tx`);
    setText("#depWD", `${d.eth.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH in the wallet`);
    $("#depLink").href = explorerAddr(a);
    $("#depTags").innerHTML = (d.tags.length ? d.tags : ["no red flags in what Polaris has seen"]).map((g) => `<span class="chip-s${/rug|sold/.test(g) ? " bad" : /thriv/.test(g) ? " ok" : ""}">${esc(g)}</span>`).join("");
    const live = d.launches.map((l) => `<div class="drow" data-a="${l.address}"><span class="tk"><b>${esc(l.name)}</b><small>$${esc(l.symbol)}</small></span><span>${age(l.ageMin)}</span><span class="num">NS ${l.score}</span><span>${int(l.holders) ?? "first"}</span><span>${l.soldPct == null ? "reading" : l.soldPct ? pctTxt(l.soldPct) : "none"}</span><span>${l.cluster ? `<i class="lvl ${l.cluster}">${l.cluster}</i>` : "pending"}</span></div>`);
    const past = d.past.map((g) => `<div class="drow past"><span class="tk"><b>${esc(g.name)}</b><small>$${esc(g.symbol)}</small></span><span>${ago(g.bornAt)}</span><span class="num">NS ${g.early}</span><span>${int(g.holders24h) ?? "none"}</span><span>${g.sold24h ? pctTxt(g.sold24h) : "none"}</span><span><i class="out ${g.outcome}">${g.outcome}</i></span></div>`);
    $("#depRows").innerHTML = live.concat(past).join("") || `<p class="hint">No launch from this wallet in the last 48 hours. Polaris keeps graded launches for 30 days</p>`;
    $$("#depRows .drow[data-a]").forEach((r) => r.addEventListener("click", () => lock(r.dataset.a)));
  }
  $("#depForm").addEventListener("submit", (e) => { e.preventDefault(); deployer($("#depIn").value.trim()); });

  // ---------- track record ----------
  async function record() {
    const d = await get("/api/record").catch(() => null);
    if (!d) return;
    const hi = d.bands.slice(3).reduce((s, b) => ({ n: s.n + b.n, k: s.k + b.thrived * b.n }), { n: 0, k: 0 });
    const lo = d.bands[0];
    tween("#recN", d.graded);
    setText("#recND", d.pending ? `${d.pending} more being graded` : `graded ${d.horizonH}h after birth`);
    setText("#recHi", hi.n ? share(hi.k / hi.n) : "Grading");
    setText("#recLo", lo.n ? share(lo.rugged) : "Grading");
    setText("#nRecord", d.graded ? String(d.graded) : null);
    $("#recBands").innerHTML = d.bands.map((b) => `<div class="brow"><span class="num">NS ${b.band}</span><span class="num">${b.n}</span>
      <span class="stack" title="thrived ${share(b.thrived)} · faded ${share(b.faded)} · rugged ${share(b.rugged)}">${b.n ? `<i class="thrived" style="--w:${b.thrived * 100}%"></i><i class="faded" style="--w:${b.faded * 100}%"></i><i class="rugged" style="--w:${b.rugged * 100}%"></i>` : `<em>no tokens in this band yet</em>`}</span>
      <span class="num">${b.n ? share(b.thrived) : "next"}</span><span class="num">${b.n ? share(b.rugged) : "next"}</span><span class="num">${b.n ? b.medianHolders || "none" : "next"}</span></div>`).join("");
    $("#recRows").innerHTML = d.recent.map((g) => `<div class="drow past"><span class="tk"><b>${esc(g.name)}</b><small>$${esc(g.symbol)}</small></span><span>${ago(g.bornAt)}</span><span class="num">NS ${g.early}</span><span>${g.holders1h} → ${g.holders24h}</span><span>${g.sold24h ? pctTxt(g.sold24h) : "none"}</span><span><i class="out ${g.outcome}">${g.outcome}</i></span></div>`).join("")
      || `<p class="hint">The grader is replaying tokens older than a day. The first grades land within minutes</p>`;
  }

  // ---------- launchpads, venues and stock-pair integrity ----------
  let pads = null;
  async function venues() {
    const [l, s] = await Promise.all([get("/api/launchpads").catch(() => null), get("/api/integrity").catch(() => null)]);
    if (l) {
      pads = l;
      tween("#venPads", l.launchpads.length);
      tween("#venVenues", l.venues.length);
      tween("#venPools", l.pools);
      setText("#nVenues", String(l.launchpads.length));
      $("#padRows").innerHTML = l.launchpads.slice(0, 30).map((p) => `<button class="vrow" data-pad="${p.address || "direct"}"><span class="tk"><b>${esc(p.label || short(p.address))}</b>${p.label && p.address ? `<small>${esc(short(p.address))}</small>` : ""}</span><span class="num">${p.tokens}</span><span class="num">${p.born24h || "older"}</span><span class="num">NS ${p.avgScore}</span><span class="ell">${p.top ? `$${esc(p.top.symbol)} · ${p.top.score}` : ""}</span></button>`).join("");
      $$("#padRows [data-pad]").forEach((b) => b.addEventListener("click", () => filterPad(b.dataset.pad)));
      $("#venRows").innerHTML = l.venues.slice(0, 30).map((v) => `<a class="vrow" href="${explorerAddr(v.factory)}" target="_blank" rel="noopener"><span class="tk"><b>${esc(v.label || short(v.factory))}</b>${v.label ? `<small>${esc(short(v.factory))}</small>` : ""}</span><span class="num">${v.kind}</span><span class="num">${v.pools}</span><span class="num">${v.pools24h || "older"}</span><span class="num">${v.drift || "none"}</span></a>`).join("");
      const sel = $("#padSel"), keep = sel.value;
      sel.innerHTML = `<option value="">All launchpads</option>` + l.launchpads.map((p) => `<option value="${p.address || "direct"}">${esc(p.label || (p.address ? "launchpad " + short(p.address) : "Direct deploy"))} · ${p.tokens}</option>`).join("");
      sel.value = keep;
    }
    if (s) {
      setText("#venStocks", String(s.official));
      setText("#venStocksD", CONFIG.testnet ? "canonical testnet stock tokens" : "canonical contracts in Robinhood's registry");
      $("#pairRows").innerHTML = s.pairs.length
        ? s.pairs.map((p) => `<a class="prow ${p.verdict}" href="${explorerAddr(p.pool)}" target="_blank" rel="noopener"><span><b>${p.sides.map((x) => esc(x.symbol || short(x.address))).join(" / ")}</b></span><span>${esc(p.venue || p.kind)}</span><span>${ago(p.openedAt)}</span><span><i class="verdict ${p.verdict}">${p.verdict === "official" ? "canonical" : "imitation"}</i></span></a>`).join("")
        : `<p class="hint">No pool in the last 48 hours pairs a stock ticker. Polaris checks every new pool against the canonical contracts the moment it opens</p>`;
      $("#fakeRows").innerHTML = s.imitations.length
        ? s.imitations.map((t) => `<a class="prow imitation" href="${tokenLink(t.address)}" target="_blank" rel="noopener"><span><b>$${esc(t.symbol)}</b> ${esc(t.name)}</span><span>claims ${esc(t.stock.ticker)}</span><span>${ago(t.bornAt)}</span><span><i class="verdict imitation">not canonical</i></span></a>`).join("")
        : `<p class="hint">No newborn token in the window is using a stock ticker</p>`;
    }
  }
  let padFilter = "";
  function filterPad(p) {
    padFilter = p;
    $("#padSel").value = p;
    view("radar");
    dispatchEvent(new CustomEvent("polaris:pad", { detail: p }));
    const name = $(`#padSel option[value="${p}"]`)?.textContent.replace(/ · \d+$/, "") || "all launchpads";
    log(`radar filter → <b>${esc(name)}</b>`);
  }
  $("#padSel").addEventListener("change", (e) => filterPad(e.target.value));

  // ---------- views ----------
  function route(tab) {
    if (tab === "watch") { renderWatch(); renderFeed(); pollAlerts(); }
    if (tab === "record") record();
    if (tab === "venues") venues();
    if (tab === "deployer" && !$("#depIn").value && current?.creator) deployer(current.creator);
  }

  onWallet(() => refreshTier());
  paintNotify();
  renderWatch(); renderFeed();
  setTimeout(pollAlerts, 1500);
  venues(); record();
  setInterval(venues, 60_000);
  setInterval(record, 120_000);

  // ---------- shell ----------
  const find = (sym) => { const w = String(sym ?? "").replace(/^\$/, "").toLowerCase(); return w && tokens().find((t) => t.symbol.toLowerCase() === w); };
  const help = [
    ["watch <symbol> · unwatch", "pin a token, alerts on its moves"],
    ["alerts", "the watchlist feed"],
    ["deployer [address|symbol]", "a creator's launch history"],
    ["record", "how scores did a day later"],
    ["launchpads · stocks", "coverage and stock-pair checks"],
    ["tier", "your holder tier"],
  ];
  const commands = {
    watch: ([sym], out) => {
      const t = find(sym);
      if (!t) return out(sym ? `no $${esc(sym)} in the drift window` : "usage: watch <symbol>", "err");
      if (watching(t.address)) return out(`already watching $${esc(t.symbol)}`, "dim");
      if (toggleWatch(t)) out(`watching <b>$${esc(t.symbol)}</b> · ${watch.length}/${tier.watch} slots · checks ${tier.poll === 15 ? "every 15s" : "every minute"}`);
    },
    unwatch: ([sym], out) => {
      const w = watch.find((x) => x.symbol.toLowerCase() === String(sym ?? "").replace(/^\$/, "").toLowerCase());
      if (!w) return out("usage: unwatch <symbol>", "err");
      toggleWatch(w); out(`stopped watching $${esc(w.symbol)}`, "dim");
    },
    alerts: (_, out) => {
      view("watch");
      if (!watch.length) return out("the watchlist is empty · try <b>watch " + esc(tokens()[0]?.symbol || "<symbol>") + "</b>", "dim");
      if (!feed.length) return out(`watching ${watch.length} token${watch.length > 1 ? "s" : ""} · no events yet`, "dim");
      feed.slice(0, 8).forEach((e) => out(`${esc(pad(ago(e.at), 9))}<b>${esc(pad("$" + e.symbol, 11))}</b> ${esc(e.text)}`));
    },
    deployer: ([v], out) => {
      const a = /^0x[0-9a-fA-F]{40}$/.test(v || "") ? v : (find(v) || (!v && current))?.creator;
      if (!a) return out("usage: deployer <address|symbol>", "err");
      deployer(a); out(`reading launches from <b>${short(a)}</b>`, "dim");
    },
    record: async (_, out) => {
      view("record");
      const d = await get("/api/record").catch(() => null);
      if (!d?.graded) return out("the grader is still replaying day-old tokens", "dim");
      out(`<span class="dim">${esc(pad("SCORE AT 1H", 13) + pad("N", 6) + pad("THRIVED", 9) + pad("RUGGED", 8))}</span>`);
      d.bands.forEach((b) => out(`${esc(pad("NS " + b.band, 13) + pad(b.n, 6))}<b>${esc(pad(b.n ? share(b.thrived) : "next", 9))}</b>${esc(pad(b.n ? share(b.rugged) : "next", 8))}${meter(b.thrived, 10)}`));
    },
    launchpads: (_, out) => {
      view("venues");
      if (!pads) return out("coverage is still loading", "dim");
      pads.launchpads.slice(0, 8).forEach((p) => out(`<b>${esc(pad(p.label || short(p.address), 22))}</b>${esc(pad(p.tokens + " tokens", 12))}NS ${p.avgScore}`));
    },
    stocks: (_, out) => { view("venues"); $("#pairPanel").scrollIntoView({ block: "start" }); out("stock-pair integrity: every new pool checked against the canonical stock token contracts", "dim"); },
    tier: (_, out) => out(tier.tier === "holder"
      ? `<b>holder tier</b> · ${tier.watch} watch slots · alerts every ${tier.poll}s · ${tier.historyH}h score history`
      : `public tier · ${tier.watch} slots · alerts every ${tier.poll}s · ${tier.historyH}h history · hold ${int(tier.min)} $POLARIS for 25 slots, 15s alerts and 48h history`),
  };

  return { detail, route, commands, help, pad: () => padFilter };
}
