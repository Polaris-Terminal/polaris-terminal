import { test } from "node:test";
import assert from "node:assert/strict";
import { replay, grade, trackRecord, stockClaim } from "./signals.mjs";

const topic = (a) => "0x" + a.padStart(64, "0");
const A = (a) => "0x" + a.padStart(40, "0");
let tx = 0;
const log = (b, from, to, v, hash = "0x" + (++tx).toString(16)) => ({ blockNumber: "0x" + b.toString(16), transactionHash: hash, topics: ["0xddf2", topic(from), topic(to)], data: "0x" + v.toString(16).padStart(64, "0") });

// 1 block = 1 second: born at block 0, head at block 172800 (48h)
const H = 3600, now = 172_800_000, ctx = { bornAt: 0, bornBlock: 0, head: 172_800, now, creator: A("c"), pools: new Set([A("p")]), verified: true };

test("replay builds a 15 minute score history and the holders at 1h and 24h", () => {
  const r = replay([log(0, "0", "c", 1000n), log(10, "c", "a", 10n), log(2 * H, "c", "b", 10n), log(25 * H, "c", "d", 10n)], ctx);
  assert.equal(r.holders, 4);
  assert.equal(r.series.length, 48 * 4 + 1); // every 15 minutes, plus now
  assert.equal(r.snap.h1.holders, 2);
  assert.equal(r.snap.h24.holders, 3);
  assert.ok(r.series.every((p) => p.score >= 1 && p.score <= 99));
});

test("liquidity, deployer sells and the launch bundle come out of the transfers", () => {
  const r = replay([
    log(0, "0", "c", 1000n),
    log(100, "c", "p", 500n),           // liquidity opened
    log(110, "p", "s1", 50n), log(120, "p", "s2", 50n), // inside the first 30s of trading
    log(500, "p", "late", 50n),         // after the bundle window
    log(900, "c", "p", 200n),           // deployer sells 20%
  ], ctx);
  assert.deepEqual(r.events.map((e) => e.kind), ["liquidity", "sell"]);
  assert.equal(r.creator.soldPct, 20);  // the LP seed is liquidity, not a sell
  assert.equal(r.cluster.bundle, 2);
  assert.equal(r.cluster.bundleShare, 10);
});

test("a one-transaction split into three or more wallets is a cluster", () => {
  const r = replay([log(0, "0", "c", 1000n), log(5, "c", "x", 100n, "0xs"), log(5, "c", "y", 100n, "0xs"), log(5, "c", "z", 100n, "0xs"), log(9, "c", "w", 10n)], ctx);
  assert.equal(r.cluster.splits, 1);
  assert.equal(r.cluster.largestSplit, 3);
  assert.equal(r.cluster.share, 30);
  assert.equal(r.cluster.level, "high");
});

test("a falling score raises one drop alert", () => {
  const logs = [log(0, "0", "c", 1000n)];
  for (let i = 0; i < 300; i++) logs.push(log(60 + i, "c", "h" + i, 1n));            // 300 holders in the first minutes
  for (let i = 0; i < 300; i++) logs.push(log(3 * H + i, "h" + i, "c", 1n));         // all of them gone at 3h
  const r = replay(logs, ctx);
  assert.equal(r.events.filter((e) => e.kind === "drop").length, 1);
});

test("grade sorts a day-old token into thrived, faded or rugged", () => {
  const series = [{ t: 0, holders: 30 }];
  assert.equal(grade({ series, snap: { h1: { score: 40, holders: 10 }, h24: { score: 40, holders: 30, sold: 0 } } }).outcome, "thrived");
  assert.equal(grade({ series, snap: { h1: { score: 40, holders: 10 }, h24: { score: 40, holders: 12, sold: 30 } } }).outcome, "rugged");
  assert.equal(grade({ series: [{ t: 0, holders: 12 }], snap: { h1: { score: 40, holders: 10 }, h24: { score: 40, holders: 12, sold: 0 } } }).outcome, "faded");
  assert.equal(grade({ series, snap: { h1: { score: 40, holders: 10 } } }), null);
  const tr = trackRecord([{ early: 45, outcome: "thrived", holders24h: 30 }, { early: 50, outcome: "rugged", holders24h: 2 }]);
  assert.equal(tr.bands[2].n, 2);
  assert.equal(tr.bands[2].thrived, 0.5);
});

test("stock claims: canonical, imitation, and plain tokens", () => {
  const stocks = { official: new Map([["0xaa", "TSLA"]]), tickers: new Map([["TSLA", { address: "0xaa" }], ["P", { address: "0xbb" }]]) };
  assert.deepEqual(stockClaim({ address: "0xAA", symbol: "TSLA" }, stocks), { ticker: "TSLA", official: true });
  assert.equal(stockClaim({ address: "0xcc", symbol: "tsla", name: "Tesla" }, stocks).official, false);
  assert.equal(stockClaim({ address: "0xcc", symbol: "P", name: "Pepe" }, stocks), null);
  assert.equal(stockClaim({ address: "0xcc", symbol: "P", name: "Everpure Stock Token" }, stocks).canonical, "0xbb");
  assert.equal(stockClaim({ address: "0xcc", symbol: "DOGE", name: "Doge" }, stocks), null);
});
