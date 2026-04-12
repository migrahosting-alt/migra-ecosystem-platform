#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_SCRIPT="$SCRIPT_DIR/smoke-auth-settings.sh"

if [[ ! -f "$SMOKE_SCRIPT" ]]; then
  echo "[FAIL] Missing smoke script: $SMOKE_SCRIPT" >&2
  exit 1
fi

if [[ -n "${MIGRAPILOT_CONSOLE_BASE_URL:-}" ]]; then
  echo "[INFO] Using explicit MIGRAPILOT_CONSOLE_BASE_URL=$MIGRAPILOT_CONSOLE_BASE_URL"
  exec bash "$SMOKE_SCRIPT"
fi

CANDIDATE_PORTS="${MIGRAPILOT_CONSOLE_CANDIDATE_PORTS:-3511 3402 3401}"

for port in $CANDIDATE_PORTS; do
  base="http://127.0.0.1:${port}"
  body="$(curl -sS --max-time 3 "$base/api/auth/session" || true)"
  if echo "$body" | grep -q '"ok":true' && echo "$body" | grep -q '"authenticated"'; then
    export MIGRAPILOT_CONSOLE_BASE_URL="$base"
    echo "[INFO] Auto-discovered MigraPilot console at $base"
    exec bash "$SMOKE_SCRIPT"
  fi
done

echo "[FAIL] Could not auto-discover MigraPilot console on candidate ports: $CANDIDATE_PORTS" >&2
echo "[HINT] Set MIGRAPILOT_CONSOLE_BASE_URL explicitly and rerun." >&2
exit 1
