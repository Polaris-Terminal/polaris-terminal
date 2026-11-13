# Copied to /data/coolify/proxy/dynamic/polaris-__ENV__.yaml. The shared Coolify Traefik owns 80/443,
# issues Let's Encrypt certificates and reaches the host-side polaris@__ENV__ service via host.docker.internal.
http:
  routers:
    polaris-__ENV__-http:
      rule: __HOSTS__
      entryPoints: [http]
      middlewares: [polaris-__ENV__-https]
      service: polaris-__ENV__
    polaris-__ENV__:
      rule: __HOSTS__
      entryPoints: [https]
      service: polaris-__ENV__
      middlewares: [polaris-__ENV__-headers, polaris-__ENV__-compress]
      tls:
        certResolver: letsencrypt
  middlewares:
    polaris-__ENV__-https:
      redirectScheme:
        scheme: https
        permanent: true
    polaris-__ENV__-compress:
      compress: {}
    polaris-__ENV__-headers:
      headers:
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        contentTypeNosniff: true
        frameDeny: true
        referrerPolicy: strict-origin-when-cross-origin
        permissionsPolicy: "camera=(), microphone=(), geolocation=()"
        contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://unpkg.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' __RPCS__ __EXPLORER__; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'"
  services:
    polaris-__ENV__:
      loadBalancer:
        servers:
          - url: http://host.docker.internal:__PORT__
