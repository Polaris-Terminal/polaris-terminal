// Verifies every implementation and PolarisProxy listed in deployments/<network>.json on Blockscout.
// Usage: npx hardhat run scripts/verify.ts --network robinhoodTestnet
import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { readFileSync } from "node:fs";

const { networkName } = await hre.network.create();
const dep = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));
const done = new Set<string>();

const explorerApi = hre.config.chainDescriptors.get(BigInt(dep.chainId))?.blockExplorers.blockscout?.url + "/api/v2";

// Blockscout serves the implementation's source at a proxy address, which fools the plugin's own
// "already verified" check, so read the real status from the v2 API and force when it is not complete.
async function fullyVerified(address: string) {
  const s = await fetch(`${explorerApi}/smart-contracts/${address}`).then((r) => (r.ok ? r.json() : null));
  return !!s?.name && s.is_partially_verified !== true && s.is_fully_verified !== false;
}

async function verify(address: string, contract: string, constructorArgs: unknown[]) {
  if (done.has(address)) return;
  done.add(address);
  if (await fullyVerified(address)) return console.log(`already verified ${contract} ${address}`);
  try {
    await verifyContract({ address, contract, constructorArgs, provider: "blockscout", force: true }, hre);
    console.log(`verified ${contract} ${address}`);
  } catch (e) {
    const msg = (e as Error).message;
    if (/already verified/i.test(msg)) console.log(`already verified ${contract} ${address}`);
    else throw e;
  }
}

for (const [key, c] of Object.entries<{ name: string; proxy: string; implementation: string; initData: string }>(dep.contracts)) {
  console.log(`— ${key}`);
  await verify(c.implementation, `contracts/${c.name}.sol:${c.name}`, []);
  await verify(c.proxy, "contracts/PolarisProxy.sol:PolarisProxy", [c.implementation, c.initData]);
}
