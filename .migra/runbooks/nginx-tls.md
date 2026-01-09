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
