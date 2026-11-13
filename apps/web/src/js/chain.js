// On-chain reads for North Vaults and the Beacon. Addresses come from the deploy manifest, never from an API.
import { CONFIG, ethCall, sel, encAddr, encU, word, fromUnits, rpc } from "./core.js";

const YEAR = 31_536_000;
const A = CONFIG.asset;

// Same ranking shape as the API: APY discounted by depth and withdrawable liquidity on a log scale.
export function vaultScore(v) {
  if (!v.apy || !v.tvl) return 0;
  const depth = Math.min(1, Math.max(0.3, Math.log10(v.tvl) / 9));
  const liq = Math.min(1, Math.max(0.3, Math.log10(Math.max(v.liq ?? v.tvl, 1)) / 7));
  v.f = { depth, liq };
  return v.apy * depth * liq;
}

export async function loadVaults() {
  const vaults = CONFIG.vaults.map((v) => ({ ...v }));
  await Promise.all(vaults.map(async (v) => {
    const [ta, locked, end, active, asset] = await Promise.all([
      ethCall(v.address, sel("PolarisVault", "totalAssets")),
      ethCall(v.address, sel("PolarisVault", "lockedRewards")),
      ethCall(v.address, sel("PolarisVault", "rewardEnd")),
      CONFIG.registry ? ethCall(CONFIG.registry, sel("PolarisRegistry", "isActive") + encAddr(v.address)) : "0x1",
      ethCall(v.address, sel("PolarisVault", "asset")),
    ]);
    v.tvl = fromUnits(word(ta, 0), A.decimals);
    v.liq = v.tvl; // ERC-4626 vault holds its assets idle, so all of it is withdrawable
    v.rewardEnd = Number(word(end, 0)) * 1000;
    // locked / time left equals rewardRate() but keeps the fraction the contract's integer division drops on small vaults
    v.rate = fromUnits(word(locked, 0), A.decimals) / Math.max(1, (v.rewardEnd - Date.now()) / 1000);
    v.apy = v.tvl ? (v.rate * YEAR) / v.tvl * 100 : 0;
    v.ok = word(active, 0) === 1n && ("0x" + asset.slice(-40)).toLowerCase() === A.address.toLowerCase();
  }));
  vaults.forEach((v) => (v.score = vaultScore(v)));
  const ranked = vaults.filter((v) => v.ok && v.score).sort((a, b) => b.score - a.score);
  return { vaults, ranked, pick: ranked[0] };
}

export async function loadBalances(account) {
  const out = { eth: 0, asset: 0n, shares: {}, assets: {}, allowance: {} };
  const [eth, bal] = await Promise.all([
    rpc("eth_getBalance", [account, "latest"]),
    ethCall(A.address, sel("ERC20", "balanceOf") + encAddr(account)),
  ]);
  out.eth = Number(BigInt(eth)) / 1e18;
  out.asset = word(bal, 0);
  await Promise.all(CONFIG.vaults.map(async (v) => {
    const [sh, al] = await Promise.all([
      ethCall(v.address, sel("PolarisVault", "balanceOf") + encAddr(account)),
      ethCall(A.address, sel("ERC20", "allowance") + encAddr(account) + encAddr(v.address)),
    ]);
    out.shares[v.address] = word(sh, 0);
    out.allowance[v.address] = word(al, 0);
    out.assets[v.address] = out.shares[v.address]
      ? word(await ethCall(v.address, sel("PolarisVault", "convertToAssets") + encU(out.shares[v.address])), 0)
      : 0n;
  }));
  return out;
}

export async function loadBeacon(account) {
  const b = CONFIG.beacon;
  const [today, observers, total] = await Promise.all([
    ethCall(b, sel("PolarisBeacon", "today")),
    ethCall(b, sel("PolarisBeacon", "observers")),
    ethCall(b, sel("PolarisBeacon", "totalPings")),
  ]);
  const out = { today: Number(word(today, 0)), observers: Number(word(observers, 0)), totalPings: Number(word(total, 0)) };
  if (account) {
    const s = await ethCall(b, sel("PolarisBeacon", "stars") + encAddr(account));
    const live = await ethCall(b, sel("PolarisBeacon", "liveStreak") + encAddr(account));
    out.me = {
      streak: Number(word(s, 0)), best: Number(word(s, 1)), pings: Number(word(s, 2)), lastDay: Number(word(s, 3)), xp: Number(word(s, 4)),
      live: Number(word(live, 0)),
    };
    out.me.pingedToday = out.me.pings > 0 && out.me.lastDay === out.today;
    const next = out.me.pingedToday ? out.me.live : out.me.live + 1;
    out.me.nextGain = Number(word(await ethCall(b, sel("PolarisBeacon", "previewGain") + encAddr(account) + encU(Math.max(1, next))), 0));
  }
  return out;
}
