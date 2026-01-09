#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Migra NGINX config validation (containerized)
# ============================================
# This script runs `nginx -t` using the repo configs.
#
# You must set where your NGINX config lives in the repo.
# Default attempts:
#   - ./infra/nginx/nginx.conf
#   - ./nginx/nginx.conf
#
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
  echo "❌ Could not find repo NGINX config."
  echo "Expected one of:"
  echo " - infra/nginx/${NGINX_MAIN_CONF}"
  echo " - nginx/${NGINX_MAIN_CONF}"
  echo ""
  echo "Fix: set NGINX_ROOT to your config folder (e.g. infra/nginx)."
  exit 1
fi

if [[ ! -f "${ROOT}/${NGINX_MAIN_CONF}" ]]; then
  echo "❌ Missing main config: ${ROOT}/${NGINX_MAIN_CONF}"
  exit 1
fi

echo "✅ Using repo NGINX root: ${ROOT}"
echo "✅ Using main config: ${NGINX_MAIN_CONF}"

escape_gha() {
  local s="$1"
  s=${s//'%'/'%25'}
  s=${s//$'\r'/'%0D'}
  s=${s//$'\n'/'%0A'}
  printf '%s' "$s"
}

# Containerized nginx -t
# We copy repo config into a tmpfs /etc/nginx (writable) to allow
# container-specific normalization (e.g. Alpine doesn't have user www-data).
#
# Production configs often reference certs/keys/includes outside /etc/nginx
# (e.g., /etc/letsencrypt, /etc/ssl). CI runners won't have those, so we
# stub them inside the container (ephemeral) to validate syntax safely.
set +e
docker_output="$({ docker run --rm \
  --tmpfs /etc/nginx:rw,mode=755 \
  --tmpfs /etc/letsencrypt:rw,mode=755 \
  --tmpfs /etc/ssl/private:rw,mode=755 \
  --tmpfs /etc/ssl/certs:rw,mode=755 \
  -e NGINX_MAIN_CONF="$NGINX_MAIN_CONF" \
  -v "$PWD/${ROOT}:/mnt/src:ro" \
  nginx:alpine \
  sh -lc "set -eu

    apk add --no-cache bash openssl >/dev/null

    cat > /tmp/migra_nginx_validate.sh <<'BASH'
#!/usr/bin/env bash
set -euo pipefail

# Populate /etc/nginx from repo
cp -a /mnt/src/. /etc/nginx/

# Alpine nginx image typically uses user 'nginx' (not 'www-data').
# Normalize for CI validation only.
if [[ -f \"/etc/nginx/${NGINX_MAIN_CONF}\" ]]; then
  sed -i -E 's/^\\s*user\\s+[^;]+;/user nginx;/' \"/etc/nginx/${NGINX_MAIN_CONF}\" || true
fi

# Dummy certificate/key for CI validation only (never committed)
openssl req -x509 -nodes -newkey rsa:2048 \\
  -keyout /tmp/migra_dummy.key \\
  -out /tmp/migra_dummy.crt \\
  -subj '/CN=example.invalid' \\
  -days 1 >/dev/null 2>&1

# Dummy DH params (Certbot commonly references /etc/letsencrypt/ssl-dhparams.pem)
# Use -dsaparam for speed.
openssl dhparam -dsaparam -out /tmp/migra_dummy_dhparams.pem 2048 >/dev/null 2>&1 || \\
  openssl dhparam -out /tmp/migra_dummy_dhparams.pem 2048 >/dev/null 2>&1

# Provide a minimal certbot-style options file if referenced.
mkdir -p /etc/letsencrypt
cat > /etc/letsencrypt/options-ssl-nginx.conf <<'EOF'
ssl_session_cache shared:le_nginx_SSL:10m;
ssl_session_timeout 1d;
ssl_session_tickets off;
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
EOF

# Helper: copy a stub file to a target path
copy_stub() {
  src=\"$1\"; dst=\"$2\"
  mkdir -p \"$(dirname \"$dst\")\"
  cp \"$src\" \"$dst\"
}

# Create referenced cert/key/chain/dhparam files so nginx -t can succeed
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

# Stub any absolute include targets outside /etc/nginx (ignore globs)
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

escape_gha() {
  local s="$1"
  s=${s//'%'/'%25'}
  s=${s//$'\r'/'%0D'}
  s=${s//$'\n'/'%0A'}
  printf '%s' "$s"
}

out="$(nginx -t -c \"/etc/nginx/${NGINX_MAIN_CONF}\" -g 'pid /tmp/nginx.pid; error_log stderr notice;' 2>&1)" || {
  echo "$out"
  echo "::error::$(escape_gha \"nginx -t failed:\n$out\")"
  exit 1
}

echo "$out"
BASH

  bash /tmp/migra_nginx_validate.sh"; } 2>&1)"
docker_rc=$?
set -e

echo "$docker_output"

if [[ $docker_rc -ne 0 ]]; then
  echo "::error::$(escape_gha "Validate NGINX config (nginx -t) failed. Output:\n$docker_output")"
  exit "$docker_rc"
fi
