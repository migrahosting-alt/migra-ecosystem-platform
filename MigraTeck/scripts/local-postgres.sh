#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/docker-compose.local-db.yml"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

parse_database_url() {
  [[ -n "${DATABASE_URL:-}" ]] || return 1
  node -e '
    const raw = process.argv[1];
    try {
      const url = new URL(raw);
      process.stdout.write([
        url.hostname || "",
        url.port || "",
        decodeURIComponent(url.username || ""),
        decodeURIComponent(url.password || ""),
        (url.pathname || "").replace(/^\//, ""),
      ].join("\n"));
    } catch {
      process.exit(1);
    }
  ' "${DATABASE_URL}"
}

derive_defaults() {
  local parsed host port user password db
  parsed="$(parse_database_url 2>/dev/null || true)"
  [[ -n "${parsed}" ]] || return 0

  host="$(printf '%s\n' "${parsed}" | sed -n '1p')"
  port="$(printf '%s\n' "${parsed}" | sed -n '2p')"
  user="$(printf '%s\n' "${parsed}" | sed -n '3p')"
  password="$(printf '%s\n' "${parsed}" | sed -n '4p')"
  db="$(printf '%s\n' "${parsed}" | sed -n '5p')"

  export POSTGRES_HOST="${POSTGRES_HOST:-$host}"
  export POSTGRES_PORT="${POSTGRES_PORT:-${port:-5432}}"
  export POSTGRES_USER="${POSTGRES_USER:-$user}"
  export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$password}"
  export POSTGRES_DB="${POSTGRES_DB:-$db}"
}

database_reachable() {
  node -e '
    const net = require("node:net");
    const host = process.argv[1];
    const port = Number(process.argv[2]);
    const socket = net.createConnection({ host, port });
    const done = (code) => {
      socket.destroy();
      process.exit(code);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(0));
    socket.once("timeout", () => done(1));
    socket.once("error", () => done(1));
  ' "${POSTGRES_HOST:-127.0.0.1}" "${POSTGRES_PORT:-5432}" >/dev/null 2>&1
}

ensure_docker() {
  command -v docker >/dev/null 2>&1 || {
    echo "[local-postgres] docker is not installed"
    exit 1
  }
  docker info >/dev/null 2>&1 || {
    echo "[local-postgres] docker daemon is unavailable"
    exit 1
  }
}

require_local_target() {
  derive_defaults
  local host="${POSTGRES_HOST:-127.0.0.1}"
  if [[ "${host}" != "127.0.0.1" && "${host}" != "localhost" ]]; then
    echo "[local-postgres] refusing to manage non-local database host: ${host}"
    exit 1
  fi
}

compose() {
  docker compose -f "${COMPOSE_FILE}" "$@"
}

wait_for_database() {
  echo -n "[local-postgres] waiting for postgres"
  for _ in $(seq 1 20); do
    if database_reachable; then
      echo " ✓"
      return 0
    fi
    echo -n "."
    sleep 1
  done
  echo " ✗"
  return 1
}

cmd_start() {
  require_local_target
  ensure_docker
  if database_reachable; then
    echo "[local-postgres] postgres already reachable on ${POSTGRES_HOST:-127.0.0.1}:${POSTGRES_PORT:-5432}"
    return 0
  fi
  echo "[local-postgres] starting local postgres on ${POSTGRES_HOST:-127.0.0.1}:${POSTGRES_PORT:-5432}"
  compose up -d postgres
  wait_for_database
}

cmd_ensure() {
  require_local_target
  if database_reachable; then
    echo "[local-postgres] postgres already reachable on ${POSTGRES_HOST:-127.0.0.1}:${POSTGRES_PORT:-5432}"
    return 0
  fi
  cmd_start
}

cmd_stop() {
  require_local_target
  ensure_docker
  compose stop postgres
}

cmd_status() {
  require_local_target
  local host="${POSTGRES_HOST:-127.0.0.1}"
  local port="${POSTGRES_PORT:-5432}"
  if database_reachable; then
    echo "[local-postgres] reachable on ${host}:${port}"
  else
    echo "[local-postgres] unreachable on ${host}:${port}"
  fi
  if docker info >/dev/null 2>&1; then
    compose ps
  fi
}

cmd_logs() {
  require_local_target
  ensure_docker
  compose logs --tail=200 postgres
}

case "${1:-ensure}" in
  start) cmd_start ;;
  ensure) cmd_ensure ;;
  stop) cmd_stop ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *)
    echo "Usage: local-postgres.sh [start|ensure|stop|status|logs]"
    exit 1
    ;;
esac
