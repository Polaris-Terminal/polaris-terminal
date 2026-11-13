import { configVariable, defineConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import hardhatUpgrades from "@openzeppelin/hardhat-upgrades";

// The deployer key lives in the encrypted Hardhat keystore:  npx hardhat keystore set DEPLOYER_PRIVATE_KEY
const deployer = [configVariable("DEPLOYER_PRIVATE_KEY")];

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers, hardhatUpgrades],
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    robinhoodTestnet: {
      type: "http",
      chainType: "generic",
      chainId: 46630,
      url: "https://rpc.testnet.chain.robinhood.com",
      accounts: deployer,
    },
    robinhood: {
      type: "http",
      chainType: "generic",
      chainId: 4663,
      url: "https://rpc.mainnet.chain.robinhood.com",
      accounts: deployer,
    },
  },
  chainDescriptors: {
    46630: {
      name: "Robinhood Chain Testnet",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Testnet Explorer",
          url: "https://explorer.testnet.chain.robinhood.com",
          apiUrl: "https://explorer.testnet.chain.robinhood.com/api",
        },
      },
    },
    4663: {
      name: "Robinhood Chain",
      blockExplorers: {
        blockscout: {
          name: "Robinhood Explorer",
          url: "https://robinhoodchain.blockscout.com",
          apiUrl: "https://robinhoodchain.blockscout.com/api",
        },
      },
    },
  },
  verify: { etherscan: { enabled: false } },
});
