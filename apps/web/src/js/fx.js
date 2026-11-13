// Terminal micro-interactions: text that decodes out of noise, a targeting cursor that locks onto whatever
// is clickable, a phosphor spotlight on panels, click ripples, scroll spy and a UTC clock.
const GLYPHS = "!<>-_\\/[]{}=+*^?#01ABCDEF$%&";
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Decode an element's text left to right. Only text nodes change, so markup stays, and a node that some
// other code rewrites mid-flight keeps the new value instead of being restored to the old one.
export function scramble(el, duration = 600) {
  if (reduce || !el || el.dataset.decoding) return;
  const nodes = [];
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) if (walk.currentNode.data.trim()) nodes.push({ n: walk.currentNode, text: walk.currentNode.data, out: null });
  if (!nodes.length) return;
  el.dataset.decoding = 1;
  const total = nodes.reduce((s, x) => s + x.text.length, 0), t0 = performance.now();
  const frame = (now) => {
    const p = Math.min(1, (now - t0) / duration), shown = Math.floor(p * total);
    let k = 0;
    for (const x of nodes) {
      if (x.out !== null && x.n.data !== x.out) { x.text = x.n.data; x.done = true; } // rewritten elsewhere
      if (x.done) { k += x.text.length; continue; }
      x.out = p >= 1 ? x.text : [...x.text].map((c) => (k++ < shown || c === " " ? c : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join("");
      x.n.data = x.out;
    }
    if (p < 1) requestAnimationFrame(frame);
    else delete el.dataset.decoding;
  };
  requestAnimationFrame(frame);
}

// Hovering anything clickable re-decodes its label
export function decodeOnHover(sel) {
  document.addEventListener("pointerover", (e) => {
    const el = e.target.closest?.(sel);
    if (el && !el.contains(e.relatedTarget)) scramble(el, 320);
  });
}

// Targeting reticle with page coordinates; corner brackets lock onto the hovered control
export function cursorHud(root) {
  if (!root || reduce || !matchMedia("(hover: hover) and (pointer: fine)").matches) return root?.remove();
  const ring = root.querySelector(".hud-ring"), xy = root.querySelector(".hud-xy"), lock = root.querySelector(".hud-lock");
  let x = -99, y = -99, rx = x, ry = y, locked = null, box = "";
  addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; root.classList.add("on"); }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => root.classList.remove("on"));
  document.addEventListener("pointerover", (e) => {
    locked = e.target.closest?.("a, button, input, label, [data-lock]") || null;
    root.classList.toggle("locked", !!locked);
    root.classList.toggle("grab", !locked && !!e.target.closest?.(".globe-target"));
  });
  (function loop() {
    rx += (x - rx) * 0.3; ry += (y - ry) * 0.3;
    ring.style.transform = `translate(${rx}px, ${ry}px)`;
    xy.textContent = `${String(Math.round(x)).padStart(4, "0")}.${String(Math.round(y + scrollY)).padStart(5, "0")}`;
    if (locked?.isConnected) {
      const r = locked.getBoundingClientRect(), b = `${r.left - 6},${r.top - 6},${r.width + 12},${r.height + 12}`;
      if (b !== box) {
        box = b;
        lock.style.transform = `translate(${r.left - 6}px, ${r.top - 6}px)`;
        lock.style.width = r.width + 12 + "px";
        lock.style.height = r.height + 12 + "px";
      }
    }
    requestAnimationFrame(loop);
  })();
}

// Phosphor spotlight that follows the pointer across panels
export function spotlight(sel) {
  document.addEventListener("pointermove", (e) => {
    const el = e.target.closest?.(sel);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", e.clientX - r.left + "px");
    el.style.setProperty("--my", e.clientY - r.top + "px");
  }, { passive: true });
}

export function ripples(sel) {
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest?.(sel);
    if (!b || reduce) return;
    const r = b.getBoundingClientRect(), s = document.createElement("span");
    s.className = "ripple";
    s.style.left = e.clientX - r.left + "px";
    s.style.top = e.clientY - r.top + "px";
    b.append(s);
    setTimeout(() => s.remove(), 600);
  });
}

// Highlight the nav link of the section in the middle of the screen
export function scrollSpy(links) {
  const byId = new Map(links.map((a) => [a.hash.slice(1), a]));
  const io = new IntersectionObserver((es) => es.forEach((e) => {
    if (e.isIntersecting) links.forEach((a) => a.classList.toggle("on", a === byId.get(e.target.id)));
  }), { rootMargin: "-45% 0px -50% 0px" });
  byId.forEach((_, id) => { const s = document.getElementById(id); if (s) io.observe(s); });
}

export function clock(el) {
  if (!el) return;
  const tick = () => (el.textContent = new Date().toISOString().slice(11, 19) + " UTC");
  tick();
  setInterval(tick, 1000);
}
