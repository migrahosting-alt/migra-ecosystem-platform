# Apply Pack — NGINX TLS Hygiene + OCSP Cleanup + mPanel Rate Limits (Reload-only)

## Scope
Target host: srv1-web  
Goal: remove TLS protocol redefinition warnings, silence OCSP stapling ignored warnings safely, add mPanel rate limiting.  
Constraints: reload-only, no cert rotations, no restarts.

---

## Preconditions (Read-only)
Run on srv1-web:
- nginx is installed and running
- configs are under /etc/nginx
- you have sudo

Commands:
```bash
sudo -s
nginx -v
nginx -t

Step 1 — Backup
TS="$(date -u +%Y%m%dT%H%M%SZ)"
BK="/root/nginx_bk_${TS}"
mkdir -p "$BK"
cp -a /etc/nginx "$BK"/
echo "Backup saved to: $BK"


Rollback uses this BK path.

Step 2 — Create standard snippets
2.1 TLS common policy
sudo tee /etc/nginx/snippets/tls-common.conf >/dev/null <<'EOF'
# Central TLS policy (single source of truth)
ssl_protocols TLSv1.2 TLSv1.3;

# Cipher selection handled by OpenSSL defaults unless legacy support required
ssl_prefer_server_ciphers off;

# Sessions
ssl_session_cache shared:SSL:50m;
ssl_session_timeout 1d;
ssl_session_tickets off;

# HSTS (optional; enable only when all subdomains are HTTPS)
# add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
EOF

2.2 OCSP ON
sudo tee /etc/nginx/snippets/ocsp-on.conf >/dev/null <<'EOF'
ssl_stapling on;
ssl_stapling_verify on;
resolver 1.1.1.1 8.8.8.8 valid=300s;
resolver_timeout 5s;
EOF

2.3 OCSP OFF
sudo tee /etc/nginx/snippets/ocsp-off.conf >/dev/null <<'EOF'
ssl_stapling off;
ssl_stapling_verify off;
EOF

2.4 mPanel limit zones (must be included in http{} context)
sudo tee /etc/nginx/snippets/mpanel-limits.conf >/dev/null <<'EOF'
limit_req_zone $binary_remote_addr zone=mpanel_auth:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=mpanel_api:10m rate=20r/s;
EOF

Step 3 — Ensure mpanel-limits.conf is included in http{}

Edit /etc/nginx/nginx.conf and add inside http{}:

include /etc/nginx/snippets/mpanel-limits.conf;


Validation:

nginx -t

Step 4 — Normalize TLS directives per vhost

For each SSL server block (listen 443 ssl;), especially migrapanel.com:

Add:
include /etc/nginx/snippets/tls-common.conf;
include /etc/nginx/snippets/ocsp-off.conf;  # use ocsp-on only if cert supports responder URL

Remove from the server block (because they now live in snippets):

ssl_protocols

ssl_ciphers

ssl_prefer_server_ciphers

ssl_session_cache

ssl_session_timeout

ssl_session_tickets

ssl_stapling

ssl_stapling_verify

Do NOT remove:

ssl_certificate

ssl_certificate_key

Step 5 — Add mPanel endpoint rate limits (migrapanel.com)

Inside migrapanel.com SSL server block:

Auth endpoints (strict)
location ~* ^/(api/auth|api/session) {
  limit_req zone=mpanel_auth burst=10 nodelay;
  proxy_pass http://mpanel_backend;
}

General API (moderate)
location ^~ /api/ {
  limit_req zone=mpanel_api burst=40 nodelay;
  proxy_pass http://mpanel_backend;
}


If your upstream is not named mpanel_backend, keep your existing proxy_pass target and only add limit_req lines.

Step 6 — Validate and reload (NO restart)
nginx -t
nginx -s reload

Step 7 — Confirm warnings and health

Check for warnings:

sudo tail -n 200 /var/log/nginx/error.log


Health checks (examples; adjust to your endpoints):

curl -fsS https://migrapanel.com/ || true
curl -fsS https://mpanel.migrahosting.com/ || true

Step 8 — Rollback (instant)

If anything is wrong:

sudo rm -rf /etc/nginx
sudo cp -a "$BK/nginx" /etc/nginx
nginx -t && nginx -s reload

Step 9 — Update SSOT + Runbooks

Update:

.migra/infra.snapshot.json

.migra/infra.snapshot.md

.migra/scan.report.md

.migra/runbooks/mpanel-security.md (rate limits & rationale)

.migra/runbooks/nginx-tls.md (snippet strategy & conventions)

.migra/runbooks/tenant-routing.md (domain → upstream → pod)


---

# Optional but recommended: add two runbooks (templates)
If you want, I can also paste:
- `.migra/runbooks/mpanel-security.md` (rate-limiting policy + tuning)
- `.migra/runbooks/nginx-tls.md` (TLS & OCSP policy)

---

## One more thing (so MigraAgent can actually “do” it)
MigraAgent will need a consistent SSH target name. In WSL, ensure you can run:

```bash
ssh srv1-web "hostname"


If your SSH config already has that alias, you’re done.
