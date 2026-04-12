#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

require_database="${REQUIRE_DATABASE_URL:-false}"

existing_database_url="${DATABASE_URL-__unset__}"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

if [[ "${existing_database_url}" != "__unset__" ]]; then
  export DATABASE_URL="${existing_database_url}"
fi

echo "[prisma-verify] validating Prisma schema"
npx prisma validate >/dev/null

if [[ ! -d "${ROOT_DIR}/prisma/migrations" ]]; then
  echo "[prisma-verify] missing prisma/migrations directory"
  exit 1
fi

migration_count="$(find "${ROOT_DIR}/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [[ "${migration_count}" -eq 0 ]]; then
  echo "[prisma-verify] no migration directories found"
  exit 1
fi

echo "[prisma-verify] found ${migration_count} migration directories"

if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ "${require_database}" == "true" ]]; then
    echo "[prisma-verify] DATABASE_URL is required for this check"
    exit 1
  fi

  echo "[prisma-verify] DATABASE_URL not set; skipping migrate status"
  exit 0
fi

database_reachable() {
node - "${DATABASE_URL}" <<'NODE' >/dev/null 2>&1
const raw = process.argv[2];
const net = require("node:net");
try {
  const url = new URL(raw);
  const host = url.hostname;
  const port = Number(url.port || "5432");
  const socket = net.createConnection({ host, port });
  const done = (code) => {
    socket.destroy();
    process.exit(code);
  };
  socket.setTimeout(1000);
  socket.once("connect", () => done(0));
  socket.once("timeout", () => done(1));
  socket.once("error", () => done(1));
} catch {
  process.exit(1);
}
NODE
}

local_host="$(
node - "${DATABASE_URL}" <<'NODE'
try {
  const url = new URL(process.argv[2]);
  process.stdout.write(url.hostname || "");
} catch {
  process.exit(1);
}
NODE
)"

if ! database_reachable; then
  if [[ "${local_host}" == "127.0.0.1" || "${local_host}" == "localhost" ]]; then
    bash "${ROOT_DIR}/scripts/local-postgres.sh" ensure
  fi
fi

if ! database_reachable; then
  if [[ "${require_database}" == "true" ]]; then
    echo "[prisma-verify] database is unreachable for DATABASE_URL"
    exit 1
  fi

  echo "[prisma-verify] database is unreachable; skipping migrate status"
  exit 0
fi

echo "[prisma-verify] checking migration status"
npx prisma migrate status
