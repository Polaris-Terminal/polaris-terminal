#!/usr/bin/env bash
# Builds locally and ships to the VPS. The VPS only stores static files and the zero-dependency API.
# Usage: infra/deploy.sh testnet|mainnet
set -euo pipefail
ENV="${1:?usage: deploy.sh testnet|mainnet}"
HOST="${POLARIS_HOST:-polaris}"
case "$ENV" in
  testnet) NETWORK=robinhoodTestnet; DOMAIN=testnet.polaristerminal.tech; PORT=8787
           RPCS="https://rpc.testnet.chain.robinhood.com"; EXPLORER=https://explorer.testnet.chain.robinhood.com ;;
  mainnet) NETWORK=robinhood; DOMAIN=polaristerminal.tech; PORT=8788
           RPCS="https://rpc.mainnet.chain.robinhood.com https://robinhood.drpc.org https://robinhood-rpc.publicnode.com"; EXPLORER=https://robinhoodchain.blockscout.com ;;
  *) echo "unknown env $ENV"; exit 1 ;;
esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEP="$ROOT/packages/contracts/deployments/$NETWORK.json"
[ -f "$DEP" ] || { echo "missing $DEP"; exit 1; }

echo "› checking every contract is verified on $EXPLORER"
node -e '
const dep = require(process.argv[1]); const ex = process.argv[2];
(async () => {
  const bad = [];
  for (const [k, c] of Object.entries(dep.contracts))
    for (const a of [c.proxy, c.implementation]) {
      const r = await fetch(`${ex}/api/v2/addresses/${a}`).then((r) => r.json());
      if (!r.is_verified) bad.push(`${k} ${a}`);
    }
  if (bad.length) { console.error("not verified:\n  " + bad.join("\n  ")); process.exit(1); }
  console.log("  all verified");
})();' "$DEP" "$EXPLORER"

echo "› building web for $NETWORK"
(cd "$ROOT/apps/web" && NETWORK=$NETWORK node build.mjs)

echo "› shipping to $HOST"
ssh "$HOST" "mkdir -p /var/www/polaris-$ENV /opt/polaris-$ENV/api /opt/polaris-$ENV/data && id polaris >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin polaris; chown -R polaris /opt/polaris-$ENV/data"
rsync -az --delete "$ROOT/apps/web/dist/" "$HOST:/var/www/polaris-$ENV/"
rsync -az --delete --exclude data --exclude '*.test.mjs' --exclude package.json "$ROOT/apps/api/" "$HOST:/opt/polaris-$ENV/api/"
rsync -az "$DEP" "$HOST:/opt/polaris-$ENV/deployments.json"

fill() { sed -e "s#__ENV__#$ENV#g; s#__NETWORK__#$NETWORK#g; s#__DOMAIN__#$DOMAIN#g; s#__PORT__#$PORT#g; s#__RPCS__#$RPCS#g; s#__EXPLORER__#$EXPLORER#g" "$1"; }
fill "$ROOT/infra/nginx.conf.tpl" | ssh "$HOST" "cat > /etc/nginx/sites-available/polaris-$ENV && ln -sf /etc/nginx/sites-available/polaris-$ENV /etc/nginx/sites-enabled/polaris-$ENV"
fill "$ROOT/infra/polaris-api.service.tpl" | ssh "$HOST" "cat > /etc/systemd/system/polaris-api-$ENV.service"
ssh "$HOST" "systemctl daemon-reload && systemctl enable --now polaris-api-$ENV && systemctl restart polaris-api-$ENV && nginx -t && systemctl reload nginx"
ssh "$HOST" "test -d /etc/letsencrypt/live/$DOMAIN || certbot --nginx -d $DOMAIN --non-interactive --agree-tos -m rubencahyadi504@gmail.com --redirect"
echo "› live: https://$DOMAIN"
