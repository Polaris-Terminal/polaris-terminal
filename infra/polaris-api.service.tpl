[Unit]
Description=Polaris signal API (__ENV__)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=polaris
WorkingDirectory=/opt/polaris-__ENV__/api
Environment=NETWORK=__NETWORK__
Environment=PORT=__PORT__
Environment=DATA_DIR=/opt/polaris-__ENV__/data
Environment=DEPLOYMENTS=/opt/polaris-__ENV__/deployments.json
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/opt/polaris-__ENV__/data
ProtectHome=true
PrivateTmp=true
MemoryMax=256M

[Install]
WantedBy=multi-user.target
