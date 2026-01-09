#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Migra NGINX Policy Lint (containerized)
# ============================================
# Enforces enterprise policies:
#  1) No TLS directives defined directly inside server{} blocks.
#     TLS policy must come from snippets/tls-common.conf.
#  2) limit_req_zone must be defined in http{} context only.
#  3) SSL server blocks must explicitly include either ocsp-on or ocsp-off snippet.
#  4) nginx -T must succeed.
#
# Repo structure defaults:
#   - infra/nginx/nginx.conf
#   - nginx/nginx.conf
# Override with:
#   NGINX_ROOT=infra/nginx
#   NGINX_MAIN_CONF=nginx.conf
# ============================================

NGINX_ROOT="${NGINX_ROOT:-}"
NGINX_MAIN_CONF="${NGINX_MAIN_CONF:-nginx.conf}"

pick_root() {
  if [[ -n "${NGINX_ROOT}" ]]; then
    echo "$NGINX_ROOT"
    return
  fi
  if [[ -f "infra/nginx/${NGINX_MAIN_CONF}" ]]; then
    echo "infra/nginx"
    return
  fi
  if [[ -f "nginx/${NGINX_MAIN_CONF}" ]]; then
    echo "nginx"
    return
  fi
  echo ""
}

ROOT="$(pick_root)"
if [[ -z "$ROOT" ]]; then
  echo "❌ Could not find repo NGINX config root."
  echo "Set NGINX_ROOT to your config folder."
  exit 1
fi

MAIN="${ROOT}/${NGINX_MAIN_CONF}"
if [[ ! -f "$MAIN" ]]; then
  echo "❌ Missing main config: $MAIN"
  exit 1
fi

echo "✅ Using repo NGINX root: $ROOT"
echo "✅ Using main config: $NGINX_MAIN_CONF"

# Run nginx -T and capture full expanded config output
TMP="$(mktemp -d)"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT

docker run --rm \
   --tmpfs /etc/nginx:rw,mode=755 \
   --tmpfs /etc/letsencrypt:rw,mode=755 \
   --tmpfs /etc/ssl/private:rw,mode=755 \
   --tmpfs /etc/ssl/certs:rw,mode=755 \
   -e NGINX_MAIN_CONF="$NGINX_MAIN_CONF" \
   -v "$PWD/${ROOT}:/mnt/src:ro" \
   nginx:alpine \
   sh -lc "set -eu

     apk add --no-cache bash openssl >/dev/null

     cat > /tmp/migra_nginx_policy.sh <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

cp -a /mnt/src/. /etc/nginx/

if [[ -f \"/etc/nginx/${NGINX_MAIN_CONF}\" ]]; then
  sed -i -E 's/^\\s*user\\s+[^;]+;/user nginx;/' \"/etc/nginx/${NGINX_MAIN_CONF}\" || true
fi

openssl req -x509 -nodes -newkey rsa:2048 \\
  -keyout /tmp/migra_dummy.key \\
  -out /tmp/migra_dummy.crt \\
  -subj '/CN=example.invalid' \\
  -days 1 >/dev/null 2>&1

openssl dhparam -dsaparam -out /tmp/migra_dummy_dhparams.pem 2048 >/dev/null 2>&1 || \\
  openssl dhparam -out /tmp/migra_dummy_dhparams.pem 2048 >/dev/null 2>&1

mkdir -p /etc/letsencrypt
cat > /etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
EOF

copy_stub() {
  src=\"$1\"; dst=\"$2\"
  mkdir -p \"$(dirname \"$dst\")\"
  cp \"$src\" \"$dst\"
}

while read -r path; do
  [[ -z \"$path\" ]] && continue
  copy_stub /tmp/migra_dummy.crt \"$path\"
done < <(grep -RhoE 'ssl_certificate\\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\\r].*$//' | sort -u)

while read -r path; do
  [[ -z \"$path\" ]] && continue
  copy_stub /tmp/migra_dummy.key \"$path\"
done < <(grep -RhoE 'ssl_certificate_key\\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\\r].*$//' | sort -u)

while read -r path; do
  [[ -z \"$path\" ]] && continue
  copy_stub /tmp/migra_dummy.crt \"$path\"
done < <(grep -RhoE 'ssl_trusted_certificate\\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\\r].*$//' | sort -u)

while read -r path; do
  [[ -z \"$path\" ]] && continue
  copy_stub /tmp/migra_dummy_dhparams.pem \"$path\"
done < <(grep -RhoE 'ssl_dhparam\\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\\r].*$//' | sort -u)

while read -r inc; do
  [[ -z \"$inc\" ]] && continue
  case \"$inc\" in
    /*) ;;
    *) continue ;;
  esac
  case \"$inc\" in
    /etc/nginx/*) continue ;;
  esac
  case \"$inc\" in
    *\\**|*\\?*|*\\[*) continue ;;
  esac
  mkdir -p \"$(dirname \"$inc\")\"
  : > \"$inc\"
done < <(grep -RhoE '^\\s*include\\s+[^;]+' /etc/nginx | awk '{print $2}' | sed 's/[;\\r].*$//' | sort -u)

nginx -T -c /etc/nginx/${NGINX_MAIN_CONF} -g 'pid /tmp/nginx.pid; error_log stderr notice;' 2>&1
BASH

     bash /tmp/migra_nginx_policy.sh" \
   | tee "$TMP/nginx_T.txt"

T="$TMP/nginx_T.txt"

# -----------------------------
# Policy 4: nginx -T succeeded?
# -----------------------------
if grep -q "emerg" "$T"; then
  echo "❌ nginx -T contains emerg errors"
  exit 1
fi
if ! grep -q "configuration file" "$T"; then
  echo "❌ nginx -T output did not look valid"
  exit 1
fi
echo "✅ Policy: nginx -T succeeded"

# ----------------------------------------------------------
# Extract server blocks that listen on 443 (best-effort parse)
# ----------------------------------------------------------
# We lint heuristically using the expanded config output.
# This is not a perfect parser, but is reliable for enforcing standards.

# Helper: get numbered lines for debugging
nl -ba "$T" > "$TMP/T.nl"

# Policy 2: limit_req_zone must NOT appear inside server{} blocks
# (In expanded output, it can appear anywhere; we enforce that it appears only before first 'server {' occurrence
# or within http{} scope. Heuristic: forbid it after any 'server {' token.)
if awk '
  BEGIN{in_server=0; bad=0}
  /server[[:space:]]*\{/ {in_server=1}
  in_server==1 && /limit_req_zone/ {bad=1}
  END{exit(bad)}
' "$T"; then
  echo "✅ Policy: limit_req_zone not found inside server{}"
else
  echo "❌ Policy violation: limit_req_zone found inside a server{} block."
  echo "Fix: move limit_req_zone directives to http{} context (e.g., nginx.conf) and include snippets/mpanel-limits.conf there."
  exit 1
fi

# Policy 1: For SSL server blocks, forbid direct TLS directives (must come from tls-common snippet)
TLS_KEYS_REGEX='ssl_protocols|ssl_ciphers|ssl_prefer_server_ciphers|ssl_session_cache|ssl_session_timeout|ssl_session_tickets'
if awk -v re="$TLS_KEYS_REGEX" '
  BEGIN{in_ssl_server=0; bad=0}
  /server[[:space:]]*\{/ {in_ssl_server=0}
  /listen[[:space:]]+443([^;]*)(ssl)?/ {in_ssl_server=1}
  in_ssl_server==1 && $0 ~ re {bad=1}
  END{exit(bad)}
' "$T"; then
  echo "✅ Policy: no direct TLS directives inside listen 443 server blocks"
else
  echo "❌ Policy violation: TLS directives found inside a listen 443 server{} block."
  echo "Fix: remove tls directives from vhosts and include /etc/nginx/snippets/tls-common.conf in each SSL server."
  exit 1
fi

# Policy 3: Each SSL server should include either ocsp-on or ocsp-off (explicit)
# Heuristic: within a 443 server, require "include ...ocsp-on.conf" OR "include ...ocsp-off.conf"
if awk '
  BEGIN{in_ssl=0; has_ocsp=0; bad=0}
  /server[[:space:]]*\{/ {
    if (in_ssl==1 && has_ocsp==0) bad=1
    in_ssl=0; has_ocsp=0
  }
  /listen[[:space:]]+443([^;]*)(ssl)?/ { in_ssl=1 }
  in_ssl==1 && /include[[:space:]]+.*ocsp-(on|off)\.conf/ { has_ocsp=1 }
  END{
    if (in_ssl==1 && has_ocsp==0) bad=1
    exit(bad)
  }
' "$T"; then
  echo "✅ Policy: every SSL server includes ocsp-on/off snippet"
else
  echo "❌ Policy violation: one or more SSL server blocks lack explicit OCSP policy."
  echo "Fix: add one of:"
  echo " - include /etc/nginx/snippets/ocsp-on.conf;"
  echo " - include /etc/nginx/snippets/ocsp-off.conf;"
  exit 1
fi

echo "✅ All Migra NGINX policy checks passed."
