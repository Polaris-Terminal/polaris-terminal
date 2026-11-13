// Deploys every Polaris contract behind its own PolarisProxy and writes deployments/<network>.json.
// Usage: npx hardhat run scripts/deploy.ts --network robinhoodTestnet
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import { mkdirSync, writeFileSync } from "node:fs";

const connection = await hre.network.create();
const { ethers, networkName } = connection;
const up = await upgrades(hre, connection);
const [deployer] = await ethers.getSigners();
const testnet = networkName !== "robinhood";
const startBlock = await ethers.provider.getBlockNumber();
const usd = (n: number) => ethers.parseUnits(String(n), 6);
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
const token = await proxy("token", "PolarisToken", [deployer.address, ethers.parseEther("1000000000")]);
const beacon = await proxy("beacon", "PolarisBeacon", [deployer.address, await token.getAddress(), ethers.parseEther("10000")]);

if (testnet) {
  const dollar = await proxy("dollar", "PolarisDollar", [deployer.address, usd(10_000), DAY]);
  const asset = await dollar.getAddress();
  const registry = await proxy("registry", "PolarisRegistry", [deployer.address, asset]);

  // Three North Vaults with different depth and yield, so the North Score has something real to rank.
  const plan = [
    { key: "vaultVega", name: "Vega", symbol: "nvVEGA", curator: "Polaris Labs", tvl: 184_000, apy: 0.092 },
    { key: "vaultSirius", name: "Sirius", symbol: "nvSIRIUS", curator: "Polaris Labs", tvl: 26_500, apy: 0.148 },
    { key: "vaultAltair", name: "Altair", symbol: "nvALTAIR", curator: "Polaris Labs", tvl: 512_000, apy: 0.061 },
  ];
  const stream = 30 * DAY;
  const need = plan.reduce((s, v) => s + v.tvl + Math.ceil((v.tvl * v.apy * 30) / 365), 0);
  await send(dollar.mint(deployer.address, usd(need)));
  for (const v of plan) {
    const vault = await proxy(v.key, "PolarisVault", [asset, `Polaris ${v.name} Vault`, v.symbol, deployer.address]);
    const addr = await vault.getAddress();
    const reward = usd(Math.ceil((v.tvl * v.apy * 30) / 365));
    await send(dollar.approve(addr, usd(v.tvl) + reward));
    await send(vault.deposit(usd(v.tvl), deployer.address));
    await send(vault.streamReward(reward, stream));
    await send(registry.listVault(addr, `Polaris ${v.name}`, v.curator));
  }
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
  contracts: out,
  selectors: Object.fromEntries(
    await Promise.all(
      [...new Set(Object.values(out).map((e) => e.name))].map(async (n) => [n, await selectors(n)] as const),
    ),
  ),
};
mkdirSync("deployments", { recursive: true });
writeFileSync(`deployments/${networkName}.json`, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote deployments/${networkName}.json`);
