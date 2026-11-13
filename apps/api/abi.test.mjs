import { test } from "node:test";
import assert from "node:assert/strict";
import { abiString, transferStats } from "./abi.mjs";

test("decodes ABI strings and bytes32 symbols", () => {
  const word = (n) => n.toString(16).padStart(64, "0");
  const text = Buffer.from("Polaris").toString("hex").padEnd(64, "0");
  assert.equal(abiString("0x" + word(32) + word(7) + text), "Polaris");
  assert.equal(abiString("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0")), "MKR");
  assert.equal(abiString("0x"), "");
});

test("transfer history gives net minted supply and holders with a balance", () => {
  const topic = (a) => "0x" + a.padStart(64, "0");
  const log = (from, to, v) => ({ topics: ["0xddf2", topic(from), topic(to)], data: "0x" + v.toString(16).padStart(64, "0") });
  const s = transferStats([log("0", "a", 100n), log("0", "b", 50n), log("a", "c", 100n), log("b", "0", 20n)]);
  assert.deepEqual(s, { minted: 130n, mints: 2, transfers: 4, holders: 2 }); // a emptied; b and c hold
});
