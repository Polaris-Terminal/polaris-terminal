// Decoding helpers for raw RPC results.

// Decodes an eth_call result that returns a string: ABI-encoded `string`, or the legacy `bytes32` some tokens use.
export function abiString(h) {
  const b = Buffer.from(h.slice(2), "hex");
  if (b.length >= 64 && b.readUInt32BE(28) === 32) return b.subarray(64, 64 + b.readUInt32BE(60)).toString("utf8").replace(/\0/g, "");
  return b.subarray(0, 32).toString("utf8").replace(/\0/g, "");
}

const ZERO = "0x" + "0".repeat(64);
// Folds ERC-20 Transfer logs (oldest first) into net supply minted, mint count and holders with a positive balance.
export function transferStats(logs) {
  const bal = new Map();
  let minted = 0n, mints = 0, n = 0;
  for (const l of logs) {
    if (l.topics.length !== 3) continue; // ERC-721 transfers carry the id as a 4th topic
    const v = BigInt(l.data.length > 2 ? l.data.slice(0, 66) : 0), [, from, to] = l.topics;
    n++;
    if (from === ZERO) { minted += v; mints++; } else bal.set(from, (bal.get(from) || 0n) - v);
    if (to === ZERO) minted -= v; else bal.set(to, (bal.get(to) || 0n) + v);
  }
  return { minted, mints, transfers: n, holders: [...bal.values()].filter((b) => b > 0n).length };
}
