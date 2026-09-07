#!/usr/bin/env bash
# MUTATION COVERAGE FOR THE WORKSPACE-STAGING GATE.
#
# Entirely LOCAL: two directory trees standing in for "what was built" and "what
# the release staged". No host, no release, nothing that could touch production —
# a gate that must be exercised against a real deploy to be trusted would never
# be run.
#
# Each case restores one of the actual bad behaviours and asserts the gate says
# no. A gate nobody has watched fail is a preference.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
DIGEST="$HERE/workspace-digest.mjs"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

pass=0; fail=0
ok()   { echo "  PASS  $*"; pass=$((pass+1)); }
bad()  { echo "  FAIL  $*"; fail=$((fail+1)); }

# The comparison the gate performs, extracted so the test exercises the real
# logic rather than a re-description of it.
compare() {
  node -e "
    const a = JSON.parse(process.argv[1]); const b = JSON.parse(process.argv[2]);
    if (!a.ok)  { console.log('LOCAL_UNUSABLE'); process.exit(1); }
    if (!b.ok)  { console.log('STAGED_UNUSABLE:' + (b.error ?? '')); process.exit(1); }
    if (b.missingTargets?.length) { console.log('MISSING_TARGETS'); process.exit(1); }
    if (a.distDigest !== b.distDigest) { console.log('DIGEST_MISMATCH'); process.exit(1); }
    console.log('MATCH');
  " "$1" "$2"
}

mkpkg() {
  local dir="$1" body="$2"
  mkdir -p "$dir/dist"
  cat > "$dir/package.json" <<'JSON'
{ "name": "@migrapilot/fixture", "version": "0.1.0", "files": ["dist"],
  "exports": { "./thing": { "types": "./src/thing.ts", "default": "./dist/thing.js" } } }
JSON
  printf '%s\n' "$body" > "$dir/dist/thing.js"
}

echo "workspace-staging gate — mutation coverage"

# ── control ────────────────────────────────────────────────────────────────
mkpkg "$WORK/built"  "export const STEP_LABEL = {};"
mkpkg "$WORK/staged" "export const STEP_LABEL = {};"
R="$(compare "$(node "$DIGEST" "$WORK/built")" "$(node "$DIGEST" "$WORK/staged")")"
[ "$R" = "MATCH" ] && ok "a correctly staged package passes" || bad "control failed: $R"

# ── 1. the actual production defect: inherited STALE package ───────────────
mkpkg "$WORK/staged" "export const OLD_ONLY = {};"   # the 3-day-old build
R="$(compare "$(node "$DIGEST" "$WORK/built")" "$(node "$DIGEST" "$WORK/staged")")"
[ "$R" = "DIGEST_MISMATCH" ] \
  && ok "🚨 an inherited STALE workspace package is caught (the rc-0907 failure)" \
  || bad "stale package NOT caught: $R"

# ── 2. stale but still satisfying every import — the SILENT case ───────────
# This is the one a boot test cannot catch: the old package still exports what
# the new code imports, so nothing crashes and production quietly runs old
# behaviour. Only a digest sees it.
mkpkg "$WORK/staged" "export const STEP_LABEL = { 'workspace.inspect': 'OLD WORDING' };"
R="$(compare "$(node "$DIGEST" "$WORK/built")" "$(node "$DIGEST" "$WORK/staged")")"
[ "$R" = "DIGEST_MISMATCH" ] \
  && ok "🚨 a stale package that still satisfies every import is caught" \
  || bad "silent staleness NOT caught: $R"

# ── 3. a staged package removed entirely ───────────────────────────────────
rm -rf "$WORK/staged"
R="$(compare "$(node "$DIGEST" "$WORK/built")" "$(node "$DIGEST" "$WORK/staged")")"
[[ "$R" == STAGED_UNUSABLE* ]] \
  && ok "a missing staged package is caught" \
  || bad "missing package NOT caught: $R"

# ── 4. present, but its export target is absent ────────────────────────────
mkpkg "$WORK/staged" "export const STEP_LABEL = {};"
rm -f "$WORK/staged/dist/thing.js"
R="$(compare "$(node "$DIGEST" "$WORK/built")" "$(node "$DIGEST" "$WORK/staged")")"
[[ "$R" == STAGED_UNUSABLE* || "$R" == "MISSING_TARGETS" ]] \
  && ok "a missing export target is caught" \
  || bad "missing export target NOT caught: $R"

# ── 5. 🚨 the rollback release must not be mutated ─────────────────────────
# `cp -al` hardlinks, so writing INTO a staged file edits the same inode the
# previous release serves. Proven on real hardlinks, locally: write-through
# corrupts the rollback, remove-then-replace does not.
mkdir -p "$WORK/prev/dist" "$WORK/next"
printf 'ROLLBACK BYTES\n' > "$WORK/prev/dist/thing.js"
cp -al "$WORK/prev" "$WORK/next/pkg"

printf 'NEW BYTES\n' > "$WORK/next/pkg/dist/thing.js"          # write-through
if grep -q 'NEW BYTES' "$WORK/prev/dist/thing.js"; then
  ok "🚨 writing through a hardlink DOES corrupt the rollback — which is why we remove first"
else
  bad "hardlink semantics not as assumed; the staging rule needs rechecking"
fi

printf 'ROLLBACK BYTES\n' > "$WORK/prev/dist/thing.js"          # restore, then do it right
rm -rf "$WORK/next/pkg"; cp -al "$WORK/prev" "$WORK/next/pkg"
rm -rf "$WORK/next/pkg/dist"                                    # REMOVE, as the script does
mkdir -p "$WORK/next/pkg/dist"; printf 'NEW BYTES\n' > "$WORK/next/pkg/dist/thing.js"
if grep -q 'ROLLBACK BYTES' "$WORK/prev/dist/thing.js"; then
  ok "remove-then-replace leaves the rollback release untouched"
else
  bad "remove-then-replace still mutated the rollback target"
fi

echo
echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
