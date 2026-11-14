// Wallet signatures without dependencies: keccak-256 and secp256k1 public key recovery for personal_sign.
// Slow BigInt math, fine for the handful of signatures the API checks (API keys, governance ballots).
const M64 = (1n << 64n) - 1n;
const ROT = [], PI = [], RC = [];
for (let round = 0, x = 1, y = 0, R = 1n; round < 24; round++) {
  [x, y] = [y, (2 * x + 3 * y) % 5];
  PI.push(x + 5 * y);
  ROT.push(BigInt((((round + 1) * (round + 2)) / 2) % 64));
  let t = 0n;
  for (let j = 0; j < 7; j++) {
    R = ((R << 1n) ^ ((R >> 7n) * 0x71n)) % 256n;
    if (R & 2n) t ^= 1n << ((1n << BigInt(j)) - 1n);
  }
  RC.push(t);
}
const rotl = (v, s) => ((v << s) | (v >> (64n - s))) & M64;

function keccakF(A) {
  for (let round = 0; round < 24; round++) {
    const C = [0, 1, 2, 3, 4].map((x) => A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1n);
      for (let y = 0; y < 25; y += 5) A[x + y] ^= D;
    }
    let cur = A[1];
    for (let t = 0; t < 24; t++) { const tmp = A[PI[t]]; A[PI[t]] = rotl(cur, ROT[t]); cur = tmp; }
    for (let y = 0; y < 25; y += 5) {
      const row = A.slice(y, y + 5);
      for (let x = 0; x < 5; x++) A[y + x] = row[x] ^ (~row[(x + 1) % 5] & M64 & row[(x + 2) % 5]);
    }
    A[0] ^= RC[round];
  }
}

export function keccak256(bytes) {
  const rate = 136, msg = Buffer.from(bytes), padded = Buffer.alloc(Math.floor(msg.length / rate + 1) * rate);
  msg.copy(padded);
  padded[msg.length] ^= 0x01;
  padded[padded.length - 1] ^= 0x80;
  const A = new Array(25).fill(0n);
  for (let o = 0; o < padded.length; o += rate) {
    for (let i = 0; i < rate / 8; i++) A[i] ^= padded.readBigUInt64LE(o + i * 8);
    keccakF(A);
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 4; i++) out.writeBigUInt64LE(A[i], i * 8);
  return out;
}

// ---------- secp256k1 ----------
const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const G = [0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n, 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n];
const mod = (a, m = P) => ((a % m) + m) % m;
function inv(a, m = P) {
  let [x0, x1, r0, r1] = [0n, 1n, m, mod(a, m)];
  while (r1) { const q = r0 / r1; [x0, x1, r0, r1] = [x1, x0 - q * x1, r1, r0 - q * r1]; }
  return mod(x0, m);
}
function pow(b, e, m = P) { let r = 1n; for (b = mod(b, m); e > 0n; e >>= 1n, b = (b * b) % m) if (e & 1n) r = (r * b) % m; return r; }
function add(p, q) {
  if (!p) return q;
  if (!q) return p;
  let l;
  if (p[0] === q[0]) {
    if (mod(p[1] + q[1]) === 0n) return null;
    l = mod(3n * p[0] * p[0] * inv(2n * p[1]));
  } else l = mod((q[1] - p[1]) * inv(q[0] - p[0]));
  const x = mod(l * l - p[0] - q[0]);
  return [x, mod(l * (p[0] - x) - p[1])];
}
function mul(p, k) { let r = null; for (; k > 0n; k >>= 1n, p = add(p, p)) if (k & 1n) r = add(r, p); return r; }

// The wallet that signed `text` with personal_sign (EIP-191), lowercase, or null for a malformed signature.
export function recoverAddress(text, sig) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig || "")) return null;
  const msg = Buffer.from(String(text), "utf8");
  const e = BigInt("0x" + keccak256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg])).toString("hex")) % N;
  const r = BigInt("0x" + sig.slice(2, 66)), s = BigInt("0x" + sig.slice(66, 130)), v = parseInt(sig.slice(130), 16);
  const rec = v >= 27 ? v - 27 : v;
  if (rec > 1 || r <= 0n || r >= N || s <= 0n || s >= N) return null;
  const y2 = mod(r ** 3n + 7n);
  let y = pow(y2, (P + 1n) / 4n);
  if ((y * y) % P !== y2) return null;
  if (Number(y & 1n) !== rec) y = P - y;
  const ri = inv(r, N), Q = add(mul([r, y], mod(s * ri, N)), mul(G, mod(-e * ri, N)));
  if (!Q) return null;
  const pub = Buffer.from(Q[0].toString(16).padStart(64, "0") + Q[1].toString(16).padStart(64, "0"), "hex");
  return "0x" + keccak256(pub).subarray(12).toString("hex");
}
