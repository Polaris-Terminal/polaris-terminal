// Terminal micro-interactions: text that decodes out of noise, click ripples, scroll spy and a UTC clock.
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
