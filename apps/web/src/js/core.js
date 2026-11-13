// Shared runtime for every Polaris page: theme, formatting, chain I/O, wallet, toasts.
import { CONFIG } from "./config.js";
export { CONFIG };

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

// ---------- the mark: flat Polaris star with its four arcs ----------
export const MARK = `<svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><path fill="currentColor" d="M32 2c1.1 13.6 3.3 22.5 6.6 25.8C41.7 30.9 49.7 32.4 60 32c-10.3.4-18.3 1.9-21.4 5-3.3 3.3-5.5 12.2-6.6 25-1.1-12.8-3.3-21.7-6.6-25C22.3 33.9 14.3 32.4 4 32c10.3-.4 18.3-1.9 21.4-5C28.7 23.7 30.9 15.6 32 2z"/><g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M27 12.6A20 20 0 0 0 12.6 27"/><path d="M37 12.6A20 20 0 0 1 51.4 27"/><path d="M12.6 37A20 20 0 0 0 27 51.4"/><path d="M51.4 37A20 20 0 0 1 37 51.4"/></g></svg>`;
export const TICK = `<svg class="star-tick" viewBox="0 0 10 10" aria-hidden="true"><path fill="currentColor" d="M5 0c.2 2.4.6 3.8 1.2 4.4C6.8 4.9 8.1 5 10 5c-1.9 0-3.2.2-3.8.7C5.6 6.2 5.2 7.6 5 10c-.2-2.4-.6-3.8-1.2-4.3C3.2 5.2 1.9 5 0 5c1.9 0 3.2-.1 3.8-.6C4.4 3.8 4.8 2.4 5 0z"/></svg>`;
export const ICON = {
  sun: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="i" viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
  x: '<svg class="i" viewBox="0 0 24 24"><path fill="currentColor" stroke="none" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
  menu: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  arrow: '<svg class="i arrow" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  ext: '<svg class="i" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  copy: '<svg class="i" viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a1 1 0 0 1 1-1h10"/></svg>',
  check: '<svg class="i" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  wallet: '<svg class="i" viewBox="0 0 24 24"><path d="M4 7a2 2 0 0 1 2-2h12v4"/><path d="M4 7v11a2 2 0 0 0 2 2h14V9H6a2 2 0 0 1-2-2z"/><circle cx="16" cy="14.5" r="1"/></svg>',
  radar: '<svg class="i" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="M12 12l6-6"/></svg>',
  vault: '<svg class="i" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5V7M15.5 12H17"/></svg>',
  beacon: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><path d="M12 8l1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2z"/></svg>',
  doc: '<svg class="i" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>',
  drop: '<svg class="i" viewBox="0 0 24 24"><path d="M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z"/></svg>',
};

// ---------- theme ----------
export function initTheme() {
  const saved = store.get("polaris-theme");
  if (saved) document.documentElement.dataset.theme = saved;
  const btn = $("#theme");
  if (!btn) return;
  const paint = () => (btn.innerHTML = document.documentElement.dataset.theme === "light" ? ICON.moon : ICON.sun);
  paint();
  btn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    store.set("polaris-theme", next);
    paint();
    dispatchEvent(new CustomEvent("polaris:theme", { detail: next }));
  });
}

export function initNav() {
  const nav = $(".nav");
  if (!nav) return;
  const onScroll = () => nav.classList.toggle("solid", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  $(".menu-btn", nav)?.addEventListener("click", () => nav.classList.toggle("open"));
  $$(".nav-links a", nav).forEach((a) => a.addEventListener("click", () => nav.classList.remove("open")));
}

export function smoothScroll() {
  if (!window.Lenis || matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
  const lenis = new Lenis({ lerp: 0.11, smoothWheel: true });
  if (window.gsap && window.ScrollTrigger) {
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
  } else {
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
  }
  $$('a[href^="#"]').forEach((a) => a.addEventListener("click", (e) => {
    const el = a.getAttribute("href").length > 1 && $(a.getAttribute("href"));
    if (el) { e.preventDefault(); lenis.scrollTo(el, { offset: -72 }); }
  }));
  return lenis;
}

// ---------- formatting: never prints a bare 0, a dash or an empty value ----------
export function compact(n, digits = 1) {
  if (!Number.isFinite(n) || n <= 0) return null;
  const units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [v, s] of units) if (n >= v) return (n / v).toFixed(n / v >= 100 ? 0 : digits).replace(/\.0+$/, "") + s;
  return n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(n >= 10 ? 1 : 2).replace(/\.?0+$/, "");
}
export const usd = (n) => (compact(n) ? "$" + compact(n) : null);
export const pct = (n, d = 2) => (Number.isFinite(n) && n > 0 ? n.toFixed(d) + "%" : null);
export const int = (n) => (Number.isFinite(n) && n > 0 ? Math.round(n).toLocaleString("en-US") : null);
export const short = (a) => (a ? a.slice(0, 6) + "…" + a.slice(-4) : "");
export function age(min) {
  if (min < 60) return `${Math.max(1, Math.round(min))}m`;
  if (min < 1440) return `${Math.round(min / 60)}h`;
  return `${Math.round(min / 1440)}d`;
}

// Write a value into an element; keep the skeleton (and the last good value) when there is nothing to show.
export function setText(el, value) {
  if (typeof el === "string") el = $(el);
  if (!el || value == null || value === "") return;
  el.textContent = value;
  el.classList.remove("sk");
}

// Tween a number in place (only the number changes, the layout stays still).
export function tween(el, to, fmt = int) {
  if (typeof el === "string") el = $(el);
  if (!el || !Number.isFinite(to) || to <= 0) return;
  const from = +el.dataset.v || to * 0.92;
  el.dataset.v = to;
  el.classList.remove("sk");
  if (!window.gsap) return (el.textContent = fmt(to));
  const o = { v: from };
  gsap.to(o, { v: to, duration: 0.9, ease: "power3.out", onUpdate: () => (el.textContent = fmt(o.v) ?? el.textContent) });
}

// ---------- API (cached, so returning visitors see numbers instantly) ----------
export async function api(path, onData) {
  const key = "polaris-api:" + CONFIG.network + path;
  const cached = store.get(key);
  if (cached && onData) onData(cached, true);
  try {
    const r = await fetch(CONFIG.api + path, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) throw new Error(r.status);
    const j = await r.json();
    store.set(key, j);
    onData?.(j, false);
    return j;
  } catch (e) {
    console.warn("api", path, e);
    return cached;
  }
}

// ---------- JSON-RPC ----------
let rpcIdx = 0;
export async function rpc(method, params = []) {
  let lastErr;
  for (let i = 0; i < CONFIG.chain.rpcs.length; i++) {
    const url = CONFIG.chain.rpcs[(rpcIdx + i) % CONFIG.chain.rpcs.length];
    try {
      const r = await fetch(url, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(10_000),
      });
      const j = await r.json();
      if (j.error) throw Object.assign(new Error(j.error.message), { rpc: true });
      rpcIdx = (rpcIdx + i) % CONFIG.chain.rpcs.length;
      return j.result;
    } catch (e) {
      lastErr = e;
      if (e.rpc) throw e; // a real revert, not a dead endpoint
    }
  }
  throw lastErr;
}

export const sel = (contract, fn) => CONFIG.selectors[contract][fn];
export const encAddr = (a) => a.toLowerCase().replace("0x", "").padStart(64, "0");
export const encU = (n) => BigInt(n).toString(16).padStart(64, "0");
export const word = (hex, i) => BigInt("0x" + (hex.slice(2 + i * 64, 2 + (i + 1) * 64) || "0"));
export const ethCall = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

export function parseUnits(s, dec) {
  if (!/^\d*\.?\d*$/.test(s || "") || !s || s === ".") return 0n;
  const [w, f = ""] = s.split(".");
  return BigInt(w || "0") * 10n ** BigInt(dec) + BigInt((f + "0".repeat(dec)).slice(0, dec) || "0");
}
export function fromUnits(v, dec) {
  return Number(v) / 10 ** dec;
}

// ---------- wallet (EIP-6963 discovery, raw EIP-1193 requests) ----------
const found = new Map();
addEventListener("eip6963:announceProvider", (e) => found.set(e.detail.info.rdns, e.detail));
dispatchEvent(new Event("eip6963:requestProvider"));

export const wallet = { provider: null, info: null, account: null, chainOk: false };
const subs = new Set();
export const onWallet = (fn) => (subs.add(fn), fn(wallet));
const emit = () => subs.forEach((fn) => fn(wallet));

export function openWalletModal() {
  dispatchEvent(new Event("eip6963:requestProvider"));
  const m = $("#wModal"), list = $("#wList");
  const items = [...found.values()];
  if (!items.length && window.ethereum) items.push({ info: { name: "Browser wallet", rdns: "injected" }, provider: window.ethereum });
  list.innerHTML = items.length
    ? items.map((w, i) => `<button data-i="${i}">${w.info.icon ? `<img src="${esc(w.info.icon)}" alt="">` : `<i>${ICON.wallet}</i>`}${esc(w.info.name)}</button>`).join("")
    : `<p class="dim" style="margin:0 0 4px;font-size:14px">Add a wallet to this browser, then reload</p>
       <a href="https://rabby.io" target="_blank" rel="noopener"><i>R</i>Rabby Wallet</a>
       <a href="https://metamask.io/download/" target="_blank" rel="noopener"><i>M</i>MetaMask</a>`;
  $$("button[data-i]", list).forEach((b) => b.addEventListener("click", () => connect(items[+b.dataset.i])));
  m.classList.add("on");
}

export async function connect(w, silent = false) {
  try {
    const accs = await w.provider.request({ method: silent ? "eth_accounts" : "eth_requestAccounts" });
    if (!accs?.length) return;
    Object.assign(wallet, { provider: w.provider, info: w.info, account: accs[0] });
    store.set("polaris-wallet", w.info.rdns);
    $("#wModal")?.classList.remove("on");
    w.provider.on?.("accountsChanged", (a) => { wallet.account = a[0] || null; if (!a[0]) disconnect(); else afterConnect(); });
    w.provider.on?.("chainChanged", () => afterConnect());
    await afterConnect();
    if (!silent) {
      toast(`${w.info.name} connected`);
      if (!wallet.chainOk) switchChain().catch(() => {});
    }
  } catch (e) {
    if (!silent) toast(friendly(e), true);
  }
}

async function afterConnect() {
  const id = await wallet.provider.request({ method: "eth_chainId" });
  wallet.chainOk = parseInt(id, 16) === CONFIG.chain.id;
  emit();
}

export function disconnect() {
  Object.assign(wallet, { provider: null, info: null, account: null, chainOk: false });
  store.set("polaris-wallet", null);
  emit();
}

export async function switchChain() {
  const c = CONFIG.chain;
  try {
    await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: c.hex }] });
  } catch (e) {
    if (e.code !== 4902 && !/unrecognized|not added/i.test(e.message)) throw e;
    await wallet.provider.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: c.hex, chainName: c.name, nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: [c.rpcs[0]], blockExplorerUrls: [c.explorer] }],
    });
  }
  await afterConnect();
}

export async function autoConnect() {
  const rdns = store.get("polaris-wallet");
  if (!rdns) return;
  await new Promise((r) => setTimeout(r, 300));
  const w = found.get(rdns) || (rdns === "injected" && window.ethereum && { info: { name: "Browser wallet", rdns }, provider: window.ethereum });
  if (w) connect(w, true);
}

export async function sendTx(to, data) {
  if (!wallet.chainOk) await switchChain();
  const hash = await wallet.provider.request({ method: "eth_sendTransaction", params: [{ from: wallet.account, to, data }] });
  for (let i = 0; i < 120; i++) {
    const r = await rpc("eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) {
      if (r.status !== "0x1") throw Object.assign(new Error("Transaction reverted"), { hash });
      return { hash, receipt: r };
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw Object.assign(new Error("Still pending, check the explorer"), { hash });
}

export function friendly(e) {
  const m = e?.message || String(e);
  if (e?.code === 4001 || /reject|denied/i.test(m)) return "Request declined in wallet";
  if (/insufficient funds/i.test(m)) return "Not enough ETH for gas";
  if (/AlreadyPinged/i.test(m)) return "Already pinged today, come back after UTC midnight";
  if (/DripCooling/i.test(m)) return "Faucet is cooling down, try again tomorrow";
  return m.length > 120 ? m.slice(0, 117) + "…" : m;
}

export function walletButton(btn) {
  const paint = (w) => {
    btn.innerHTML = w.account ? `<span class="dot"></span><span class="num">${short(w.account)}</span>` : `${ICON.wallet}<span>Connect</span>`;
    btn.classList.toggle("btn-primary", !w.account);
    btn.classList.toggle("btn-ghost", !!w.account);
  };
  btn.addEventListener("click", () => (wallet.account ? disconnect() : openWalletModal()));
  onWallet(paint);
}

// ---------- toast ----------
export function toast(msg, err = false, hash) {
  let box = $(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.append(box); }
  const t = document.createElement("div");
  t.className = "toast" + (err ? " err" : "");
  t.innerHTML = `<span class="dot" style="margin-top:7px"></span><div>${esc(msg)}${hash ? `<br><a href="${CONFIG.chain.explorer}/tx/${hash}" target="_blank" rel="noopener">View transaction</a>` : ""}</div>`;
  box.append(t);
  setTimeout(() => { t.style.transition = "opacity 300ms"; t.style.opacity = "0"; setTimeout(() => t.remove(), 320); }, 5200);
}

export async function copy(text, el) {
  try { await navigator.clipboard.writeText(text); } catch { return; }
  if (!el) return toast("Copied");
  const old = el.innerHTML;
  el.innerHTML = ICON.check;
  setTimeout(() => (el.innerHTML = old), 1200);
}

export const explorerAddr = (a) => `${CONFIG.chain.explorer}/address/${a}`;

// Common shell wiring for every page.
export function boot() {
  initTheme();
  initNav();
  $$("[data-mark]").forEach((el) => (el.innerHTML = MARK));
  $$("[data-icon]").forEach((el) => (el.innerHTML = ICON[el.dataset.icon] + el.innerHTML));
  $("#wModal")?.addEventListener("click", (e) => { if (e.target.id === "wModal" || e.target.closest("[data-close]")) e.currentTarget.classList.remove("on"); });
  const wb = $("#walletBtn");
  if (wb) walletButton(wb);
  autoConnect();
}
