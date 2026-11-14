// Constellation (v3.0) pieces the API and the browser must agree on, shipped to the web build as js/rules.js:
// Custom Rules (a Drift filter typed like a shell expression) and the exact text wallets sign.

// score>=60 holders>=25 age<6h verified !fake
const NUM = { score: (t) => t.score, holders: (t) => t.holders || 0, mints: (t) => t.mints || 0, age: (t) => t.ageMin };
const FLAG = { verified: (t) => !!t.verified, stock: (t) => !!t.stock?.official, fake: (t) => !!t.stock && !t.stock.official, direct: (t) => !t.launchpad };
const OPS = { ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, ">": (a, b) => a > b, "<": (a, b) => a < b, "=": (a, b) => a === b, "!=": (a, b) => a !== b };
const AGE = { "": 1, m: 1, h: 60, d: 1440 };
export const RULE_FIELDS = [...Object.keys(NUM), ...Object.keys(FLAG)];

export function parseRule(text) {
  const parts = String(text ?? "").toLowerCase().replace(/\s*(>=|<=|!=|>|<|=)\s*/g, "$1").split(/[\s,]+/).filter((p) => p && p !== "and" && p !== "&&");
  if (!parts.length) throw new Error("empty rule · try score>=60 holders>=25 age<6h");
  if (parts.length > 8) throw new Error("a rule holds up to 8 conditions");
  return parts.map((p) => {
    const f = p.match(/^(!?)([a-z]+)$/);
    if (f && FLAG[f[2]]) return { flag: f[2], not: !!f[1] };
    const m = p.match(/^([a-z]+)(>=|<=|!=|>|<|=)(\d+(?:\.\d+)?)([mhd]?)$/);
    if (!m || !NUM[m[1]] || (m[4] && m[1] !== "age")) throw new Error(`cannot read "${p}" · fields: ${RULE_FIELDS.join(", ")}`);
    return { field: m[1], op: m[2], value: +m[3] * AGE[m[4]] };
  });
}

export const matches = (conds, t) => conds.every((c) => (c.flag ? FLAG[c.flag](t) !== c.not : OPS[c.op](NUM[c.field](t), c.value)));

// ---------- signed messages (personal_sign) ----------
// Governance ballots spread 100 points over the signals Polaris weighs or could weigh next.
export const SIGNALS = ["holders", "activity", "fresh", "source", "cluster", "deployer"];
export const keyText = (wallet, at) => `Polaris Terminal API key\nwallet: ${wallet}\nissued: ${at}`;
export const ballotText = (wallet, ballot, at) => `Polaris signal governance\nwallet: ${wallet}\nballot: ${SIGNALS.map((k) => `${k}=${ballot[k]}`).join(" ")}\nsigned: ${at}`;
