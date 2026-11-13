// Deploys every Polaris contract behind its own PolarisProxy and writes deployments/<network>.json.
// Usage: npx hardhat run scripts/deploy.ts --network robinhoodTestnet
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import { mkdirSync, writeFileSync } from "node:fs";

const connection = await hre.network.create();
const { ethers, networkName } = connection;
const up = await upgrades(hre, connection);
const [deployer] = await ethers.getSigners();
const testnet = (await ethers.provider.getNetwork()).chainId !== 4663n; // by chain id, so a mainnet fork rehearses the mainnet path
const startBlock = await ethers.provider.getBlockNumber();
const startBalance = await ethers.provider.getBalance(deployer.address);
const usd = (n: number) => ethers.parseUnits(n.toFixed(6), 6);
const USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"; // Paxos Global Dollar on Robinhood Chain
const UNI = { router: "0xcaf681a66d020601342297493863e78c959e5cb2", quoter: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7", fee: 100 }; // Uniswap v3 SwapRouter02, QuoterV2, deepest WETH/USDG tier
const DAY = 86_400;

type Entry = { name: string; proxy: string; implementation: string; initData: string };
const out: Record<string, Entry> = {};

async function proxy(key: string, name: string, args: unknown[]) {
  const factory = await ethers.getContractFactory(name);
  const implementation = (await up.deployImplementation(factory, { kind: "uups" })) as string;
  const initData = factory.interface.encodeFunctionData("initialize", args);
  const p = await (await ethers.getContractFactory("PolarisProxy")).deploy(implementation, initData);
  await p.waitForDeployment();
  const address = await p.getAddress();
  await up.forceImport(address, factory, { kind: "uups" });
  out[key] = { name, proxy: address, implementation, initData };
  console.log(`${key.padEnd(10)} ${address}  (impl ${implementation})`);
  return ethers.getContractAt(name, address);
}

const send = async (tx: Promise<{ wait: () => Promise<unknown> }>) => (await tx).wait();

console.log(`Deploying to ${networkName} from block ${startBlock}`);
// $POLARIS launches elsewhere on mainnet, so there the Beacon starts with the holder boost off (setBoost later).
const token = testnet ? await proxy("token", "PolarisToken", [deployer.address, ethers.parseEther("1000000000")]) : null;
await proxy("beacon", "PolarisBeacon", token
  ? [deployer.address, await token.getAddress(), ethers.parseEther("10000")]
  : [deployer.address, ethers.ZeroAddress, 0]);

// Three North Vaults with different depth and yield, so the North Score has something real to rank.
// Mainnet runs the same plan at nano scale on real USDG.
const scale = testnet ? 1 : 1 / 500_000;
const plan = [
  { key: "vaultVega", name: "Vega", symbol: "nvVEGA", curator: "Polaris Labs", tvl: 184_000 * scale, apy: 0.092 },
  { key: "vaultSirius", name: "Sirius", symbol: "nvSIRIUS", curator: "Polaris Labs", tvl: 26_500 * scale, apy: 0.148 },
  { key: "vaultAltair", name: "Altair", symbol: "nvALTAIR", curator: "Polaris Labs", tvl: 512_000 * scale, apy: 0.061 },
];
const stream = 30 * DAY;
const reward = (v: (typeof plan)[number]) => usd((v.tvl * v.apy * 30) / 365);
const need = plan.reduce((s, v) => s + usd(v.tvl) + reward(v), 0n);

let assetToken;
if (testnet) {
  assetToken = await proxy("dollar", "PolarisDollar", [deployer.address, usd(10_000), DAY]);
  await send(assetToken.mint(deployer.address, need));
} else {
  assetToken = await ethers.getContractAt("PolarisDollar", USDG); // only the ERC-20 surface is used
  const short = need - (await assetToken.balanceOf(deployer.address));
  if (short > 0n) {
    const router = new ethers.Contract(UNI.router, [
      "function WETH9() view returns (address)",
      "function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96)) payable returns (uint256)",
    ], deployer);
    const quoter = new ethers.Contract(UNI.quoter, ["function quoteExactOutputSingle((address tokenIn,address tokenOut,uint256 amount,uint24 fee,uint160 sqrtPriceLimitX96)) returns (uint256,uint160,uint32,uint256)"], deployer);
    const weth = await router.WETH9();
    const [ethIn] = await quoter.quoteExactOutputSingle.staticCall({ tokenIn: weth, tokenOut: USDG, amount: short, fee: UNI.fee, sqrtPriceLimitX96: 0 });
    const value = (ethIn * 102n) / 100n; // 2% headroom; the surplus USDG just stays with the deployer
    await send(router.exactInputSingle({ tokenIn: weth, tokenOut: USDG, fee: UNI.fee, recipient: deployer.address, amountIn: value, amountOutMinimum: short, sqrtPriceLimitX96: 0 }, { value }));
    console.log(`swapped ${ethers.formatEther(value)} ETH for >= ${ethers.formatUnits(short, 6)} USDG`);
  }
}
const asset = await assetToken.getAddress();
const registry = await proxy("registry", "PolarisRegistry", [deployer.address, asset]);
for (const v of plan) {
  const vault = await proxy(v.key, "PolarisVault", [asset, `Polaris ${v.name} Vault`, v.symbol, deployer.address]);
  const addr = await vault.getAddress();
  await send(assetToken.approve(addr, usd(v.tvl) + reward(v)));
  await send(vault.deposit(usd(v.tvl), deployer.address));
  await send(vault.streamReward(reward(v), stream));
  await send(registry.listVault(addr, `Polaris ${v.name}`, v.curator));
}

const selectors = (name: string) =>
  ethers.getContractFactory(name).then((f) => {
    const s: Record<string, string> = {};
    f.interface.forEachFunction((fn) => (s[fn.name] = fn.selector));
    f.interface.forEachEvent((ev) => (s[`event:${ev.name}`] = ev.topicHash));
    return s;
  });

const network = await ethers.provider.getNetwork();
const result = {
  network: networkName,
  chainId: Number(network.chainId),
  startBlock,
  deployedAt: new Date().toISOString(),
  ...(testnet ? {} : { asset: { address: USDG, symbol: "USDG", decimals: 6 } }),
  contracts: out,
  selectors: Object.fromEntries(
    await Promise.all(
      [...new Set(Object.values(out).map((e) => e.name))].map(async (n) => [n, await selectors(n)] as const),
    ),
  ),
};
mkdirSync("deployments", { recursive: true });
writeFileSync(`deployments/${networkName}.json`, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote deployments/${networkName}.json, spent ${ethers.formatEther(startBalance - (await ethers.provider.getBalance(deployer.address)))} ETH`);
