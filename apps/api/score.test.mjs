import { test } from "node:test";
import assert from "node:assert/strict";
import { northScore, vaultScore, hourly } from "./score.mjs";

const now = Date.now();

test("north score stays inside 1..99", () => {
  assert.ok(northScore({ holders: 0, mints: 0, bornAt: now - 100 * 3600e3 }, now).score >= 1);
  assert.ok(northScore({ holders: 1e9, mints: 1e9, bornAt: now, verified: true }, now).score <= 99);
});

test("more holders, more mints and fresher tokens rank higher", () => {
  const base = { holders: 40, mints: 12, bornAt: now - 6 * 3600e3, verified: true };
  const s = (t) => northScore({ ...base, ...t }, now).score;
  assert.ok(s({ holders: 900 }) > s({}));
  assert.ok(s({ mints: 400 }) > s({}));
  assert.ok(s({ bornAt: now - 600e3 }) > s({}));
  assert.ok(s({ verified: false }) < s({}));
});

test("vault score discounts thin vaults", () => {
  assert.equal(vaultScore({ apy: 0, tvl: 1e6 }), 0);
  assert.ok(vaultScore({ apy: 9, tvl: 5e8 }) > vaultScore({ apy: 9, tvl: 2e4 }));
});

test("hourly buckets births oldest first and drops the future and the old", () => {
  const now = 100 * 3600e3;
  const h = hourly([now - 10, now - 3600e3 - 1, now - 23.5 * 3600e3, now - 25 * 3600e3, now + 5], now, 24);
  assert.equal(h.length, 24);
  assert.equal(h[23], 1); // within the last hour
  assert.equal(h[22], 1); // just over an hour ago
  assert.equal(h[0], 1);  // 23.5h ago
  assert.equal(h.reduce((a, b) => a + b), 3);
});
