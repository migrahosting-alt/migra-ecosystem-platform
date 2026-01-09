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

# Containerized nginx -t
# We mount repo config into /etc/nginx and force nginx to use it.
docker run --rm \
  -v "$PWD/${ROOT}:/etc/nginx:ro" \
  nginx:alpine \
  nginx -t -c "/etc/nginx/${NGINX_MAIN_CONF}"
