#!/usr/bin/env bash
set -euo pipefail

ROOT="$(mktemp -d)"
trap 'rm -rf "$ROOT"' EXIT

RELEASES="$ROOT/releases/migrateck"
APP="$ROOT/apps/migrateck"
mkdir -p "$RELEASES" "$APP"

old1="20260101T010101Z-old-one"
old2="20260102-old-two"
recent="$(date -u +%Y%m%d)-recent"
recent2="$(date -u +%Y%m%d)-recent-two"
active="$(date -u +%Y%m%d)-active"
previous="$(date -u +%Y%m%d)-previous"
unknown="manual-backup"

for name in "$old1" "$old2" "$recent" "$recent2" "$active" "$previous" "$unknown"; do
  mkdir -p "$RELEASES/$name"
done

for name in "$recent" "$recent2" "$active" "$previous" "$unknown"; do
  mkdir -p "$RELEASES/$name/apps/web/.next/cache"
  printf 'cache-%s\n' "$name" >"$RELEASES/$name/apps/web/.next/cache/sentinel.txt"
done

ln -s "$RELEASES/$active" "$APP/current"
ln -s "$RELEASES/$previous" "$APP/previous"

OUT="$ROOT/out.txt"
RELEASES_ROOT="$RELEASES" \
ACTIVE_LINK="$APP/current" \
PREVIOUS_LINK="$APP/previous" \
RETENTION_DAYS=14 \
MIN_KEEP=4 \
bash "$(dirname "$0")/release-retention.sh" >"$OUT"

grep -q "delete $old1" "$OUT"
grep -q "delete $old2" "$OUT"
grep -q "keep   $active (ACTIVE)" "$OUT"
grep -q "keep   $previous (PREVIOUS)" "$OUT"
grep -q "keep   $recent (inside 14-day window)" "$OUT"
grep -q "prune  $recent/apps/web/.next/cache" "$OUT"
grep -q "prune  $recent2/apps/web/.next/cache" "$OUT"
! grep -q "prune  $active/apps/web/.next/cache" "$OUT"
! grep -q "prune  $previous/apps/web/.next/cache" "$OUT"
! grep -q "prune  $unknown/apps/web/.next/cache" "$OUT"
grep -q "SKIP unknown-name directory" "$OUT"

RELEASES_ROOT="$RELEASES" \
ACTIVE_LINK="$APP/current" \
PREVIOUS_LINK="$APP/previous" \
RETENTION_DAYS=14 \
MIN_KEEP=4 \
bash "$(dirname "$0")/release-retention.sh" --apply >/dev/null

[[ ! -e "$RELEASES/$old1" ]]
[[ ! -e "$RELEASES/$old2" ]]
[[ -d "$RELEASES/$active" ]]
[[ -d "$RELEASES/$previous" ]]
[[ -d "$RELEASES/$recent" ]]
[[ -d "$RELEASES/$recent2" ]]
[[ -d "$RELEASES/$unknown" ]]

[[ ! -e "$RELEASES/$recent/apps/web/.next/cache" ]]
[[ ! -e "$RELEASES/$recent2/apps/web/.next/cache" ]]
[[ -f "$RELEASES/$active/apps/web/.next/cache/sentinel.txt" ]]
[[ -f "$RELEASES/$previous/apps/web/.next/cache/sentinel.txt" ]]
[[ -f "$RELEASES/$unknown/apps/web/.next/cache/sentinel.txt" ]]

echo "release retention contract: PASS"
