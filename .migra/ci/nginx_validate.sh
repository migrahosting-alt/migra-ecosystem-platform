#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Migra NGINX config validation (containerized)
# ============================================
# This script runs `nginx -t` using the repo configs.
#
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
  local s="${1-}"
  s=${s//'%'/'%25'}
  s=${s//$'\r'/'%0D'}
  s=${s//$'\n'/'%0A'}
  printf '%s' "$s"
}

set +e
docker_output="$({ docker run --rm \
  --tmpfs /etc/nginx:rw,mode=755 \
  --tmpfs /etc/letsencrypt:rw,mode=755 \
  --tmpfs /etc/ssl/private:rw,mode=755 \
  --tmpfs /etc/ssl/certs:rw,mode=755 \
  -e NGINX_MAIN_CONF="$NGINX_MAIN_CONF" \
  -v "$PWD/${ROOT}:/mnt/src:ro" \
  -v "$PWD/.migra/ci/nginx_validate_container.sh:/tmp/migra_nginx_validate_container.sh:ro" \
  nginx:alpine \
  sh -lc 'set -eu;
    ALPINE_VER="$(cut -d. -f1,2 /etc/alpine-release)";
    REPO_MAIN="http://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VER}/main";
    REPO_COMM="http://dl-cdn.alpinelinux.org/alpine/v${ALPINE_VER}/community";
    apk add --no-cache --repository "$REPO_MAIN" --repository "$REPO_COMM" ca-certificates bash openssl >/dev/null;
    update-ca-certificates >/dev/null 2>&1 || true;
    bash /tmp/migra_nginx_validate_container.sh'; } 2>&1)"
docker_rc=$?
set -e

echo "$docker_output"

if [[ $docker_rc -ne 0 ]]; then
  echo "::error::$(escape_gha "Validate NGINX config (nginx -t) failed. Output:\n$docker_output")"
  exit "$docker_rc"
fi
