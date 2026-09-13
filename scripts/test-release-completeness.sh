#!/usr/bin/env bash
#
# The predicate that decides whether a release can serve, tested on real trees.
#
# 🚨 THE DIRECTION OF ERROR IS NOT SYMMETRIC. A false NEGATIVE here marks a good
# release prunable and deletes it. A false POSITIVE keeps a useless directory one
# cycle longer. Every case below is written with that asymmetry in mind: when in
# doubt the predicate must say COMPLETE.
#
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./release-completeness.sh
. "$HERE/release-completeness.sh"

PASS=0; FAIL=0
T="$(mktemp -d)"
trap 'chmod -R u+w "$T" 2>/dev/null; find "$T" -mindepth 1 -delete 2>/dev/null; rmdir "$T" 2>/dev/null' EXIT

ok()   { printf '  ok    %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  FAIL  %s — %s\n' "$1" "$2"; FAIL=$((FAIL+1)); }
check(){ # name expected-0-or-1 dir
  if release_is_complete "$3"; then got=0; else got=1; fi
  [ "$got" = "$2" ] && ok "$1" || bad "$1" "expected $([ "$2" = 0 ] && echo complete || echo incomplete)"
}

mk() { mkdir -p "$T/$1"; }

printf '\n== release completeness\n\n'

# ── a complete consumer release ────────────────────────────────────────────
mk consumer-ok/.next
mk consumer-ok/node_modules/next/dist/bin
: > "$T/consumer-ok/node_modules/next/dist/bin/next"
: > "$T/consumer-ok/package.json"
check "complete consumer release" 0 "$T/consumer-ok"
[ "$(release_kind "$T/consumer-ok")" = consumer ] && ok "identified as consumer" || bad "identified as consumer" "got $(release_kind "$T/consumer-ok")"

# ── exactly the exitprobe shape ────────────────────────────────────────────
mk exitprobe/.next
: > "$T/exitprobe/package.json"
check "🚨 exitprobe: .next + package.json, NO node_modules" 1 "$T/exitprobe"

# ── a complete brain release ───────────────────────────────────────────────
mk brain-ok/dist/src
: > "$T/brain-ok/dist/src/server.js"
mk brain-ok/node_modules
: > "$T/brain-ok/package.json"
check "complete brain release" 0 "$T/brain-ok"
[ "$(release_kind "$T/brain-ok")" = brain ] && ok "identified as brain" || bad "identified as brain" "got $(release_kind "$T/brain-ok")"

# ── a brain release missing its entrypoint ─────────────────────────────────
mk brain-noentry/dist/src
mk brain-noentry/node_modules
: > "$T/brain-noentry/package.json"
check "brain without dist/src/server.js is unidentifiable, falls back to the floor" 0 "$T/brain-noentry"
# It has node_modules, so the permissive `unknown` rule KEEPS it. That is the
# intended direction: we do not delete something we cannot identify.

# ── the floor ──────────────────────────────────────────────────────────────
mk unknown-with-modules/node_modules
check "unidentifiable but has node_modules — kept" 0 "$T/unknown-with-modules"
mk unknown-empty
check "unidentifiable and empty — prunable" 1 "$T/unknown-empty"

# ── a consumer release missing the next binary ─────────────────────────────
mk consumer-nobin/.next
mk consumer-nobin/node_modules
: > "$T/consumer-nobin/package.json"
check "consumer with .next but no next binary cannot start" 1 "$T/consumer-nobin"

# ── a path that is not there at all ────────────────────────────────────────
check "a missing directory is not complete" 1 "$T/does-not-exist"

# ── the remote form must agree with the local one ──────────────────────────
printf '\n== the remote expression matches the local predicate\n\n'
for kind in consumer brain unknown; do
  expr="$(release_completeness_test "$kind" "$T/consumer-ok")"
  if [ -z "$expr" ]; then bad "$kind expression is non-empty" "empty"; continue; fi
  # Evaluate the generated expression locally and compare with the predicate
  # for a directory of that shape.
  case "$kind" in
    consumer) dir="$T/consumer-ok" ;;
    brain)    dir="$T/brain-ok" ;;
    unknown)  dir="$T/unknown-with-modules" ;;
  esac
  expr="$(release_completeness_test "$kind" "$dir")"
  if eval "$expr" >/dev/null 2>&1; then remote=0; else remote=1; fi
  if release_is_complete "$dir"; then local_=0; else local_=1; fi
  [ "$remote" = "$local_" ] && ok "$kind: remote expression agrees with local predicate" \
    || bad "$kind: remote vs local" "remote=$remote local=$local_"
done

# And the generated expression must actually REJECT the exitprobe shape.
expr="$(release_completeness_test consumer "$T/exitprobe")"
if eval "$expr" >/dev/null 2>&1; then
  bad "🚨 consumer expression rejects the exitprobe shape" "it accepted it"
else
  ok "🚨 consumer expression rejects the exitprobe shape"
fi

printf '\n  %s passed, %s failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
