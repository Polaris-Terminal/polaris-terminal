// Verifies every implementation and PolarisProxy listed in deployments/<network>.json on Blockscout.
// Usage: npx hardhat run scripts/verify.ts --network robinhoodTestnet
import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { readFileSync } from "node:fs";

const { networkName } = await hre.network.create();
const dep = JSON.parse(readFileSync(`deployments/${networkName}.json`, "utf8"));
const done = new Set<string>();

async function verify(address: string, contract: string, constructorArgs: unknown[]) {
  if (done.has(address)) return;
  done.add(address);
  try {
    await verifyContract({ address, contract, constructorArgs, provider: "blockscout" }, hre);
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
