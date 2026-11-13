# Polaris Terminal · __DOMAIN__ (__NETWORK__)
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__;
    root /var/www/polaris-__ENV__;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' __RPCS__ __EXPLORER__; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;

    gzip on;
    gzip_types text/css application/javascript text/javascript application/json image/svg+xml;

    location /api/ {
        proxy_pass http://127.0.0.1:__PORT__;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        add_header Cache-Control "public, max-age=5" always;
    }
    location ~* \.(css|js)$ { add_header Cache-Control "public, max-age=300, must-revalidate"; try_files $uri =404; }
    location /assets/ { add_header Cache-Control "public, max-age=604800"; try_files $uri =404; }
    location / { try_files $uri $uri.html $uri/ =404; }
    error_page 404 /index.html;
}
