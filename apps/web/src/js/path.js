// Scroll path for the landing globe. A chapter is a pose { at, x, y, r, dim, ov, rest }: `at` is the scrollY
// where the pose is reached, x/y the centre as viewport fractions, r the radius as a fraction of min(w, h),
// dim its brightness and ov the opacity of the data overlay. Poses are joined by a monotone cubic Hermite
// curve (never overshoots), resting chapters get zero slope so the globe dwells there, and a change of side
// inserts a mid pose so the globe arcs across the page instead of sliding straight through the copy.
const KEYS = ["x", "y", "r", "dim", "ov"];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const val = (p, k) => (k === "r" ? Math.log(p.r) : p[k]); // radius eases in log space, so growth feels even

function slopes(pts, v) {
  const m = v.map(() => 0);
  if (pts.length < 2) return m;
  const h = pts.slice(1).map((p, i) => p.at - pts[i].at), s = h.map((d, i) => (v[i + 1] - v[i]) / d);
  m[0] = s[0];
  m[m.length - 1] = s[s.length - 1];
  for (let i = 1; i < m.length - 1; i++) {
    if (s[i - 1] * s[i] <= 0) continue; // a local peak or valley stays flat
    const a = 2 * h[i] + h[i - 1], b = h[i] + 2 * h[i - 1];
    m[i] = (a + b) / (a / s[i - 1] + b / s[i]);
  }
  pts.forEach((p, i) => { if (p.rest) m[i] = 0; });
  return m;
}

export function buildPath(chapters) {
  const sorted = [...chapters].sort((a, b) => a.at - b.at).filter((a, i, arr) => !i || a.at > arr[i - 1].at);
  const pts = [];
  sorted.forEach((a, i) => {
    pts.push({ ...a });
    const b = sorted[i + 1];
    if (b && Math.abs(b.x - a.x) > 0.35) pts.push({
      at: (a.at + b.at) / 2, x: (a.x + b.x) / 2, y: clamp((a.y + b.y) / 2 + (b.x > a.x ? -0.17 : 0.18), 0.28, 0.79),
      r: Math.sqrt(a.r * b.r), dim: (a.dim + b.dim) / 2, ov: (a.ov + b.ov) / 2, name: "transit",
    });
  });
  return { pts, m: Object.fromEntries(KEYS.map((k) => [k, slopes(pts, pts.map((p) => val(p, k)))])) };
}

export function samplePath({ pts, m }, y, out = {}) {
  if (!pts.length) return out;
  const n = pts.length;
  if (n === 1 || y <= pts[0].at) return Object.assign(out, pts[0]);
  if (y >= pts[n - 1].at) return Object.assign(out, pts[n - 1]);
  let i = 0;
  while (i < n - 2 && y > pts[i + 1].at) i++;
  const a = pts[i], b = pts[i + 1], h = b.at - a.at, t = clamp((y - a.at) / h, 0, 1), t2 = t * t, t3 = t2 * t;
  for (const k of KEYS) {
    const v = (2 * t3 - 3 * t2 + 1) * val(a, k) + (t3 - 2 * t2 + t) * h * m[k][i] + (-2 * t3 + 3 * t2) * val(b, k) + (t3 - t2) * h * m[k][i + 1];
    out[k] = k === "r" ? Math.exp(v) : v;
  }
  out.name = t < 0.5 ? a.name : b.name;
  return out;
}
