#!/usr/bin/env bash
# One-time VPS setup (Ubuntu/Debian): node 22, nginx, certbot, firewall, key-only SSH.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg nginx certbot python3-certbot-nginx rsync ufw
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw --force enable
rm -f /etc/nginx/sites-enabled/default
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
systemctl reload ssh || systemctl reload sshd
node -v; nginx -v
