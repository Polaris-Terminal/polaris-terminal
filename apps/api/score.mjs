// North Score: how strongly a freshly born token is pulling the Drift, from 1 to 99.
// Weighs holder spread, mint activity and freshness; unverified contracts are discounted.
export function northScore(t, now = Date.now(), windowMs = 48 * 3600e3) {
  const clamp = (x) => Math.min(1, Math.max(0, x));
  const holders = clamp(Math.log10((t.holders || 0) + 1) / Math.log10(5000));
  const activity = clamp(Math.log10((t.mints || 0) + 1) / 3);
  const fresh = clamp(1 - (now - t.bornAt) / windowMs) * 0.8 + 0.2;
  const trust = t.verified ? 1 : 0.7;
  const raw = (0.45 * holders + 0.3 * activity + 0.25 * fresh) * trust;
  return { score: Math.max(1, Math.min(99, Math.round(raw * 100))), f: { holders, activity, fresh, trust } };
}

// Births per hour for the last `hours` hours, oldest first; the last bucket is the hour that ends now.
export function hourly(bornAts, now = Date.now(), hours = 24) {
  const out = new Array(hours).fill(0);
  for (const b of bornAts) {
    const k = Math.floor((now - b) / 3600e3);
    if (k >= 0 && k < hours) out[hours - 1 - k]++;
  }
  return out;
}

// Vault score used by the terminal (same shape as the yield ranking it was modelled on):
// APY discounted by deposit depth and withdrawable liquidity, both on a log scale.
export function vaultScore(v) {
  if (!v.apy || !v.tvl) return 0;
  const depth = Math.min(1, Math.max(0.3, Math.log10(v.tvl) / 9));
  const liq = Math.min(1, Math.max(0.3, Math.log10(Math.max(v.liq ?? v.tvl, 1)) / 7));
  return v.apy * depth * liq;
}
