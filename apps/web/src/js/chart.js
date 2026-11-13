// Line chart in SVG with a hover crosshair. Used for vault projections and chain history.
// points: [{x, y}], baseline: optional flat reference, fmtX/fmtY for axis and tooltip labels.
export function lineChart(box, { points, baseline, fmtX, fmtY, tipHtml }) {
  const svg = box.querySelector("svg"), tip = box.querySelector(".chart-tip");
  const W = box.clientWidth || 600, H = box.clientHeight || 220, padL = 4, padB = 22, padT = 8;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y).concat(baseline ?? []);
  const x0 = Math.min(...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const pad = (y1 - y0) * 0.12 || y1 * 0.02 || 1;
  y0 -= pad; y1 += pad;
  const X = (x) => padL + ((x - x0) / (x1 - x0 || 1)) * (W - padL * 2);
  const Y = (y) => padT + (1 - (y - y0) / (y1 - y0 || 1)) * (H - padT - padB);
  const path = points.map((p, i) => `${i ? "L" : "M"}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join("");
  const ticks = [0.25, 0.5, 0.75].map((f) => y0 + (y1 - y0) * f);
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => x0 + (x1 - x0) * f);
  svg.innerHTML = `
    <g class="grid">${ticks.map((t) => `<line x1="0" x2="${W}" y1="${Y(t)}" y2="${Y(t)}"/>`).join("")}</g>
    ${baseline != null ? `<line class="base" x1="0" x2="${W}" y1="${Y(baseline)}" y2="${Y(baseline)}"/>` : ""}
    <path class="area" d="${path}L${X(x1)},${H - padB}L${X(x0)},${H - padB}Z"/>
    <path class="ln" d="${path}"/>
    ${xt.map((t, i) => `<text class="axis" x="${X(t)}" y="${H - 4}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${fmtX(t)}</text>`).join("")}
    <line class="cross" x1="0" x2="0" y1="${padT}" y2="${H - padB}" visibility="hidden"/>
    <circle class="cross-dot" r="4" fill="var(--accent)" stroke="var(--bg)" stroke-width="2" visibility="hidden"/>`;
  const cross = svg.querySelector(".cross"), dot = svg.querySelector(".cross-dot");
  box.onpointermove = (e) => {
    const r = box.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const p = points[Math.round(fx * (points.length - 1))];
    const px = X(p.x), py = Y(p.y);
    cross.setAttribute("x1", px); cross.setAttribute("x2", px); cross.setAttribute("visibility", "visible");
    dot.setAttribute("cx", px); dot.setAttribute("cy", py); dot.setAttribute("visibility", "visible");
    if (tip) {
      tip.hidden = false;
      tip.innerHTML = tipHtml ? tipHtml(p) : `${fmtX(p.x)} · <b>${fmtY(p.y)}</b>`;
      const left = (px / W) * r.width;
      tip.style.left = Math.min(Math.max(0, left - tip.offsetWidth / 2), r.width - tip.offsetWidth) + "px";
    }
  };
  box.onpointerleave = () => { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); if (tip) tip.hidden = true; };
}

export function projection(amount, apy, days, steps = 60) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const d = (days * i) / steps;
    pts.push({ x: d, y: amount * Math.pow(1 + apy / 100, d / 365) });
  }
  return pts;
}
