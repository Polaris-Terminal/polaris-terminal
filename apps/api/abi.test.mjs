import { test } from "node:test";
import assert from "node:assert/strict";
import { abiString } from "./abi.mjs";

test("decodes ABI strings and bytes32 symbols", () => {
  const word = (n) => n.toString(16).padStart(64, "0");
  const text = Buffer.from("Polaris").toString("hex").padEnd(64, "0");
  assert.equal(abiString("0x" + word(32) + word(7) + text), "Polaris");
  assert.equal(abiString("0x" + Buffer.from("MKR").toString("hex").padEnd(64, "0")), "MKR");
  assert.equal(abiString("0x"), "");
});
