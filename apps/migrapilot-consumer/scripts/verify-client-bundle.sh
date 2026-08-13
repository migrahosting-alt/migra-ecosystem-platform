#!/usr/bin/env bash
# Prove the client bundle contains no server-only material.
#
# Run after `next build`. Fails loudly if any forbidden string reaches a client
# chunk, and fails just as loudly if there are no chunks to scan — a scan that
# reads nothing would otherwise "pass" vacuously.
set -euo pipefail

STATIC_DIR="${1:-.next/static}"

if [ ! -d "$STATIC_DIR" ]; then
  echo "FAIL: $STATIC_DIR not found. Run 'next build' first." >&2
  exit 1
fi

chunks=$(find "$STATIC_DIR" -type f -name '*.js' | wc -l)
if [ "$chunks" -eq 0 ]; then
  echo "FAIL: no client JS chunks found — the scan would be vacuous." >&2
  exit 1
fi
echo "Scanning $chunks client chunks in $STATIC_DIR"

# Positive control: if this is missing, the scan is not reading real content.
if ! grep -rql 'MigraPilot' "$STATIC_DIR" --include='*.js'; then
  echo "FAIL: positive control string absent — scan is not reading bundle content." >&2
  exit 1
fi

FORBIDDEN=(
  '3988'                # Brain port
  'BRAIN_BASE_URL'      # Brain location
  'x-owner-scope'       # tenancy header
  'x-workspace-scope'
  '/api/ai/'            # Brain route surface
  'sessionSecret'       # auth-client secrets
  'clientSecret'
  'SESSION_SECRET'      # server env variable names
  'MIGRAAUTH_CLIENT_SECRET'
  'callBrain'           # gateway implementation symbols
  'resolveOperation'
  'OUTBOUND_HEADER_ALLOWLIST'
  'deriveBrainScope'    # tenancy derivation symbols
  'isDerivedOwnerScope'
  'getAppSession'       # canonical auth internals
  'exchangeCode'
  'handleOAuthCallback'
)

status=0
for pattern in "${FORBIDDEN[@]}"; do
  # `grep` exits 1 on no-match, which is the PASSING case here — so the failure
  # is absorbed rather than tripping `set -e` / `pipefail`.
  hits=$({ grep -ril -- "$pattern" "$STATIC_DIR" --include='*.js' 2>/dev/null || true; } | wc -l)
  if [ "$hits" -ne 0 ]; then
    echo "FAIL: '$pattern' found in $hits client chunk(s)" >&2
    status=1
  else
    printf '  ok  %s\n' "$pattern"
  fi
done

if [ "$status" -eq 0 ]; then
  echo "PASS: no server-only material in the client bundle."
fi
exit "$status"
