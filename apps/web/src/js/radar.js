// Drift radar: Polaris sits at the centre; a token's distance from it is 100 minus its North Score,
// its bearing comes from its address, its size from its holder count. Hover for detail, click to select.
import { esc, age, int } from "./core.js";

const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const bearing = (addr) => (parseInt(addr.slice(2, 10), 16) % 3600) / 10 || 7; // degrees, never 0

export function mountRadar(canvas, { onSelect, onHover, tip } = {}) {
  const ctx = canvas.getContext("2d");
  let tokens = [], selected = null, hover = null, linked = null, sweep = 0, w = 0, h = 0, dpr = 1, blips = [], lockAt = 0;
  const born = new Map(); // address -> when it first showed up on an already running radar
  let palette = {};
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const readPalette = () => (palette = { line: css("--line-2"), text: css("--muted"), dot: css("--text-2"), accent: css("--accent"), bg: css("--card"), ink: css("--text") });
  readPalette();
  addEventListener("polaris:theme", () => requestAnimationFrame(readPalette));

  const resize = () => {
    dpr = Math.min(devicePixelRatio, 2);
    w = canvas.clientWidth; h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  function layout() {
    const R = Math.min(w, h) / 2 - 18, cx = w / 2, cy = h / 2;
    const maxH = Math.max(...tokens.map((t) => t.holders || 1), 10);
    // spread the field over the scores that are actually present, strongest nearest Polaris
    const hi = Math.max(...tokens.map((t) => t.score), 1), lo = Math.min(...tokens.map((t) => t.score), hi - 1);
    blips = tokens.map((t, i) => {
      const a = (bearing(t.address) - 90) * Math.PI / 180;
      const r = R * (0.14 + 0.82 * (1 - (t.score - lo) / (hi - lo || 1)));
      return { t, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, s: 2.5 + 5 * Math.sqrt(Math.log10((t.holders || 1) + 1) / Math.log10(maxH + 1)), top: i === 0 };
    });
    return { R, cx, cy };
  }

  function draw() {
    const { R, cx, cy } = layout();
    if (R < 20) return; // canvas hidden behind another tab
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // rings and bearings
    ctx.strokeStyle = palette.line; ctx.lineWidth = 1;
    for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(cx, cy, (R * k) / 4, 0, Math.PI * 2); ctx.stroke(); }
    for (let d = 0; d < 360; d += 5) {
      const a = (d - 90) * Math.PI / 180, inner = d % 30 ? R * (d % 10 ? 0.98 : 0.95) : R * 0.1;
      ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
    }
    ctx.fillStyle = palette.text; ctx.font = "11px 'Geist Mono', monospace"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ["N", "E", "S", "W"].forEach((l, i) => { const a = (i * 90 - 90) * Math.PI / 180; ctx.fillText(l, cx + Math.cos(a) * (R + 10), cy + Math.sin(a) * (R + 10)); });
    ctx.textAlign = "left";

    // sweep: the live scan
    if (!reduce) {
      const g = ctx.createConicGradient(sweep - Math.PI / 2, cx, cy);
      g.addColorStop(0, palette.accent + "00");
      g.addColorStop(0.75, palette.accent + "00");
      g.addColorStop(1, palette.accent + "4d");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      // leading edge of the beam
      const a = sweep - Math.PI / 2;
      ctx.save();
      ctx.strokeStyle = palette.accent; ctx.lineWidth = 1.5; ctx.shadowColor = palette.accent; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); ctx.stroke();
      ctx.restore();
    }

    // newborn ripples
    const now = performance.now();
    for (const b of blips) {
      const age = (now - (born.get(b.t.address) ?? -1e9)) / 1600;
      if (age < 0 || age >= 1) continue;
      ctx.strokeStyle = palette.accent; ctx.globalAlpha = 1 - age;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.s + 4 + age * 30, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // blips
    for (const b of blips) {
      const on = b.t === selected || b.t === hover || b.t === linked;
      const a = Math.atan2(b.y - cy, b.x - cx) + Math.PI / 2;
      const since = ((sweep - a) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const lit = reduce ? 0.85 : 0.45 + 0.55 * Math.max(0, 1 - since / 2.2);
      ctx.globalAlpha = on ? 1 : lit;
      ctx.fillStyle = b.top || on || lit > 0.8 ? palette.accent : palette.dot;
      ctx.shadowColor = palette.accent; ctx.shadowBlur = on || b.top ? 14 : 10 * lit; // phosphor afterglow
      ctx.beginPath(); ctx.arc(b.x, b.y, on ? b.s + 2 : b.s, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
      if (on || b.top) {
        ctx.globalAlpha = 1; ctx.strokeStyle = palette.accent; ctx.beginPath(); ctx.arc(b.x, b.y, b.s + 6, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = palette.ink; ctx.font = "12px 'Geist Mono', monospace";
        ctx.fillText(b.t.symbol, b.x + b.s + 10, b.y);
      }
    }
    ctx.globalAlpha = 1;

    // lock-on: a bearing line from Polaris and brackets that close in, so distance reads as score
    const aim = blips.find((b) => b.t === (hover || linked)) || blips.find((b) => b.t === selected);
    if (aim) {
      ctx.save();
      ctx.strokeStyle = palette.accent; ctx.setLineDash([3, 4]); ctx.globalAlpha = 0.7;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(aim.x, aim.y); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      const k = aim.t === selected && !reduce ? Math.min(1, (now - lockAt) / 380) : 1, e = 1 - (1 - k) ** 3;
      const g = aim.s + 7 + (1 - e) * 26, arm = 6;
      ctx.lineWidth = 1.5; ctx.shadowColor = palette.accent; ctx.shadowBlur = 8;
      for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const x = aim.x + sx * g, y = aim.y + sy * g;
        ctx.beginPath(); ctx.moveTo(x - sx * arm, y); ctx.lineTo(x, y); ctx.lineTo(x, y - sy * arm); ctx.stroke();
      }
      ctx.shadowBlur = 0;
      ctx.fillStyle = palette.accent; ctx.font = "11px 'Geist Mono', monospace";
      ctx.fillText(`NS ${aim.t.score}`, (cx + aim.x) / 2 + 6, (cy + aim.y) / 2 - 6);
      ctx.restore();
    }

    // Polaris at the centre
    ctx.fillStyle = palette.ink;
    ctx.beginPath();
    const s = 9;
    ctx.moveTo(cx, cy - s * 1.6); ctx.quadraticCurveTo(cx + 1.4, cy - 1.4, cx + s * 1.4, cy); ctx.quadraticCurveTo(cx + 1.4, cy + 1.4, cx, cy + s * 1.6);
    ctx.quadraticCurveTo(cx - 1.4, cy + 1.4, cx - s * 1.4, cy); ctx.quadraticCurveTo(cx - 1.4, cy - 1.4, cx, cy - s * 1.6); ctx.fill();
  }

  let visible = true, raf = 0, last = performance.now();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible && !raf) raf = requestAnimationFrame(loop); }).observe(canvas);
  function loop(now) {
    raf = 0;
    if (!visible) return;
    sweep = (sweep + ((now - last) / 1000) * 1.1) % (Math.PI * 2);
    last = now;
    draw();
    if (!reduce) raf = requestAnimationFrame(loop);
  }

  const find = (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 18 * 18;
    for (const b of blips) { const d = (b.x - x) ** 2 + (b.y - y) ** 2; if (d < bd) { bd = d; best = b; } }
    return best;
  };
  canvas.addEventListener("pointermove", (e) => {
    const b = find(e);
    if ((b?.t || null) !== hover) onHover?.(b?.t || null);
    hover = b?.t || null;
    canvas.style.cursor = b ? "pointer" : "";
    if (tip) {
      if (!b) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.style.transform = `translate(${Math.min(b.x + 14, w - 200)}px, ${Math.max(b.y - 70, 4)}px)`;
      tip.innerHTML = `<b>${esc(b.t.name)}</b><span class="num">$${esc(b.t.symbol)}</span><span>North Score <b class="num">${b.t.score}</b></span><span>Born ${age(b.t.ageMin)} ago · ${int(b.t.holders) ?? "first"} holder${b.t.holders === 1 ? "" : "s"}</span>`;
    }
    if (reduce) draw();
  });
  canvas.addEventListener("pointerleave", () => { if (hover) onHover?.(null); hover = null; if (tip) tip.hidden = true; });
  canvas.addEventListener("click", (e) => { const b = find(e); if (b) { selected = b.t; onSelect?.(b.t); if (reduce) draw(); } });

  return {
    set(list) {
      if (tokens.length) { const had = new Set(tokens.map((t) => t.address)); list.forEach((t) => had.has(t.address) || born.set(t.address, performance.now())); }
      tokens = list;
      if (!raf) raf = requestAnimationFrame(loop);
    },
    select(t) { if (t?.address !== selected?.address) lockAt = performance.now(); selected = t; if (reduce) draw(); },
    link(t) { linked = t; if (reduce) draw(); }, // hover from outside the canvas, e.g. the table
  };
}
