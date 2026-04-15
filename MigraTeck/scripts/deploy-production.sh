#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DEPLOY_WORKSPACE="${DEPLOY_WORKSPACE:-@migrateck/web}"
DEPLOY_INSTALL_DEPS="${DEPLOY_INSTALL_DEPS:-true}"
DEPLOY_RUN_TYPECHECK="${DEPLOY_RUN_TYPECHECK:-true}"
DEPLOY_RUN_LINT="${DEPLOY_RUN_LINT:-true}"
DEPLOY_RUN_BUILD="${DEPLOY_RUN_BUILD:-true}"
DEPLOY_RESTART_CMD="${DEPLOY_RESTART_CMD:-}"
DEPLOY_SYNC_REMOTE="${DEPLOY_SYNC_REMOTE:-false}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_SSH_PORT="${DEPLOY_SSH_PORT:-22}"
DEPLOY_REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/opt/migra/repos/migrateck/app}"
DEPLOY_SERVICE="${DEPLOY_SERVICE:-migrateck}"
DEPLOY_RSYNC_DELETE="${DEPLOY_RSYNC_DELETE:-false}"
DEPLOY_RUN_SMOKE="${DEPLOY_RUN_SMOKE:-false}"
DEPLOY_SMOKE_URL="${DEPLOY_SMOKE_URL:-${BASE_URL:-}}"
DEPLOY_SMOKE_ATTEMPTS="${DEPLOY_SMOKE_ATTEMPTS:-10}"
DEPLOY_SMOKE_DELAY_SECONDS="${DEPLOY_SMOKE_DELAY_SECONDS:-2}"

log() {
  printf '%s\n' "$1"
}

run_workspace_checks() {
  cd "${ROOT_DIR}"

  if [[ "${DEPLOY_INSTALL_DEPS}" == "true" ]]; then
    log "[step] npm ci --include=dev"
    npm ci --include=dev
  fi

  if [[ "${DEPLOY_RUN_TYPECHECK}" == "true" ]]; then
    log "[step] typecheck ${DEPLOY_WORKSPACE}"
    npm run typecheck -w "${DEPLOY_WORKSPACE}"
  fi

  if [[ "${DEPLOY_RUN_LINT}" == "true" ]]; then
    log "[step] lint ${DEPLOY_WORKSPACE}"
    npm run lint -w "${DEPLOY_WORKSPACE}"
  fi

  if [[ "${DEPLOY_RUN_BUILD}" == "true" ]]; then
    log "[step] build ${DEPLOY_WORKSPACE}"
    npm run build -w "${DEPLOY_WORKSPACE}"
  fi
}

run_remote_sync() {
  if [[ -z "${DEPLOY_HOST}" ]]; then
    log "DEPLOY_HOST is required when DEPLOY_SYNC_REMOTE=true"
    exit 1
  fi

  local remote_target="${DEPLOY_USER}@${DEPLOY_HOST}"
  local -a rsync_cmd=(
    rsync
    -az
    --exclude
    .git/
    --exclude
    node_modules/
    --exclude
    .next/
    --exclude
    .turbo/
    --exclude
    apps/*/node_modules/
    --exclude
    apps/*/.next/
    --exclude
    coverage/
    --exclude
    dist/
    --exclude
    logs/
    --exclude
    test-results/
    --exclude
    tmp/
    -e
    "ssh -p ${DEPLOY_SSH_PORT}"
  )

  if [[ "${DEPLOY_RSYNC_DELETE}" == "true" ]]; then
    rsync_cmd+=(--delete)
  fi

  log "[step] rsync repo to ${remote_target}:${DEPLOY_REMOTE_DIR}"
  rsync_cmd+=("${ROOT_DIR}/" "${remote_target}:${DEPLOY_REMOTE_DIR}/")
  "${rsync_cmd[@]}"

  log "[step] remote install/build/restart on ${remote_target}"
  ssh -p "${DEPLOY_SSH_PORT}" "${remote_target}" \
    "DEPLOY_REMOTE_DIR=$(printf '%q' "${DEPLOY_REMOTE_DIR}") DEPLOY_WORKSPACE=$(printf '%q' "${DEPLOY_WORKSPACE}") DEPLOY_INSTALL_DEPS=$(printf '%q' "${DEPLOY_INSTALL_DEPS}") DEPLOY_RUN_TYPECHECK=$(printf '%q' "${DEPLOY_RUN_TYPECHECK}") DEPLOY_RUN_LINT=$(printf '%q' "${DEPLOY_RUN_LINT}") DEPLOY_RUN_BUILD=$(printf '%q' "${DEPLOY_RUN_BUILD}") DEPLOY_SERVICE=$(printf '%q' "${DEPLOY_SERVICE}") bash -s" <<'EOF'
set -euo pipefail

cd "$DEPLOY_REMOTE_DIR"

has_root_workspaces() {
  node <<'NODE'
const fs = require('fs');

try {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  process.exit(Array.isArray(pkg.workspaces) && pkg.workspaces.length > 0 ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

resolve_workspace_dir() {
  node <<'NODE'
const fs = require('fs');
const path = require('path');

const target = process.env.DEPLOY_WORKSPACE;
const roots = ['apps', 'packages'];

for (const root of roots) {
  if (!fs.existsSync(root)) {
    continue;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const packageDir = path.join(root, entry.name);
    const packageJsonPath = path.join(packageDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
      continue;
    }

    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (pkg.name === target) {
        process.stdout.write(packageDir);
        process.exit(0);
      }
    } catch {
      // Ignore malformed package.json files and keep searching.
    }
  }
}

process.exit(1);
NODE
}

run_package_cmd() {
  local script_name="$1"

  if [[ "$REMOTE_HAS_WORKSPACES" == "true" ]]; then
    npm run "$script_name" -w "$DEPLOY_WORKSPACE"
  else
    (
      cd "$DEPLOY_REMOTE_DIR/$REMOTE_WORKSPACE_DIR"
      npm run "$script_name"
    )
  fi
}

REMOTE_HAS_WORKSPACES="false"
REMOTE_WORKSPACE_DIR=""

if has_root_workspaces; then
  REMOTE_HAS_WORKSPACES="true"
else
  REMOTE_WORKSPACE_DIR="$(resolve_workspace_dir)" || {
    echo "Unable to resolve remote workspace directory for $DEPLOY_WORKSPACE" >&2
    exit 1
  }
fi

if [[ "$DEPLOY_INSTALL_DEPS" == "true" ]]; then
  if [[ "$REMOTE_HAS_WORKSPACES" != "true" ]]; then
    echo "Remote dependency install requires a workspace-aware root; set DEPLOY_INSTALL_DEPS=false for runtime-tree deploys." >&2
    exit 1
  fi

  npm ci --include=dev
fi

if [[ "$DEPLOY_RUN_TYPECHECK" == "true" ]]; then
  run_package_cmd typecheck
fi

if [[ "$DEPLOY_RUN_LINT" == "true" ]]; then
  run_package_cmd lint
fi

if [[ "$DEPLOY_RUN_BUILD" == "true" ]]; then
  run_package_cmd build
fi

systemctl restart "$DEPLOY_SERVICE"
systemctl --no-pager --full status "$DEPLOY_SERVICE" --lines=20
EOF
}

run_smoke() {
  if [[ "${DEPLOY_RUN_SMOKE}" != "true" ]]; then
    return
  fi

  if [[ -z "${DEPLOY_SMOKE_URL}" ]]; then
    log "DEPLOY_SMOKE_URL or BASE_URL is required when DEPLOY_RUN_SMOKE=true"
    exit 1
  fi

  log "[step] smoke check ${DEPLOY_SMOKE_URL}"

  local attempt=1
  while (( attempt <= DEPLOY_SMOKE_ATTEMPTS )); do
    if curl -fsSLI "${DEPLOY_SMOKE_URL}" >/dev/null; then
      return
    fi

    if (( attempt == DEPLOY_SMOKE_ATTEMPTS )); then
      log "Smoke check failed after ${DEPLOY_SMOKE_ATTEMPTS} attempts."
      exit 1
    fi

    log "[warn] smoke check attempt ${attempt}/${DEPLOY_SMOKE_ATTEMPTS} failed; retrying in ${DEPLOY_SMOKE_DELAY_SECONDS}s"
    sleep "${DEPLOY_SMOKE_DELAY_SECONDS}"
    attempt=$((attempt + 1))
  done
}

cd "${ROOT_DIR}"

log "Starting production deployment workflow for ${DEPLOY_WORKSPACE}..."

run_workspace_checks

if [[ "${DEPLOY_SYNC_REMOTE}" == "true" ]]; then
  run_remote_sync
elif [[ -n "${DEPLOY_RESTART_CMD}" ]]; then
  log "[step] restart local service"
  bash -lc "${DEPLOY_RESTART_CMD}"
else
  log "[warn] No remote sync or restart command configured. Build completed locally only."
fi

run_smoke

log "Production deployment workflow completed."
