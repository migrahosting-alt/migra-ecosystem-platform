#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

run_pm2() {
  if npx --no-install pm2 --version >/dev/null 2>&1; then
    npx --no-install pm2 "$@"
    return
  fi
  if command -v pm2 >/dev/null 2>&1; then
    pm2 "$@"
    return
  fi
  return 127
}

if [[ "${LOAD_DOTENV:-true}" == "true" && -f "${ROOT_DIR}/.env.production" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env.production"
  set +a
fi

DEPLOY_INSTALL_DEPS="${DEPLOY_INSTALL_DEPS:-true}"
DEPLOY_RUN_TESTS="${DEPLOY_RUN_TESTS:-false}"
DEPLOY_SKIP_DB_INDEX_CHECK="${DEPLOY_SKIP_DB_INDEX_CHECK:-false}"
DEPLOY_RUN_SMOKE_AUTH="${DEPLOY_RUN_SMOKE_AUTH:-false}"
DEPLOY_APPLY_MIGRATIONS="${DEPLOY_APPLY_MIGRATIONS:-true}"
DEPLOY_RESTART_CMD="${DEPLOY_RESTART_CMD:-}"
BASE_URL="${BASE_URL:-}"

cd "${ROOT_DIR}"

echo "Starting production deployment workflow..."

if [[ "${DEPLOY_INSTALL_DEPS}" == "true" ]]; then
  echo "[step] npm ci --include=dev"
  npm ci --include=dev
fi

echo "[step] pre-deploy checks"
NODE_ENV=production LOAD_DOTENV=false REQUIRE_PRODUCTION=true SKIP_DB_INDEX_CHECK="${DEPLOY_SKIP_DB_INDEX_CHECK}" bash scripts/predeploy-check.sh

echo "[step] prisma generate"
npm run prisma:generate

echo "[step] typecheck"
npm run typecheck

echo "[step] lint"
npm run lint

echo "[step] build"
npm run build

if [[ "${DEPLOY_RUN_TESTS}" == "true" ]]; then
  echo "[step] integration tests"
  npm run test:integration
fi

if [[ "${DEPLOY_APPLY_MIGRATIONS}" == "true" ]]; then
  echo "[step] prisma migrate deploy"
  npx prisma migrate deploy
fi

if [[ -n "${DEPLOY_RESTART_CMD}" ]]; then
  echo "[step] restart services"
  bash -lc "${DEPLOY_RESTART_CMD}"
elif [[ -f "${ROOT_DIR}/ecosystem.config.cjs" ]] && run_pm2 --version >/dev/null 2>&1; then
  echo "[step] restart services via PM2 ecosystem"
  run_pm2 startOrReload "${ROOT_DIR}/ecosystem.config.cjs" --update-env
  run_pm2 save
else
  echo "[warn] DEPLOY_RESTART_CMD not set; restart app/workers manually."
fi

if [[ "${DEPLOY_RUN_SMOKE_AUTH}" == "true" ]]; then
  if [[ -z "${BASE_URL}" ]]; then
    echo "BASE_URL is required when DEPLOY_RUN_SMOKE_AUTH=true"
    exit 1
  fi

  echo "[step] post-deploy smoke auth"
  LOAD_DOTENV=false BASE_URL="${BASE_URL}" npm run ops:smoke-auth
fi

echo "Production deployment workflow completed."
