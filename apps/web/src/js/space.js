// Deep space behind every page. paintSky() paints the far sky once per size: nebula clouds and a Milky Way
// band, grainy with faint stars and cut by dark dust lanes. The landing maps it onto its WebGL sky; app and docs
// blit it under mountSpace(), which adds three depths of stars that drift slowly past, twinkle, lean against
// the cursor (nearer ones further) and, every few seconds, a shooting star.
const hash = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

export function paintSky(w, h) {
  const c = document.createElement("canvas"), g = c.getContext("2d"), rnd = hash(911), d = Math.hypot(w, h);
  const peaked = () => (rnd() + rnd() + rnd() - 1.5) / 1.5; // -1..1, crowded at 0
  c.width = w; c.height = h;
  const glow = (x, y, r, rgb, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(0.4, `rgba(${rgb},${a * 0.45})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
  };
  // nebulae in the terminal's green, a teal and a cold blue
  for (const [x, y, r, rgb, a] of [[0.12, 0.2, 0.42, "0,255,65", 0.17], [0.22, 0.34, 0.2, "0,214,170", 0.14], [0.9, 0.82, 0.4, "0,180,140", 0.15],
    [0.78, 0.68, 0.18, "70,150,255", 0.1], [0.62, 0.1, 0.24, "0,255,130", 0.07], [0.04, 0.9, 0.22, "70,150,255", 0.06]]) glow(x * w, y * h, r * d, rgb, a);

  // the Milky Way, tilted across the screen
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(-0.42);
  const bw = d * 0.12, lg = g.createLinearGradient(0, -bw, 0, bw);
  lg.addColorStop(0, "rgba(170,255,215,0)"); lg.addColorStop(0.5, "rgba(190,255,220,0.1)"); lg.addColorStop(1, "rgba(170,255,215,0)");
  g.fillStyle = lg;
  g.fillRect(-d / 2, -bw, d, bw * 2);
  for (let i = 0; i < 6; i++) glow((rnd() - 0.5) * d * 0.9, peaked() * bw * 0.3, bw * (0.6 + rnd()), "210,255,225", 0.06 + rnd() * 0.05); // star clouds
  for (let i = 0, n = Math.round((w * h) / 160); i < n; i++) {
    const y = peaked() * bw;
    g.fillStyle = `rgba(225,255,235,${((0.1 + rnd() * 0.35) * (1 - Math.abs(y) / bw)).toFixed(3)})`;
    g.fillRect((rnd() - 0.5) * d, y, rnd() > 0.9 ? 1.5 : 1, 1);
  }
  g.globalCompositeOperation = "destination-out"; // dust lanes eat into the band
  for (let i = 0; i < 30; i++) {
    const rx = 40 + rnd() * 160;
    g.save();
    g.translate((rnd() - 0.5) * d, peaked() * bw * 0.4);
    g.rotate((rnd() - 0.5) * 0.3);
    g.scale(1, 0.08 + rnd() * 0.12);
    glow(0, 0, rx, "0,0,0", 0.35 + rnd() * 0.3);
    g.restore();
  }
  g.restore();
  return c;
}

export function mountSpace(canvas) {
  if (!canvas) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ctx = canvas.getContext("2d"), rnd = hash(4663), PAD = 40;
  const TINTS = ["255,255,255", "214,228,255", "255,240,214", "196,255,214"]; // white, blue-white, warm, green
  // in unit space, so a resize keeps the same sky; grouped by tint so the canvas switches colour rarely
  const stars = Array.from({ length: Math.round(Math.min(1300, (innerWidth * innerHeight) / 1100)) }, () => {
    const z = rnd() ** 2.2; // most stars are far
    return { x: rnd(), y: rnd(), z, r: 0.35 + z * 1.3, a: 0.3 + 0.7 * z, c: TINTS[(rnd() * 4) | 0], tw: rnd() * 6.3, ts: 0.5 + rnd() * 2 };
  }).sort((a, b) => (a.c < b.c ? -1 : 1));
  const flare = document.createElement("canvas"); // soft halo for the brightest stars
  flare.width = flare.height = 64;
  const fg = flare.getContext("2d"), fr = fg.createRadialGradient(32, 32, 0, 32, 32, 32);
  fr.addColorStop(0, "rgba(255,255,255,0.95)"); fr.addColorStop(0.12, "rgba(210,255,225,0.4)"); fr.addColorStop(1, "rgba(0,255,65,0)");
  fg.fillStyle = fr;
  fg.fillRect(0, 0, 64, 64);

  let w = 0, h = 0, dpr = 1, mx = 0, my = 0, tx = 0, ty = 0, light = false, dim = "", sky = null, last = 0, meteor = null, nextMeteor = 2500;
  const wrap = (v, n) => ((v % n) + n) % n;
  const theme = () => {
    light = document.documentElement.dataset.theme === "light";
    dim = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
    draw(performance.now());
  };
  const resize = () => {
    dpr = Math.min(devicePixelRatio, 2);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    sky = paintSky(w + PAD * 2, h + PAD * 2);
    draw(performance.now());
  };

  function draw(t) {
    if (!w) return;
    const sec = reduce ? 0 : t / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!light) ctx.drawImage(sky, -PAD - mx * 12, -PAD - my * 12, w + PAD * 2, h + PAD * 2); // the far sky barely moves
    let tint = "";
    for (const s of stars) {
      const x = wrap(s.x * w - sec * (1.5 + 9 * s.z) - mx * (6 + 34 * s.z), w), y = wrap(s.y * h - my * (6 + 34 * s.z), h);
      const a = s.a * (light ? 0.45 : 1) * (reduce ? 1 : 0.62 + 0.38 * Math.sin(sec * s.ts + s.tw));
      if (!light && s.z > 0.9) { // near and bright: a halo, and spikes on the brightest
        const f = s.r * 12;
        ctx.globalAlpha = a * 0.8;
        ctx.drawImage(flare, x - f / 2, y - f / 2, f, f);
        if (s.z > 0.975) { ctx.fillStyle = "#fff"; ctx.fillRect(x - f * 0.7, y - 0.35, f * 1.4, 0.7); ctx.fillRect(x - 0.35, y - f * 0.7, 0.7, f * 1.4); tint = ""; }
      }
      const c = light ? dim : `rgb(${s.c})`;
      if (c !== tint) ctx.fillStyle = tint = c;
      ctx.globalAlpha = a;
      if (s.r < 1) ctx.fillRect(x, y, s.r * 1.6, s.r * 1.6);
      else { ctx.beginPath(); ctx.arc(x, y, s.r, 0, 7); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
    if (!light && !reduce) shootingStar(t);
  }

  function shootingStar(t) {
    if (!meteor && t > nextMeteor) {
      const ang = 0.35 + rnd() * 0.35, v = 0.9 + rnd() * 0.6;
      meteor = { t0: t, x: w * (0.3 + rnd() * 0.8), y: h * (rnd() * 0.45 - 0.05), dx: -Math.cos(ang) * v, dy: Math.sin(ang) * v, len: 120 + rnd() * 140, life: 650 + rnd() * 500 };
    }
    if (!meteor) return;
    const age = t - meteor.t0, f = age / meteor.life;
    if (f >= 1) { meteor = null; nextMeteor = t + 4000 + rnd() * 9000; return; }
    const hx = meteor.x + meteor.dx * age, hy = meteor.y + meteor.dy * age, k = Math.min(1, f * 4) * meteor.len / Math.hypot(meteor.dx, meteor.dy);
    const fade = Math.min(1, f * 6) * (1 - Math.max(0, (f - 0.6) / 0.4));
    const gr = ctx.createLinearGradient(hx - meteor.dx * k, hy - meteor.dy * k, hx, hy);
    gr.addColorStop(0, "rgba(160,255,200,0)"); gr.addColorStop(1, `rgba(235,255,240,${(0.95 * fade).toFixed(3)})`);
    ctx.strokeStyle = gr;
    ctx.lineWidth = 1.6;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(hx - meteor.dx * k, hy - meteor.dy * k); ctx.lineTo(hx, hy); ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.drawImage(flare, hx - 9, hy - 9, 18, 18);
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
    if (t - last < 33) return; // ~30 fps: the stars drift slowly, and every frame re-blurs the glass panels above
    last = t;
    mx += (tx - mx) * 0.08; my += (ty - my) * 0.08;
    draw(t);
  })(0);
}
