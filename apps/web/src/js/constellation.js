// Constellation (v3.0): custom rules over the Drift, portfolio scan, signal governance, the public API key
// and the score badge. Reads come from the signal API; signing is personal_sign only, it never moves funds.
import { CONFIG, $, $$, esc, setText, tween, int, short, age, toast, store, wallet, onWallet, openWalletModal, copy, explorerAddr } from "./core.js";
import { parseRule, SIGNALS, keyText, ballotText } from "./rules.js";
import { pad } from "./console.js";

const get = (path) => fetch(CONFIG.api + path, { signal: AbortSignal.timeout(30_000) }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))));
const post = (path, body) => fetch(CONFIG.api + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; });
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n >= 1 ? n.toFixed(1).replace(/\.0$/, "") : n > 0 ? n.toPrecision(2) : "dust");
const LABEL = { holders: "Holder spread", activity: "Mint activity", fresh: "Freshness", source: "Verified source", cluster: "Cluster detection", deployer: "Deployer history" };
const MAX_RULES = 8;

async function sign(text) {
  if (!wallet.account) { openWalletModal(); throw new Error("Connect a wallet first"); }
  const hex = "0x" + [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return wallet.provider.request({ method: "personal_sign", params: [hex, wallet.account] });
}

export function mountConstellation({ log, view, tokens, lock }) {
  const origin = location.origin;

  // ---------- custom rules (this browser only, per network) ----------
  const RKEY = "polaris-rules:" + CONFIG.network;
  let rules = store.get(RKEY) || [], active = "", picked = rules[0]?.text || "", hits = {}, known = {};
  const saveRules = () => store.set(RKEY, rules);
  function addRule(text) {
    let conds;
    try { conds = parseRule(text); } catch (e) { toast(e.message, true); return false; }
    const norm = String(text).trim().toLowerCase().replace(/\s*(>=|<=|!=|>|<|=)\s*/g, "$1").replace(/\s+/g, " ");
    if (rules.some((r) => r.text === norm)) { picked = norm; renderRules(); return true; }
    if (rules.length >= MAX_RULES) { toast(`Up to ${MAX_RULES} rules. Delete one first`, true); return false; }
    rules.push({ text: norm, at: Date.now() });
    picked = norm;
    saveRules();
    log(`rule <b>${esc(norm)}</b> · ${conds.length} condition${conds.length > 1 ? "s" : ""}`);
    pollRules();
    return true;
  }
  function dropRule(text) {
    rules = rules.filter((r) => r.text !== text);
    delete hits[text]; delete known[text];
    if (active === text) useRule("");
    if (picked === text) picked = rules[0]?.text || "";
    saveRules(); renderRules();
  }
  function useRule(text) {
    active = text;
    $("#ruleSel").value = text;
    setText("#ruOn", text ? "On" : "Off");
    dispatchEvent(new CustomEvent("polaris:rule", { detail: text }));
    log(`radar rule → <b>${esc(text || "none")}</b>`);
    renderRules();
  }
  $("#ruleSel").addEventListener("change", (e) => useRule(e.target.value));
  $("#ruleForm").addEventListener("submit", (e) => { e.preventDefault(); if (addRule($("#ruleIn").value)) $("#ruleIn").value = ""; });

  function renderRules() {
    setText("#ruCount", rules.length ? `${rules.length} / ${MAX_RULES}` : "None yet");
    setText("#nRules", rules.length ? String(rules.length) : null);
    const n = hits[picked]?.tracked;
    setText("#ruMatch", !rules.length ? "Write one" : !hits[picked] ? "Reading" : n ? int(n) : "None");
    const sel = $("#ruleSel");
    sel.innerHTML = `<option value="">No rule</option>` + rules.map((r) => `<option value="${esc(r.text)}">${esc(r.text)}</option>`).join("");
    sel.value = active;
    $("#ruRows").innerHTML = rules.length
      ? rules.map((r) => `<div class="wrow rrow${r.text === picked ? " on" : ""}" data-a="${esc(r.text)}"><code>${esc(r.text)}</code><span class="num">${hits[r.text] ? (int(hits[r.text].tracked) ?? "none") : "reading"}</span>
          <button class="btn btn-ghost btn-sm" data-use="${esc(r.text)}">${active === r.text ? "On radar" : "Radar"}</button><button class="btn btn-ghost btn-sm" data-del="${esc(r.text)}">Delete</button></div>`).join("")
      : `<p class="hint">A rule is a list of conditions every token must pass, like <b>score&gt;=60 holders&gt;=25 age&lt;6h !fake</b>. Numbers: score, holders, mints, age (m, h or d). Flags: verified, stock, fake, direct; put ! in front to negate. The same rule works on the public API as <b>/api/v1/drift?rule=</b></p>`;
    $$("[data-use]", $("#ruRows")).forEach((b) => b.addEventListener("click", () => { useRule(active === b.dataset.use ? "" : b.dataset.use); if (active) view("radar"); }));
    $$("[data-del]", $("#ruRows")).forEach((b) => b.addEventListener("click", () => dropRule(b.dataset.del)));
    $$(".rrow", $("#ruRows")).forEach((r) => r.addEventListener("click", (e) => { if (!e.target.closest("button")) { picked = r.dataset.a; renderRules(); } }));
    const d = hits[picked];
    setText("#ruHead", picked || "Pick a rule");
    $("#ruHits").innerHTML = !picked ? `<p class="hint">Add a rule above, or try one: <b>score&gt;=40 holders&gt;=10</b></p>`
      : !d ? `<p class="hint">Reading the Drift…</p>`
      : d.tokens.length ? d.tokens.slice(0, 30).map((t) => `<div class="wrow" data-a="${t.address}"><span class="tk"><b>${esc(t.name)}</b><small>$${esc(t.symbol)}</small></span><span class="num">NS ${t.score}</span><span>${int(t.holders) ?? "first"}</span><span class="dim">${age(t.ageMin)} old</span><span></span></div>`).join("")
      : `<p class="hint">Nothing in the 48h window passes this rule right now. Polaris checks again every minute and raises an alert on the first match</p>`;
    $$(".wrow[data-a]", $("#ruHits")).forEach((r) => r.addEventListener("click", () => lock(r.dataset.a)));
  }

  async function pollRules() {
    for (const r of rules) {
      const d = await get(`/api/drift?limit=100&rule=${encodeURIComponent(r.text)}`).catch(() => null);
      if (!d) continue;
      hits[r.text] = d;
      const now = new Set(d.tokens.map((t) => t.address));
      if (known[r.text]) {
        // new matches only: the first read of a rule just takes a baseline
        const fresh = d.tokens.filter((t) => !known[r.text].has(t.address));
        for (const t of fresh.slice(0, 3)) {
          toast(`$${t.symbol} now matches ${r.text}`);
          log(`rule <b>${esc(r.text)}</b> + <b>$${esc(t.symbol)}</b> · NS ${t.score}`, "ok");
        }
      }
      known[r.text] = now;
    }
    renderRules();
  }

  // ---------- portfolio scan ----------
  async function scan(a) {
    if (!isAddr(a)) return toast("Paste a 0x wallet address", true);
    $("#pfIn").value = a;
    view("portfolio");
    setText("#pfHead", short(a));
    $("#pfLink").href = explorerAddr(a);
    $("#pfRows").innerHTML = `<p class="hint">Reading ${esc(short(a))} against every token Polaris tracks…</p>`;
    const d = await get(`/api/portfolio?a=${a}`).catch(() => null);
    if (!d) return ($("#pfRows").innerHTML = `<p class="hint">The signal API did not answer. Try again in a moment</p>`);
    log(`scan <b>${short(a)}</b> · ${d.holdings.length} holding${d.holdings.length === 1 ? "" : "s"} · ${d.high} high risk`, d.high ? "err" : "");
    setText("#pfN", d.holdings.length ? String(d.holdings.length) : "None");
    setText("#pfND", `of ${int(d.known)} tokens checked`);
    for (const [id, n] of [["#pfHigh", d.high], ["#pfWatch", d.watch], ["#pfClear", d.clear]]) setText(id, n ? String(n) : "None");
    $("#pfRows").innerHTML = d.holdings.length
      ? d.holdings.map((h) => `<div class="drow"${h.kind === "drift" ? ` data-a="${h.address}"` : ""}><span class="tk"><b>${esc(h.name)}</b><small>$${esc(h.symbol)}</small></span>
          <span>${h.kind === "drift" ? age(h.ageMin) + " old" : h.kind === "stock" ? "stock token" : "graded"}</span>
          <span class="num">${h.share ? (h.share >= 0.01 ? h.share + "% supply" : fmt(h.balance)) : fmt(h.balance || 0)}</span>
          <span class="num">${h.score ? "NS " + h.score : h.stock?.official ? "canonical" : "next"}</span>
          <span><i class="lvl ${h.risk.level}">${h.risk.level}</i></span><span class="dim">${esc(h.risk.reasons.join(" · ") || "no red flag")}</span></div>`).join("")
      : `<p class="hint">This wallet holds none of the ${int(d.known)} tokens Polaris tracks: the 48h Drift, 30 days of graded launches and the canonical stock tokens</p>`;
    $$("#pfRows .drow[data-a]").forEach((r) => r.addEventListener("click", () => lock(r.dataset.a)));
  }
  $("#pfForm").addEventListener("submit", (e) => { e.preventDefault(); scan($("#pfIn").value.trim()); });

  // ---------- signal governance ----------
  let gov = null, ballot = null;
  function paintBallot() {
    const sum = SIGNALS.reduce((s, k) => s + ballot[k], 0);
    setText("#gvSum", `${sum} / 100`);
    $("#gvSum").style.color = sum === 100 ? "" : "var(--down)";
    $("#gvSign").disabled = sum !== 100;
    SIGNALS.forEach((k) => setText(`#gv-${k}`, String(ballot[k])));
  }
  function renderGov() {
    if (!gov) return;
    ballot ||= { ...(gov.mine?.ballot || gov.now) };
    tween("#gvN", gov.ballots);
    if (!gov.ballots) setText("#gvN", "Open");
    setText("#gvND", gov.voters ? `${gov.voters} wallet${gov.voters > 1 ? "s" : ""} holding $POLARIS` : "the first ballot sets the mix");
    setText("#gvW", gov.weight ? fmt(gov.weight) : "First vote");
    setText("#nCouncil", gov.ballots ? String(gov.ballots) : null);
    setText("#gvMe", gov.mine ? "Cast" : "Not cast");
    setText("#gvMeD", gov.mine ? `signed ${age((Date.now() - gov.mine.at) / 60e3)} ago` : wallet.account ? "move the sliders, then sign" : "connect a wallet to vote");
    $("#gvRows").innerHTML = `<div class="gv-row label"><span>Signal</span><span>Your points</span><span></span><span>Community · <b style="color:var(--warn)">|</b> today</span></div>` + SIGNALS.map((k) => `<div class="gv-row">
      <span>${LABEL[k]}</span><input type="range" min="0" max="100" step="5" value="${ballot[k]}" data-k="${k}" aria-label="${LABEL[k]} points"><span class="num" id="gv-${k}">${ballot[k]}</span>
      <span class="mix" title="community ${gov.mix[k]} · today ${gov.now[k]}"><i style="--w:${gov.mix[k]}%"></i><b style="--now:${gov.now[k]}%"></b><span>${gov.weight ? gov.mix[k] : "no votes"}</span></span></div>`).join("");
    $$("#gvRows input").forEach((i) => i.addEventListener("input", () => { ballot[i.dataset.k] = +i.value; paintBallot(); }));
    paintBallot();
  }
  async function loadGov() {
    gov = await get(`/api/governance${wallet.account ? "?a=" + wallet.account : ""}`).catch(() => gov);
    renderGov();
  }
  $("#gvReset").addEventListener("click", () => { ballot = { ...gov.now }; renderGov(); });
  $("#gvSign").addEventListener("click", async () => {
    try {
      const w = wallet.account?.toLowerCase(), at = new Date().toISOString(), sig = await sign(ballotText(w, ballot, at));
      gov = await post("/api/vote", { wallet: w, ballot, signed: at, sig });
      toast("Ballot counted. Thank you, observer");
      log(`ballot <b>signed</b> · ${SIGNALS.map((k) => `${k} ${ballot[k]}`).join(" · ")}`, "ok");
      renderGov();
    } catch (e) { toast(e.code === 4001 ? "Request declined in wallet" : e.message, true); }
  });

  // ---------- public API key ----------
  const KKEY = "polaris-key:" + CONFIG.network;
  function paintKey() {
    const k = store.get(KKEY), mine = k && wallet.account && k.wallet === wallet.account.toLowerCase() ? k : null;
    $("#apiKey").value = mine?.key || "";
    setText("#apiTier", mine?.tier === "holder" ? "Holder" : "Public");
    setText("#apiTierD", `${int(mine?.rpm || 120)} requests a minute`);
    $("#apiGet").textContent = mine ? "Issue a new key" : "Get my API key";
    $("#apiEx").textContent = `curl ${mine ? `-H "x-polaris-key: ${mine.key}" ` : ""}"${origin}/api/v1/drift?limit=10&rule=score>=60"\n\n<img src="${origin}/api/v1/badge?a=0x…" alt="North Score">`;
  }
  $("#apiGet").addEventListener("click", async () => {
    try {
      const w = wallet.account?.toLowerCase(), at = new Date().toISOString(), sig = await sign(keyText(w, at));
      const k = await post("/api/key", { wallet: w, signed: at, sig });
      store.set(KKEY, k);
      toast(`Key issued · ${int(k.rpm)} requests a minute`);
      log(`api key <b>issued</b> · ${k.tier} tier`, "ok");
      paintKey();
    } catch (e) { toast(e.code === 4001 ? "Request declined in wallet" : e.message, true); }
  });
  $("#apiCopy").addEventListener("click", (e) => $("#apiKey").value ? copy($("#apiKey").value, e.currentTarget) : toast("Get a key first", true));

  // ---------- score badge for the locked token ----------
  let current = null;
  const snippet = (t) => `<a href="${origin}/app?t=${t.address}"><img src="${origin}/api/v1/badge?a=${t.address}" alt="$${esc(t.symbol)} North Score on Polaris"></a>`;
  $("#dEmbed").addEventListener("click", () => current && copy(snippet(current)).then(() => log(`badge for <b>$${esc(current.symbol)}</b> copied`)));

  function route(tab) {
    if (tab === "rules") renderRules();
    if (tab === "portfolio" && !$("#pfIn").value && wallet.account) scan(wallet.account);
    if (tab === "council") { loadGov(); paintKey(); }
  }
  onWallet(() => { if (!$("#pfIn").value && wallet.account) $("#pfIn").value = wallet.account; ballot = null; loadGov(); paintKey(); });
  renderRules();
  setTimeout(pollRules, 2500);
  setInterval(pollRules, 60_000);

  // ---------- shell ----------
  const find = (sym) => { const w = String(sym ?? "").replace(/^\$/, "").toLowerCase(); return w && tokens().find((t) => t.symbol.toLowerCase() === w); };
  const help = [
    ["rule <conditions> · rules", "save a filter, list them"],
    ["rule use <n>|off · rule rm <n>", "filter the radar, delete one"],
    ["scan [wallet]", "risk profile of a wallet's holdings"],
    ["vote · apikey", "signal governance, your API key"],
    ["badge [symbol]", "copy an embeddable score badge"],
  ];
  const commands = {
    rule: ([sub, ...rest], out) => {
      const n = +rest[0], r = rules[n - 1];
      if (sub === "use" || sub === "off") {
        if (sub === "off" || rest[0] === "off") { useRule(""); return out("radar rule off", "dim"); }
        if (!r) return out(`usage: rule use <1-${rules.length || 1}>`, "err");
        useRule(r.text); view("radar"); return out(`radar filtered by <b>${esc(r.text)}</b>`);
      }
      if (sub === "rm") { if (!r) return out(`usage: rule rm <1-${rules.length || 1}>`, "err"); dropRule(r.text); return out(`deleted ${esc(r.text)}`, "dim"); }
      const text = [sub, ...rest].filter(Boolean).join(" ");
      if (!text) return commands.rules([], out);
      try { parseRule(text); } catch (e) { return out(esc(e.message), "err"); }
      if (addRule(text)) { view("rules"); out(`saved <b>${esc(text)}</b> · alerts on new matches every minute · <b>rule use ${rules.length}</b> filters the radar`); }
    },
    rules: (_, out) => {
      view("rules");
      if (!rules.length) return out("no rules yet · try <b>rule score>=40 holders>=10</b>", "dim");
      rules.forEach((r, i) => out(`${esc(pad(i + 1, 4))}<b>${esc(pad(r.text, 34))}</b>${hits[r.text] ? hits[r.text].tracked + " match" : "reading"}${active === r.text ? " · on radar" : ""}`));
    },
    scan: ([a], out) => {
      const w = a || wallet.account;
      if (!isAddr(w)) return out("usage: scan <wallet> · or connect one", "err");
      scan(w); out(`scanning <b>${short(w)}</b> against every tracked token`, "dim");
    },
    vote: (_, out) => { view("council"); out(wallet.account ? "move the sliders and press <b>Sign ballot</b> · signing moves no funds" : "connect a wallet holding $POLARIS to vote", "dim"); },
    apikey: (_, out) => { view("council"); const k = store.get(KKEY); out(k ? `key for ${short(k.wallet)} · ${k.tier} tier · ${k.rpm} req/min` : "press <b>Get my API key</b> and sign once · 120 req/min without one", "dim"); },
    badge: ([sym], out) => {
      const t = sym ? find(sym) : current;
      if (!t) return out("usage: badge <symbol>", "err");
      copy(snippet(t)).then(() => out(`badge for <b>$${esc(t.symbol)}</b> copied · paste it into any page`));
    },
  };

  return { route, commands, help, rule: () => active, detail: (t) => (current = t) };
}
