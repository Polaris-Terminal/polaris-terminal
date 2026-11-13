// Deep space behind every page. paintSky() paints the far sky once per size: nebula clouds and a Milky Way
// band, grainy with faint stars and cut by dark dust lanes. The landing maps it onto its WebGL sky; app and docs
// blit it under mountSpace(), which adds three depths of stars that drift slowly past, twinkle, lean against
// the cursor (nearer ones further) and, every few seconds, a shooting star.
const hash = (s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);

// A star seen through a lens: a round soft core (never a square pixel), a faint halo, and on the brightest,
// diffraction spikes that taper to nothing. Sprites are painted once and drawn scaled.
const STAR_TINTS = ["#f8f7ff", "#f8f7ff", "#fff4ea", "#cad7ff", "#9bb0ff", "#ffd2a1"]; // stellar colours, mostly white
const DOT = [[0, 1], [0.08, 0.92], [0.2, 0.5], [0.36, 0.14], [0.6, 0.03], [1, 0]];
const HALO = [[0, 0.45], [0.12, 0.2], [0.35, 0.06], [0.7, 0.012], [1, 0]];
function sprite(color, size, stops) {
  const c = document.createElement("canvas"), g = c.getContext("2d"), m = size / 2, gr = g.createRadialGradient(m, m, 0, m, m, m);
  c.width = c.height = size;
  for (const [o, a] of stops) gr.addColorStop(o, `rgba(0,0,0,${a})`);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  g.globalCompositeOperation = "source-in"; // keep the falloff, take the colour
  g.fillStyle = color;
  g.fillRect(0, 0, size, size);
  return c;
}
function spikes() {
  const c = document.createElement("canvas"), g = c.getContext("2d");
  c.width = c.height = 96;
  for (const turn of [0, Math.PI / 2]) {
    g.setTransform(1, 0, 0, 1, 48, 48);
    g.rotate(turn);
    const lg = g.createLinearGradient(-48, 0, 48, 0);
    lg.addColorStop(0, "rgba(236,242,255,0)"); lg.addColorStop(0.35, "rgba(236,242,255,0.25)"); lg.addColorStop(0.5, "rgba(236,242,255,0.95)");
    lg.addColorStop(0.65, "rgba(236,242,255,0.25)"); lg.addColorStop(1, "rgba(236,242,255,0)");
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(-48, 0); g.lineTo(0, -1.3); g.lineTo(48, 0); g.lineTo(0, 1.3); g.closePath(); g.fill(); // thin, pointed at both ends
  }
  return c;
}

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
  const dots = STAR_TINTS.map((c) => sprite(c, 32, DOT)), halos = STAR_TINTS.map((c) => sprite(c, 64, HALO)), spike = spikes();
  // in unit space, so a resize keeps the same sky
  const stars = Array.from({ length: Math.round(Math.min(1300, (innerWidth * innerHeight) / 1100)) }, () => {
    const z = rnd() ** 2.2; // most stars are far
    return { x: rnd(), y: rnd(), z, r: 0.35 + z * 1.3, a: 0.35 + 0.65 * z, c: (rnd() * STAR_TINTS.length) | 0, tw: rnd() * 6.3, ts: 0.5 + rnd() * 2 };
  });

  let w = 0, h = 0, dpr = 1, mx = 0, my = 0, tx = 0, ty = 0, light = false, dimDot = null, sky = null, last = 0, meteor = null, nextMeteor = 2500;
  const wrap = (v, n) => ((v % n) + n) % n;
  const theme = () => {
    light = document.documentElement.dataset.theme === "light";
    dimDot = sprite(getComputedStyle(document.documentElement).getPropertyValue("--muted").trim(), 32, DOT);
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
    for (const s of stars) {
      const x = wrap(s.x * w - sec * (1.5 + 9 * s.z) - mx * (6 + 34 * s.z), w), y = wrap(s.y * h - my * (6 + 34 * s.z), h);
      const a = s.a * (light ? 0.45 : 1) * (reduce ? 1 : 0.62 + 0.38 * Math.sin(sec * s.ts + s.tw));
      if (!light && s.z > 0.88) { // near and bright: a halo, and spikes on the brightest
        const f = s.r * 16;
        ctx.globalAlpha = a * 0.75;
        ctx.drawImage(halos[s.c], x - f / 2, y - f / 2, f, f);
        if (s.z > 0.97) { const k = s.r * 20; ctx.globalAlpha = a * 0.7; ctx.drawImage(spike, x - k / 2, y - k / 2, k, k); }
      }
      const d = s.r * 5;
      ctx.globalAlpha = a;
      ctx.drawImage(light ? dimDot : dots[s.c], x - d / 2, y - d / 2, d, d);
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
    ctx.drawImage(halos[0], hx - 10, hy - 10, 20, 20);
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
