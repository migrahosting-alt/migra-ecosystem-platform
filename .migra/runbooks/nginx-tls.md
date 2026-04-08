# NGINX TLS & OCSP Policy (MigraHosting)

## Goals
- Single TLS policy source of truth via snippets
- No duplicated TLS directives inside vhost server blocks
- Explicit OCSP policy per SSL vhost (on/off)

## Standard Snippets (srv1-web)
- /etc/nginx/snippets/tls-common.conf
- /etc/nginx/snippets/ocsp-on.conf
- /etc/nginx/snippets/ocsp-off.conf

## Rules
- SSL server blocks (listen 443 ssl;) must include:
  - tls-common.conf
  - one of: ocsp-on.conf or ocsp-off.conf
- Do not define ssl_protocols / ssl_* session directives directly in vhosts.

## Validation
- nginx -t
- nginx -T (for expanded config review)

## 2026-04-08 MigraVoice Rollout Note
- Normalize HTTPS listeners in tracked repo mirrors to use matching `listen 443 ssl http2;` and `listen [::]:443 ssl http2;` pairs.
- When repo-tracking live `sites-enabled` vhosts, keep `sites-enabled` and `sites-available` copies aligned after listener or proxy-route changes.
- For `call.migrahosting.com`, preserve the `tenant-suspension` include and no-cache rules for `sw.js`, `site.webmanifest`, `build.json`, and `apple-touch-icon.png` so service-worker updates propagate safely.
