import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRule, matches, ballotText, SIGNALS } from "./rules.mjs";

const tok = { score: 64, holders: 30, mints: 4, ageMin: 200, verified: true, launchpad: "0xpad", stock: null };

test("custom rules read like a shell filter", () => {
  assert.ok(matches(parseRule("score>=60 holders>=25 age<6h verified"), tok));
  assert.ok(matches(parseRule("score >= 60 and !fake, !direct"), tok));
  assert.ok(!matches(parseRule("age<3h"), tok));
  assert.ok(!matches(parseRule("holders>30"), tok));
  assert.ok(matches(parseRule("fake"), { ...tok, stock: { ticker: "TSLA", official: false } }));
  assert.deepEqual(parseRule("age<1d"), [{ field: "age", op: "<", value: 1440 }]);
});

test("rules reject what they cannot read", () => {
  for (const bad of ["", "price>1", "score>=", "holders>5h", "a b c d e f g h i"]) assert.throws(() => parseRule(bad));
});

test("the ballot text lists every signal in a fixed order", () => {
  const b = Object.fromEntries(SIGNALS.map((k, i) => [k, i ? 10 : 50]));
  assert.equal(ballotText("0xab", b, "T"), "Polaris signal governance\nwallet: 0xab\nballot: holders=50 activity=10 fresh=10 source=10 cluster=10 deployer=10\nsigned: T");
});
