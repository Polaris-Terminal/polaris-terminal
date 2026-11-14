// Orbit (v2.0) signals: everything a token's own Transfer history says about it, replayed in block order.
// Pure functions over raw RPC logs, so the API, the tests and anyone re-running them get the same answer.
import { northScore } from "./score.mjs";

const ZERO = "0x" + "0".repeat(64);
const STEP = 15 * 60e3;       // score history resolution
const SNIPE_MS = 30e3;        // buyers inside the first 30s of trading count as the launch bundle
const FANOUT = 3;             // one transaction seeding this many fresh wallets is a coordinated split
const DROP = 15;              // a score falling this far below its last-hour high raises an alert
const addr = (topic) => "0x" + topic.slice(26);

// Replays ERC-20 Transfer logs (oldest first) for one token.
// ctx: { bornAt, bornBlock, head, now, creator, pools: Set of lowercase pool addresses, verified, windowMs }
// Log timestamps from the Robinhood RPC are mostly zero, so block times are interpolated between birth and head.
export function replay(logs, ctx) {
  const { bornAt, bornBlock, head, now, verified, windowMs = 48 * 3600e3 } = ctx;
  const pools = ctx.pools || new Set(), creator = ctx.creator?.toLowerCase();
  const msPerBlock = (now - bornAt) / Math.max(1, head - bornBlock);
  const timeOf = (b) => Math.min(now, bornAt + (b - bornBlock) * msPerBlock);

  const bal = new Map();
  let holders = 0, mints = 0, minted = 0n, transfers = 0;
  const move = (a, v) => {
    const was = bal.get(a) || 0n, is = was + v;
    bal.set(a, is);
    if (was <= 0n && is > 0n) holders++;
    else if (was > 0n && is <= 0n) holders--;
  };

  const series = [], events = [];
  let nextT = bornAt + STEP;
  const sample = (t) => series.push({ t, score: northScore({ holders, mints, bornAt, verified }, t, windowMs).score, holders });
  const snap = {}; // holders/score/creator sold at 1h and 24h of age, for the track record
  const snapAt = (t) => {
    for (const [k, ms] of [["h1", 3600e3], ["h24", 24 * 3600e3]]) if (!snap[k] && t - bornAt >= ms) snap[k] = { score: series.at(-1)?.score ?? 1, holders, sold: soldPct() };
  };

  let sold = 0n, out = 0n, firstTrade = null, liquidityAt = null;
  const soldPct = () => (minted > 0n ? Number((sold * 10000n) / minted) / 100 : 0);
  const early = new Set(), byTx = new Map();

  for (const l of logs) {
    if (l.topics.length !== 3) continue; // ERC-721 transfers carry the id as a 4th topic
    const b = Number(l.blockNumber), t = timeOf(b);
    while (nextT <= t) { sample(nextT); snapAt(nextT); nextT += STEP; }
    const v = BigInt(l.data.length > 2 ? l.data.slice(0, 66) : 0), [, fromT, toT] = l.topics;
    const from = fromT === ZERO ? null : addr(fromT), to = toT === ZERO ? null : addr(toT);
    transfers++;
    if (!from) { minted += v; mints++; } else move(from, -v);
    if (!to) minted -= v; else move(to, v);

    const opening = to && pools.has(to) && !liquidityAt; // the transfer that seeds a pool is liquidity, not a sell
    if (opening) { liquidityAt = t; events.push({ at: t, kind: "liquidity", text: "liquidity opened" }); }
    if (from && pools.has(from) && to && !pools.has(to)) {
      if (firstTrade == null) firstTrade = t;
      if (t - firstTrade <= SNIPE_MS && to !== creator) early.add(to);
    }
    if (from && from === creator && to) {
      out += v;
      if (pools.has(to) && !opening) {
        sold += v;
        const p = minted > 0n ? Number((v * 10000n) / minted) / 100 : 0;
        if (p >= 0.5) events.push({ at: t, kind: "sell", text: `deployer sold ${p.toFixed(1)}% of supply` });
      }
    }
    if (to && !pools.has(to) && to !== creator && (!from || !pools.has(from))) {
      const k = l.transactionHash, s = byTx.get(k) || new Set();
      s.add(to); byTx.set(k, s);
    }
  }
  while (nextT <= now) { sample(nextT); snapAt(nextT); nextT += STEP; }
  sample(now);
  snapAt(now);

  // score drops: a sample sitting DROP points under the high of the hour before it
  for (let i = 4; i < series.length; i++) {
    const high = Math.max(...series.slice(i - 4, i).map((p) => p.score));
    if (high - series[i].score >= DROP && !events.some((e) => e.kind === "drop" && series[i].t - e.at < 3600e3)) {
      events.push({ at: series[i].t, kind: "drop", text: `North Score fell ${high - series[i].score} points to ${series[i].score}` });
    }
  }

  // clusters: the launch bundle and every one-transaction split into FANOUT+ wallets
  const fanouts = [...byTx.values()].filter((s) => s.size >= FANOUT).sort((a, b) => b.size - a.size);
  const clustered = new Set([...early, ...fanouts.flatMap((s) => [...s])]);
  const share = (set) => {
    if (minted <= 0n) return 0;
    let n = 0n;
    for (const a of set) { const b = bal.get(a) || 0n; if (b > 0n) n += b; }
    return Number((n * 10000n) / minted) / 100;
  };
  const holdersList = [...bal.entries()].filter(([a, b]) => b > 0n && !pools.has(a)).sort((x, y) => (y[1] > x[1] ? 1 : -1));
  const top10 = share(new Set(holdersList.slice(0, 10).map(([a]) => a)));
  const clusterShare = share(clustered);

  return {
    holders, mints, transfers, minted: minted.toString(),
    series, events: events.sort((a, b) => a.at - b.at),
    liquidityAt, firstTrade,
    creator: { soldPct: soldPct(), outPct: minted > 0n ? Number((out * 10000n) / minted) / 100 : 0, holdPct: share(new Set(creator ? [creator] : [])) },
    cluster: {
      bundle: early.size, bundleShare: share(early),
      splits: fanouts.length, largestSplit: fanouts[0]?.size || 0,
      wallets: clustered.size, share: clusterShare, top10,
      level: clusterShare >= 30 || top10 >= 70 ? "high" : clusterShare >= 10 || top10 >= 40 ? "watch" : "clear",
    },
    snap,
  };
}

// Outcome of a token one day after birth, judged only from its own chain history.
export function grade(r) {
  const a = r.snap?.h1, b = r.snap?.h24;
  if (!a || !b) return null;
  const peak = Math.max(0, ...r.series.filter((p) => p.t <= r.series[0].t + 24 * 3600e3).map((p) => p.holders));
  const outcome = b.sold >= 25 || (peak >= 10 && b.holders < peak / 2) ? "rugged"
    : b.holders >= 25 && b.holders >= a.holders * 2 ? "thrived" : "faded";
  return { early: a.score, holders1h: a.holders, holders24h: b.holders, sold24h: b.sold, outcome };
}

// Track record: how tokens did a day later, bucketed by the score they showed at one hour old.
export function trackRecord(graded) {
  const bands = [[1, 19], [20, 39], [40, 59], [60, 79], [80, 99]].map(([lo, hi]) => {
    const g = graded.filter((x) => x.early >= lo && x.early <= hi);
    const n = g.length, k = (o) => g.filter((x) => x.outcome === o).length;
    const hs = g.map((x) => x.holders24h).sort((p, q) => p - q);
    return { band: `${lo}-${hi}`, n, thrived: n ? k("thrived") / n : 0, faded: n ? k("faded") / n : 0, rugged: n ? k("rugged") / n : 0, medianHolders: hs[Math.floor(hs.length / 2)] || 0 };
  });
  return { graded: graded.length, bands };
}

// Does a token claim to be a Robinhood stock token, and is it the canonical contract?
// stocks: { official: Map(address -> ticker), tickers: Map(TICKER -> { name, address }) }
export function stockClaim(t, stocks) {
  const a = t.address.toLowerCase(), sym = String(t.symbol || "").replace(/^\$/, "").toUpperCase();
  if (stocks.official.has(a)) return { ticker: stocks.official.get(a), official: true };
  const named = /robinhood token|stock token/i.test(t.name || ""), hit = stocks.tickers.get(sym);
  // one-letter tickers only count when the name also claims to be a stock token
  if (hit && (sym.length >= 2 || named)) return { ticker: sym, official: false, canonical: hit.address || null };
  return named ? { ticker: sym || "?", official: false, canonical: null } : null;
}

// ---------- Constellation (v3.0) ----------
// Portfolio Scan: what a holding's own signals say about it. h: { score, cluster, soldPct, outcome, stock }
export function riskOf(h) {
  if (h.stock?.official) return { level: "clear", reasons: ["canonical stock token"] };
  const high = [
    h.stock && `imitates ${h.stock.ticker}`,
    h.outcome === "rugged" && "rugged in its first day",
    h.cluster === "high" && "supply sits with linked wallets",
    h.soldPct >= 25 && `deployer sold ${Math.round(h.soldPct)}%`,
  ].filter(Boolean);
  const watch = [
    h.cluster === "watch" && "clustered holders",
    h.soldPct >= 5 && h.soldPct < 25 && `deployer sold ${Math.round(h.soldPct)}%`,
    h.score != null && h.score < 20 && "weak pull",
    h.outcome === "faded" && "faded after a day",
  ].filter(Boolean);
  return { level: high.length ? "high" : watch.length ? "watch" : "clear", reasons: [...high, ...watch] };
}

// Signal Governance: every ballot weighed by the $POLARIS its wallet holds now.
// votes: [{ ballot: { signal: points } }], weights: whole tokens per vote, same order.
export function tally(votes, weights, signals) {
  const mix = Object.fromEntries(signals.map((k) => [k, 0]));
  let weight = 0, voters = 0;
  votes.forEach((v, i) => {
    if (!(weights[i] > 0)) return;
    weight += weights[i]; voters++;
    for (const k of signals) mix[k] += v.ballot[k] * weights[i];
  });
  for (const k of signals) mix[k] = weight ? Math.round((mix[k] / weight) * 10) / 10 : 0;
  return { voters, weight, mix };
}

// Score Widget: a shields-style SVG badge. Every string is XML-escaped; symbols come from chain data.
const xml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);
export function badgeSvg({ symbol, score, note }) {
  const left = "POLARIS", right = symbol ? `$${String(symbol).slice(0, 12)} ${score != null ? "NS " + score : note}` : note;
  const color = score == null ? "#7a8f80" : score >= 60 ? "#00ff41" : score >= 30 ? "#ffd60a" : "#ff3d61";
  const wl = 16 + left.length * 7 + 14, wr = right.length * 7 + 16, w = wl + wr;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${xml(left + ": " + right)}"><title>${xml(left + ": " + right)}</title>`
    + `<rect width="${w}" height="20" rx="3" fill="#010603"/><rect x="${wl}" width="${wr}" height="20" rx="3" fill="${color}" fill-opacity="0.16"/><rect x="${wl}" width="${wr}" height="20" fill="none" stroke="${color}" stroke-opacity="0.5" rx="3"/>`
    + `<path transform="translate(9 10) scale(0.36)" fill="#00ff41" d="M0,-15Q1.6,-1.6 12,0Q1.6,1.6 0,15Q-1.6,1.6 -12,0Q-1.6,-1.6 0,-15Z"/>`
    + `<g font-family="ui-monospace,Menlo,Consolas,monospace" font-size="11" fill="#d6ffe0"><text x="18" y="14">${left}</text><text x="${wl + 8}" y="14" fill="${color}">${xml(right)}</text></g></svg>`;
}
