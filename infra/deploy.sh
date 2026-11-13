#!/usr/bin/env bash
# Builds locally and ships to the shared VPS: static site + zero-dependency API run as polaris@<env>,
# routed by the existing Coolify Traefik (which also issues the TLS certificate).
# Usage: infra/deploy.sh testnet|mainnet
set -euo pipefail
ENV="${1:?usage: deploy.sh testnet|mainnet}"
HOST="${POLARIS_HOST:-polaris}"
case "$ENV" in
  testnet) NETWORK=robinhoodTestnet; HOSTS='Host(`testnet.polaristerminal.tech`)'; DOMAIN=testnet.polaristerminal.tech; PORT=3701
           RPCS="https://rpc.testnet.chain.robinhood.com"; EXPLORER=https://explorer.testnet.chain.robinhood.com ;;
  mainnet) NETWORK=robinhood; HOSTS='Host(`polaristerminal.tech`) || Host(`www.polaristerminal.tech`)'; DOMAIN=polaristerminal.tech; PORT=3801
           RPCS="https://rpc.mainnet.chain.robinhood.com https://robinhood.drpc.org https://robinhood-rpc.publicnode.com"; EXPLORER=https://robinhoodchain.blockscout.com ;;
  *) echo "unknown env $ENV"; exit 1 ;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEP="$ROOT/packages/contracts/deployments/$NETWORK.json"
DIR="/opt/polaris/$ENV"
[ -f "$DEP" ] || { echo "missing $DEP"; exit 1; }

echo "› checking every contract is verified on $EXPLORER"
node -e '
const dep = require(process.argv[1]); const ex = process.argv[2];
(async () => {
  const bad = [];
  for (const [k, c] of Object.entries(dep.contracts))
    for (const a of [c.proxy, c.implementation]) {
      const r = await fetch(`${ex}/api/v2/addresses/${a}`).then((r) => r.json());
      const s = await fetch(`${ex}/api/v2/smart-contracts/${a}`).then((r) => r.json()).catch(() => ({}));
      if (!r.is_verified || s.is_partially_verified === true) bad.push(`${k} ${a}`);
    }
  if (bad.length) { console.error("not verified:\n  " + bad.join("\n  ")); process.exit(1); }
  console.log("  all verified");
})();' "$DEP" "$EXPLORER"

echo "› building web for $NETWORK"
(cd "$ROOT/apps/web" && NETWORK=$NETWORK node build.mjs)

echo "› shipping to $HOST:$DIR"
ssh "$HOST" "id polaris >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin polaris; mkdir -p $DIR/web $DIR/api $DIR/data && chown polaris $DIR/data"
rsync -az --delete "$ROOT/apps/web/dist/" "$HOST:$DIR/web/"
rsync -az --delete --exclude '*.test.mjs' --exclude package.json --exclude data "$ROOT/apps/api/" "$HOST:$DIR/api/"
rsync -az "$DEP" "$HOST:$DIR/deployments.json"
printf 'NETWORK=%s\nPORT=%s\nSTATIC_DIR=%s/web\nDATA_DIR=%s/data\nDEPLOYMENTS=%s/deployments.json\n' "$NETWORK" "$PORT" "$DIR" "$DIR" "$DIR" | ssh "$HOST" "cat > $DIR/polaris.env"

fill() { sed -e "s#__ENV__#$ENV#g; s#__HOSTS__#$HOSTS#g; s#__PORT__#$PORT#g; s#__RPCS__#$RPCS#g; s#__EXPLORER__#$EXPLORER#g" "$1"; }
ssh "$HOST" "cat > /etc/systemd/system/polaris@.service" < "$ROOT/infra/polaris.service.tpl"
fill "$ROOT/infra/traefik.yaml.tpl" | ssh "$HOST" "cat > /data/coolify/proxy/dynamic/polaris-$ENV.yaml"
ssh "$HOST" "systemctl daemon-reload && systemctl enable --now polaris@$ENV && systemctl restart polaris@$ENV && sleep 2 && systemctl is-active polaris@$ENV"
echo "› live: https://$DOMAIN"
