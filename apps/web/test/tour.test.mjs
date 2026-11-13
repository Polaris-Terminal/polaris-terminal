import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.matchMedia = () => ({ matches: false }); // fx.js reads it on import
const { place } = await import("../src/js/tour.js");

const card = { w: 300, h: 160 };

test("no target centres the card", () => {
  assert.deepEqual(place(null, card, 1000, 800), { x: 350, y: 320, side: "center" });
});

test("prefers below, then above, then beside, then pins to the bottom", () => {
  assert.equal(place({ x: 100, y: 100, w: 200, h: 100 }, card, 1000, 800).side, "below");
  assert.equal(place({ x: 100, y: 600, w: 200, h: 100 }, card, 1000, 800).side, "above");
  const tall = { x: 40, y: 100, w: 500, h: 640 };
  assert.deepEqual(place(tall, card, 1000, 800), { x: 554, y: 340, side: "right" });
  assert.equal(place({ ...tall, x: 460 }, card, 1000, 800).side, "left");
  const over = place({ x: 0, y: 40, w: 1000, h: 700 }, card, 1000, 800);
  assert.equal(over.side, "over");
  assert.equal(over.y, 800 - 160 - 12);
});

test("stays inside the viewport horizontally", () => {
  assert.equal(place({ x: -50, y: 10, w: 40, h: 40 }, card, 390, 844).x, 12);
  assert.equal(place({ x: 370, y: 10, w: 40, h: 40 }, card, 390, 844).x, 390 - 300 - 12);
});
