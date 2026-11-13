// First-visit walkthrough: a spotlight that glides from one part of the terminal to the next, with a card that
// explains it. "Got it" ends it for good on this browser; the shell command `tour` plays it again.
import { scramble } from "./fx.js";

const KEY = "polaris-tour";
export const seenTour = () => { try { return localStorage.getItem(KEY) === "done"; } catch { return true; } };

// Where the card goes: below the target if it fits, else above, else beside it, else pinned to the bottom of
// the screen; always clamped inside the viewport with a margin. No target means the middle of the screen.
export function place(t, card, vw, vh, gap = 14, m = 12) {
  if (!t) return { x: (vw - card.w) / 2, y: (vh - card.h) / 2, side: "center" };
  const x = Math.max(m, Math.min(vw - card.w - m, t.x + t.w / 2 - card.w / 2));
  if (t.y + t.h + gap + card.h <= vh - m) return { x, y: t.y + t.h + gap, side: "below" };
  if (t.y - gap - card.h >= m) return { x, y: t.y - gap - card.h, side: "above" };
  const y = Math.max(m, Math.min(vh - card.h - m, t.y + t.h / 2 - card.h / 2));
  if (t.x + t.w + gap + card.w <= vw - m) return { x: t.x + t.w + gap, y, side: "right" };
  if (t.x - gap - card.w >= m) return { x: t.x - gap - card.w, y, side: "left" };
  return { x, y: vh - card.h - m, side: "over" };
}

export function startTour(steps, { onStart, onEnd } = {}) {
  document.querySelector(".tour")?.remove();
  const shown = (s) => {
    if (!s.target) return true;
    const r = document.querySelector(s.target)?.getBoundingClientRect();
    return r && r.width > 0 && r.right > 0 && r.left < innerWidth; // the phone drawer hides some targets
  };
  onStart?.();
  const list = steps.filter(shown);
  const el = document.createElement("div");
  el.className = "tour";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "tourH");
  el.innerHTML = `<div class="tour-hole"></div>
    <div class="tour-card panel">
      <div class="tour-bar"><span class="label">walkthrough</span><span class="num tour-n"></span></div>
      <h3 id="tourH"></h3><p></p>
      <div class="tour-dots">${list.map(() => "<i></i>").join("")}</div>
      <div class="tour-actions"><button class="btn btn-ghost btn-sm" data-back>Back</button><span></span><button class="btn btn-ghost btn-sm" data-skip>Got it</button><button class="btn btn-primary btn-sm" data-next>Next</button></div>
    </div>`;
  document.body.append(el);
  const hole = el.querySelector(".tour-hole"), card = el.querySelector(".tour-card");
  let i = 0, raf = 0;

  function layout() {
    const s = list[i], r = s.target && document.querySelector(s.target)?.getBoundingClientRect();
    const pad = 8, t = r && { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2 };
    el.classList.toggle("open", !t);
    if (t) Object.assign(hole.style, { transform: `translate(${t.x}px, ${t.y}px)`, width: t.w + "px", height: t.h + "px" });
    const p = place(t && { ...t, y: Math.max(t.y, 0), h: Math.min(t.h, innerHeight) }, { w: card.offsetWidth, h: card.offsetHeight }, innerWidth, innerHeight);
    card.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }
  const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(layout); };

  function go(k) {
    i = Math.max(0, Math.min(list.length - 1, k));
    const s = list[i];
    el.querySelector("h3").textContent = s.title;
    el.querySelector("p").textContent = s.text;
    el.querySelector(".tour-n").textContent = `${String(i + 1).padStart(2, "0")}/${String(list.length).padStart(2, "0")}`;
    el.querySelectorAll(".tour-dots i").forEach((d, j) => d.classList.toggle("on", j <= i));
    el.querySelector("[data-back]").disabled = i === 0;
    el.querySelector("[data-next]").textContent = i === list.length - 1 ? "Finish" : "Next";
    scramble(el.querySelector("h3"), 360);
    const t = s.target && document.querySelector(s.target);
    t?.scrollIntoView({ block: t.offsetHeight > innerHeight * 0.7 ? "start" : "center", behavior: "smooth" }); // a tall table shows its head
    layout();
    el.querySelector("[data-next]").focus({ preventScroll: true });
  }
  function end() {
    try { localStorage.setItem(KEY, "done"); } catch { /* private mode: it shows again next visit */ }
    removeEventListener("resize", relayout);
    removeEventListener("scroll", relayout, true);
    removeEventListener("keydown", keys, true);
    el.classList.add("bye");
    setTimeout(() => el.remove(), 300);
    onEnd?.();
  }
  function keys(e) {
    if (e.key === "Escape") end();
    else if (e.key === "ArrowRight" || (e.key === "Enter" && e.target === document.body)) i === list.length - 1 ? end() : go(i + 1);
    else if (e.key === "ArrowLeft") go(i - 1);
    else if (e.key === "Tab") { // keep focus on the card's buttons
      const b = [...card.querySelectorAll("button:not(:disabled)")], at = b.indexOf(document.activeElement);
      e.preventDefault();
      b[(at + (e.shiftKey ? -1 : 1) + b.length) % b.length].focus();
    }
    e.stopPropagation(); // the terminal's own 1-3 / j-k shortcuts stay quiet while the tour is up
  }
  el.querySelector("[data-next]").onclick = () => (i === list.length - 1 ? end() : go(i + 1));
  el.querySelector("[data-back]").onclick = () => go(i - 1);
  el.querySelector("[data-skip]").onclick = end;
  addEventListener("resize", relayout);
  addEventListener("scroll", relayout, true);
  addEventListener("keydown", keys, true);
  requestAnimationFrame(() => { el.classList.add("on"); go(0); });
}
