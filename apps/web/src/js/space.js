// Deep-space backdrop for the pages without the radar planet: a faint nebula and three depths of stars that
// drift a little against the cursor, nearer stars further. Redraws only while the parallax is settling, plus a
// slow twinkle, so the glass panels above it do not re-blur every frame.
export function mountSpace(canvas) {
  if (!canvas) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d");
  let seed = 4663;
  const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  // in unit space, so a resize keeps the same sky
  const stars = Array.from({ length: innerWidth < 720 ? 240 : 480 }, () => {
    const z = rnd() ** 2;
    return { x: rnd(), y: rnd(), z, s: z > 0.9 ? 1.8 : z > 0.45 ? 1.2 : 0.8, a: 0.25 + 0.6 * z, tw: rnd() * 6.3 };
  });
  let w = 0, h = 0, dpr = 1, mx = 0, my = 0, tx = 0, ty = 0, light = false, star = "", glow = "", last = 0;

  const theme = () => {
    const css = getComputedStyle(document.documentElement);
    light = document.documentElement.dataset.theme === "light";
    star = light ? css.getPropertyValue("--muted").trim() : "#c9ffd6";
    glow = css.getPropertyValue("--accent").trim();
    draw(performance.now());
  };
  const resize = () => {
    dpr = Math.min(devicePixelRatio, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    draw(performance.now());
  };

  function draw(t) {
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!light) { // two far clouds, the furthest layer
      for (const [cx, cy, r, a] of [[0.12, 0.3, 0.55, 0.07], [0.88, 0.78, 0.5, 0.05]]) {
        const x = cx * w - mx * 8, y = cy * h - my * 8, g = ctx.createRadialGradient(x, y, 0, x, y, r * Math.max(w, h));
        g.addColorStop(0, glow + Math.round(a * 255).toString(16).padStart(2, "0"));
        g.addColorStop(1, glow + "00");
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.fillStyle = star;
    for (const s of stars) {
      const x = (((s.x * w - mx * (6 + 34 * s.z)) % w) + w) % w, y = (((s.y * h - my * (6 + 34 * s.z)) % h) + h) % h;
      ctx.globalAlpha = s.a * (light ? 0.5 : 1) * (reduce ? 1 : 0.75 + 0.25 * Math.sin(t / 900 + s.tw));
      ctx.fillRect(x, y, s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  addEventListener("resize", resize);
  addEventListener("polaris:theme", () => requestAnimationFrame(theme));
  theme(); // colours first: draw() needs them, and is a no-op until resize() sets the size
  resize();
  if (reduce) return;
  addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") { tx = (e.clientX / w) * 2 - 1; ty = (e.clientY / h) * 2 - 1; } }, { passive: true });
  (function loop(t) {
    requestAnimationFrame(loop);
    const settling = Math.abs(tx - mx) + Math.abs(ty - my) > 0.002;
    if (!settling && t - last < 120) return; // idle: twinkle at ~8 fps
    mx += (tx - mx) * 0.06; my += (ty - my) * 0.06;
    last = t;
    draw(t);
  })(0);
}
