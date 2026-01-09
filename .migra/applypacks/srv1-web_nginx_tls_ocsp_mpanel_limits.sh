#!/usr/bin/env bash
set -euo pipefail

# Apply Pack: NGINX TLS hygiene + OCSP cleanup + mPanel rate limits (reload-only)
# Target: srv1-web
# Constraints: no restarts, no cert rotations

log() { printf "\n[%s] %s\n" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

if [[ "$(id -u)" -ne 0 ]]; then
  log "Re-running as root via sudo..."
  exec sudo -E bash "$0" "$@"
fi

log "Precheck: nginx version + config test"
nginx -v
nginx -t

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BK="/root/nginx_bk_${TS}"
log "Backup /etc/nginx -> $BK"
mkdir -p "$BK"
cp -a /etc/nginx "$BK"/

log "Create snippets directory"
mkdir -p /etc/nginx/snippets

log "Write /etc/nginx/snippets/tls-common.conf"
cat > /etc/nginx/snippets/tls-common.conf <<'EOF'
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

log "Write /etc/nginx/snippets/ocsp-on.conf"
cat > /etc/nginx/snippets/ocsp-on.conf <<'EOF'
ssl_stapling on;
ssl_stapling_verify on;
resolver 1.1.1.1 8.8.8.8 valid=300s;
resolver_timeout 5s;
EOF

log "Write /etc/nginx/snippets/ocsp-off.conf"
cat > /etc/nginx/snippets/ocsp-off.conf <<'EOF'
ssl_stapling off;
ssl_stapling_verify off;
EOF

log "Write /etc/nginx/snippets/mpanel-limits.conf"
cat > /etc/nginx/snippets/mpanel-limits.conf <<'EOF'
limit_req_zone $binary_remote_addr zone=mpanel_auth:10m rate=5r/s;
limit_req_zone $binary_remote_addr zone=mpanel_api:10m rate=20r/s;
EOF

# Ensure mpanel-limits is included inside http{} in nginx.conf (best-effort, safe)
NGINX_CONF="/etc/nginx/nginx.conf"
log "Ensure mpanel-limits.conf included in http{} in $NGINX_CONF"
if ! grep -q "snippets/mpanel-limits.conf" "$NGINX_CONF"; then
  # Insert after 'http {' line
  awk '
    BEGIN{done=0}
    {print}
    $0 ~ /^[[:space:]]*http[[:space:]]*\{/ && done==0 {
      print "    include /etc/nginx/snippets/mpanel-limits.conf;";
      done=1
    }
  ' "$NGINX_CONF" > "${NGINX_CONF}.tmp"
  mv "${NGINX_CONF}.tmp" "$NGINX_CONF"
else
  log "mpanel-limits.conf already included"
fi

log "NOTE: Per-vhost normalization is environment-specific."
log "This script does NOT blindly edit vhosts to avoid breaking routing."
log "Next step: MigraAgent should patch only the affected vhost(s) found in scan results."

log "Validate config after snippet + include changes"
nginx -t

log "Reload nginx (no restart)"
nginx -s reload

log "Postcheck: show last 50 nginx error log lines (for warnings)"
tail -n 50 /var/log/nginx/error.log || true

log "DONE. Backup located at: $BK"
