import { test } from "node:test";
import assert from "node:assert/strict";
import { keccak256, recoverAddress } from "./sig.mjs";

test("keccak-256 matches the known vectors", () => {
  assert.equal(keccak256(Buffer.alloc(0)).toString("hex"), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(keccak256(Buffer.from("Transfer(address,address,uint256)")).toString("hex"), "ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
  assert.equal(keccak256(Buffer.alloc(136, 0x61)).length, 32); // exactly one rate block still pads into a second
});

// signatures made with ethers' Wallet.signMessage
test("recovers the personal_sign signer", () => {
  const msg = "Polaris Terminal API key\nwallet: 0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a\nissued: 2026-11-14T00:00:00.000Z";
  const sig = "0xeb464cf1cce2ee9320c9a0c5ceab6279d3281e8981e7b177f2759996954180cd105bc99303d012916029e1552601ebc236fb10987a5e6649bdad75335d59b8181b";
  assert.equal(recoverAddress(msg, sig), "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a");
  assert.equal(recoverAddress("gm", "0xb614b446d486eabec8f5bd90f241ab9b16b294d2cf60423fde8668ad8dbb4b0f500fda80114f2a0cb466bda735ffbc1727c2d87f1b06025d67b6ee57b9bdc5901b"), "0x1e4e0351424123871305c2ce3bc4a955b183bff5");
  assert.notEqual(recoverAddress(msg + " ", sig), "0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a");
  assert.equal(recoverAddress(msg, "0x1234"), null);
});
