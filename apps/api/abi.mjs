// Decodes an eth_call result that returns a string: ABI-encoded `string`, or the legacy `bytes32` some tokens use.
export function abiString(h) {
  const b = Buffer.from(h.slice(2), "hex");
  if (b.length >= 64 && b.readUInt32BE(28) === 32) return b.subarray(64, 64 + b.readUInt32BE(60)).toString("utf8").replace(/\0/g, "");
  return b.subarray(0, 32).toString("utf8").replace(/\0/g, "");
}
