// Splash, once per session: hex rain and a boot log around the real radar planet, which waits inside the
// reticle. When the log is done and the planet has loaded, the mask opens like an iris and the planet glides
// into the hero. The returned promise settles the moment the iris starts to open.
import { sleep, scramble } from "./fx.js";

const clamp01 = (f) => Math.max(0, Math.min(1, f));
const ease = (f) => (f < 0.5 ? 4 * f * f * f : 1 - (-2 * f + 2) ** 3 / 2);

// shortcut: the rain is sized once and does not follow a resize, fine for a splash that lasts a few seconds
function rain(canvas) {
  const css = getComputedStyle(document.documentElement), ctx = canvas.getContext("2d");
  const bg = css.getPropertyValue("--bg-0").trim(), fg = css.getPropertyValue("--accent-text").trim(), hi = css.getPropertyValue("--text").trim();
  const fs = innerWidth < 720 ? 12 : 14, w = (canvas.width = innerWidth), h = (canvas.height = innerHeight);
  const drops = Array.from({ length: Math.ceil(w / fs) }, () => -Math.random() * (h / fs));
  ctx.font = `${fs}px "Geist Mono", monospace`;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  let raf = 0, last = 0, speed = 1;
  const frame = (t) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 50) return; // ~20 fps, the cadence of an old terminal
    last = t;
    ctx.globalAlpha = 0.16; ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1;
    drops.forEach((y, i) => {
      if (y > 0) { ctx.fillStyle = Math.random() > 0.94 ? hi : fg; ctx.fillText("0123456789abcdef"[(Math.random() * 16) | 0], i * fs, y * fs); }
      drops[i] = y * fs > h && Math.random() > 0.97 ? 0 : y + speed;
    });
  };
  raf = requestAnimationFrame(frame);
  return { stop: () => cancelAnimationFrame(raf), rush: () => (speed = 2.5) };
}

export async function splash(el, { lines, ready }) {
  if (!el || document.documentElement.classList.contains("booted")) return el?.remove();
  try { sessionStorage.setItem("polaris-boot", "1"); } catch { /* private mode: the splash shows again next time */ }
  scrollTo(0, 0);
  const log = el.querySelector(".splash-log"), bar = el.querySelector(".splash-bar i"), pct = el.querySelector(".splash-pct"), state = el.querySelector(".splash-state");
  const sky = rain(el.querySelector("canvas"));
  const say = (s) => { if (state.textContent !== s) { state.textContent = s; scramble(state, 300); } };
  let skip = false, done = 0, locked = false, shown = 0;
  const stop = () => (skip = true);
  addEventListener("keydown", stop);
  el.addEventListener("pointerdown", stop);
  ready.then(() => { locked = true; el.classList.add("locked"); });

  // the meter: every log line is a step, the planet loading is the last one
  (function meter() {
    shown += ((done + (locked ? 1 : 0)) / (lines.length + 1) - shown) * 0.14;
    bar.style.width = (shown * 100).toFixed(1) + "%";
    pct.textContent = Math.round(shown * 100) + "%";
    if (el.isConnected) requestAnimationFrame(meter);
  })();

  for (const line of lines) {
    if (skip) break;
    const text = typeof line === "function" ? await line() : line, row = document.createElement("div");
    log.append(row);
    for (let i = 0; i <= text.length && !skip; i += 2) { row.textContent = text.slice(0, i); await sleep(9); }
    row.textContent = text;
    done++;
    if (done === 2) say("locking target");
  }
  if (!skip && !locked) { say("locking target"); await Promise.race([ready, sleep(4500)]); }
  done = lines.length; locked = true;
  say("access granted");
  el.classList.add("locked", "granted");
  await sleep(skip ? 160 : 620);

  removeEventListener("keydown", stop);
  el.classList.add("out");
  sky.rush();
  const t0 = performance.now();
  (function open() {
    const f = clamp01((performance.now() - t0) / 1500); // performance.now, not the rAF stamp: that can predate t0
    el.style.setProperty("--open", ease(f).toFixed(4));
    if (f < 1) return requestAnimationFrame(open);
    sky.stop();
    el.remove();
  })();
}
