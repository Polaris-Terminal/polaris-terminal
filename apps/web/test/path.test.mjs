import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPath, samplePath } from "../src/js/path.js";

const pose = (at, x, rest = false) => ({ at, x, y: 0.5, r: 0.4, dim: 1, ov: 0, rest, name: "c" + at });

test("hits every chapter pose exactly and clamps outside the range", () => {
  const p = buildPath([pose(0, 0.5, true), pose(1000, 0.7), pose(2000, 0.6, true)]);
  assert.equal(samplePath(p, -50).x, 0.5);
  assert.ok(Math.abs(samplePath(p, 1000).x - 0.7) < 1e-9);
  assert.equal(samplePath(p, 9000).x, 0.6);
});

test("a change of side arcs through an inserted transit pose", () => {
  const p = buildPath([pose(0, 0.8, true), pose(1000, 0.1, true)]);
  assert.equal(p.pts.length, 3);
  assert.equal(p.pts[1].name, "transit");
  assert.ok(p.pts[1].y > 0.5, "moving left dips below the line");
});

test("never overshoots between poses and dwells at a resting chapter", () => {
  const p = buildPath([pose(0, 0.5, true), pose(800, 0.9), pose(1600, 0.7), pose(2400, 0.72, true)]);
  for (let y = 0; y <= 2400; y += 10) {
    const x = samplePath(p, y).x;
    assert.ok(x >= 0.5 - 1e-9 && x <= 0.9 + 1e-9, `x=${x} at ${y}`);
  }
  assert.ok(Math.abs(samplePath(p, 2390).x - 0.72) < 1e-3, "flat into the resting pose");
});
