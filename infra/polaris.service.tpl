[Unit]
Description=Polaris Terminal (%i)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
User=polaris
EnvironmentFile=/opt/polaris/%i/polaris.env
Environment=HOST=172.16.0.1
WorkingDirectory=/opt/polaris/%i/api
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/polaris/%i/data
MemoryMax=256M

[Install]
WantedBy=multi-user.target
