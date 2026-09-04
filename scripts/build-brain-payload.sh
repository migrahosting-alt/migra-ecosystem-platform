#!/usr/bin/env bash
#
# Build the Brain release payload — ONE definition, used by CI and by hand.
#
# WHY THIS IS A SCRIPT AND NOT A LIST IN A WORKFLOW. The payload contract is easy
# to get subtly wrong: omit a workspace package.json and the release installs a
# stale dependency; omit a dist and the service crashes at import time in front of
# users. That has happened here before. A deploy done by hand at 3am and a deploy
# done by a runner must produce the byte-identical tree, so they call this.
#
# Usage: build-brain-payload.sh <output.tgz>
#
# Expects the repo to be already installed and built (npm ci && npm run build -ws),
# because the caller decides how to do that — CI installs from the lockfile, a human
# may already have a warm tree.
#
# © MigraTeck LLC.
set -euo pipefail

OUT="${1:-}"
[ -n "$OUT" ] || { echo "usage: $0 <output.tgz>" >&2; exit 2; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

WORKSPACE_PKGS=(protocol shared-types pilot-client agent-defs workspace-tools)

# ── GATE: refuse to build a payload that is missing its code ────────────────────
#
# "pack succeeded" is not evidence. A tarball can be well-formed and functionally
# empty — that is not hypothetical here, npm pack once shipped @migrapilot/protocol
# with 1 file out of 30 because .gitignore hides dist/. Check CONTENT first.
missing=()
[ -d apps/brain-service/dist/src ] || missing+=("apps/brain-service/dist/src")
for p in "${WORKSPACE_PKGS[@]}"; do
  [ -d "packages/$p/dist" ] || missing+=("packages/$p/dist")
done
if [ ${#missing[@]} -gt 0 ]; then
  printf 'refusing to build a payload with no build output:\n' >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "run: npm ci && npm run build -ws" >&2
  exit 1
fi

args=(package.json package-lock.json apps/brain-service/package.json apps/brain-service/dist)
for p in "${WORKSPACE_PKGS[@]}"; do
  args+=("packages/$p/package.json" "packages/$p/dist")
done

tar -czf "$OUT" "${args[@]}"

# ── GATE: and prove the entry point is actually inside it ───────────────────────
#
# The listing is materialised FIRST rather than piped into `grep -q`. Under
# `set -o pipefail` that pipe reports failure whenever grep exits early and tar
# takes SIGPIPE — so the check failed on a payload that was perfectly correct.
# A deploy gate that cries wolf is worse than no gate: it gets disabled.
LISTING="$(tar -tzf "$OUT")"
case $'\n'"$LISTING"$'\n' in
  *$'\n'apps/brain-service/dist/src/server.js$'\n'*) : ;;
  *) echo "payload has no server.js — refusing to hand this to a release" >&2; exit 1 ;;
esac
echo "payload: $OUT ($(du -h "$OUT" | cut -f1), $(printf '%s\n' "$LISTING" | wc -l) entries)"
