# Polaris Terminal

**Everything moves. Look up.** The signal terminal for Robinhood Chain.

On Robinhood Chain a new token is born every minute. Everyone moves and almost nobody knows where. That's the Drift. Polaris reads it:

- **Drift Radar** watches every ERC-20 mint, dates each token from its creation transaction and scores it live
- **North Score** is an open 1–99 score from holder spread, mint activity, freshness and source verification
- **North Vaults** are ERC-4626 vaults with linearly streamed yield, ranked by APY × depth × exit liquidity
- **Beacon** is a daily on-chain check-in with streaks, XP and a leaderboard rebuilt from chain logs

## Monorepo

```
apps/web            static site: HTML, CSS, vanilla JS modules, GSAP, Lenis, three.js
apps/api            zero-dependency Node signal API (drift scanner, pulse, beacon board)
packages/contracts  Solidity, Hardhat 3, OpenZeppelin UUPS upgradeable contracts
infra               systemd + Traefik templates and the deploy script
```

## Contracts

Every contract is a UUPS implementation behind its own `PolarisProxy` (ERC-1967), so addresses never change across upgrades.

| Contract | Role |
| --- | --- |
| `PolarisToken` | $POLARIS, fixed supply ERC-20 with permit |
| `PolarisBeacon` | daily check-in, streaks and XP |
| `PolarisRegistry` | allowlist of vaults the terminal routes into, checked against the vault asset |
| `PolarisVault` | ERC-4626 North Vault with streamed yield, pausable deposits, always-open exits |
| `PolarisDollar` | pUSD, testnet stable with a daily drip |

Deployed addresses live in `packages/contracts/deployments/<network>.json`.

## Develop

```bash
pnpm install
pnpm test                                   # contracts + api
pnpm --filter @polaris/contracts exec hardhat node
NETWORK=localhost pnpm --filter @polaris/web build
pnpm dev:api                                # serves api + apps/web/dist on :8787
```

## Deploy

```bash
cd packages/contracts
set -a; . ../../.env.deployer; set +a      # DEPLOYER_PRIVATE_KEY, never committed
npx hardhat run scripts/deploy.ts --network robinhoodTestnet
npx hardhat run scripts/verify.ts --network robinhoodTestnet
cd ../.. && infra/deploy.sh testnet         # refuses to ship unless every contract is verified
```

## Branches

`main` development · `testnet` testnet.polaristerminal.tech · `mainnet` polaristerminal.tech
