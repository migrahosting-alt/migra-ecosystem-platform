#!/usr/bin/env bash
set -euo pipefail

HOST_LABEL="${HOST_LABEL:-$(hostname)}"
RELEASES_ROOT="${RELEASES_ROOT:-/opt/migra/releases/migrateck}"
ACTIVE_LINK="${ACTIVE_LINK:-/opt/migra/apps/migrateck/current}"
PREVIOUS_LINK="${PREVIOUS_LINK:-/opt/migra/apps/migrateck/previous}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_KEEP="${MIN_KEEP:-4}"
MAX_KEEP="${MAX_KEEP:-10}"
BUILD_CACHE_RELATIVE="${BUILD_CACHE_RELATIVE:-apps/web/.next/cache}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# Release history contains three legitimate timestamp shapes:
#   YYYYMMDD-name
#   YYYYMMDDTHHMM-name       (legacy minute-stamped releases)
#   YYYYMMDDTHHMMSS[Z]-name  (current second-stamped releases)
# Unknown names remain fail-closed and are never auto-deleted.
NAME_RE='^([0-9]{8})(T([0-9]{4}|[0-9]{6}Z?))?-.+$'

die() { echo "ABORT: $*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "RETENTION_DAYS must be numeric"
[[ "$MIN_KEEP" =~ ^[0-9]+$ ]] || die "MIN_KEEP must be numeric"
[[ "$MAX_KEEP" =~ ^[0-9]+$ ]] || die "MAX_KEEP must be numeric"
(( RETENTION_DAYS >= 1 )) || die "RETENTION_DAYS must be at least 1"
(( MIN_KEEP >= 2 )) || die "MIN_KEEP must be at least 2"
(( MAX_KEEP >= MIN_KEEP )) || die "MAX_KEEP must be greater than or equal to MIN_KEEP"
[[ -n "$BUILD_CACHE_RELATIVE" ]] || die "BUILD_CACHE_RELATIVE cannot be empty"
[[ "$BUILD_CACHE_RELATIVE" != /* ]] || die "BUILD_CACHE_RELATIVE must be relative"
[[ "$BUILD_CACHE_RELATIVE" != *".."* ]] || die "BUILD_CACHE_RELATIVE cannot contain '..'"

[[ -d "$RELEASES_ROOT" ]] || die "releases root does not exist: $RELEASES_ROOT"
case "$RELEASES_ROOT" in
  */releases/*) : ;;
  *) die "refusing: '$RELEASES_ROOT' is not under a */releases/* path" ;;
esac
case "$RELEASES_ROOT" in
  *storage*|*uploads*|*.data*|*/var/www/*|*/srv/*)
    die "refusing: '$RELEASES_ROOT' looks like a data/storage path"
    ;;
esac

resolve_pinned_release() {
  local link="$1" required="$2" target name
  if [[ ! -L "$link" ]]; then
    [[ "$required" == "1" ]] && die "required release symlink is missing: $link"
    return 0
  fi

  target="$(readlink -f "$link")"
  [[ -d "$target" ]] || die "release symlink target is not a directory: $link -> $target"
  case "$target" in
    "$RELEASES_ROOT"/*) : ;;
    *) die "release symlink escapes the configured releases root: $link -> $target" ;;
  esac

  name="$(basename "$target")"
  [[ "$name" =~ $NAME_RE ]] || die "pinned release has an unrecognized name: $name"
  printf '%s\n' "$name"
}

ACTIVE="$(resolve_pinned_release "$ACTIVE_LINK" 1)"
PREVIOUS="$(resolve_pinned_release "$PREVIOUS_LINK" 0 || true)"
CUTOFF="$(date -u -d "$RETENTION_DAYS days ago" +%Y%m%d)"

echo "=== Release retention — $HOST_LABEL"
note "root          : $RELEASES_ROOT"
note "active        : $ACTIVE"
note "previous      : ${PREVIOUS:-none}"
note "policy        : keep pinned/referenced + newest ordinary releases (max target $MAX_KEEP, age ceiling $RETENTION_DAYS days, minimum $MIN_KEEP)"
note "cutoff day    : $CUTOFF"
note "mode          : $([[ $APPLY -eq 1 ]] && echo APPLY || echo 'DRY RUN (nothing deleted)')"
df -Ph "$RELEASES_ROOT" | tail -1 | awk '{printf "  disk before   : %s used, %s free (%s)\n", $3, $4, $5}'

mapfile -t ALL < <(find "$RELEASES_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort)
[[ ${#ALL[@]} -gt 0 ]] || die "no release directories found"

VALID=()
declare -A RELEASE_DAY=()
UNKNOWN=()
for name in "${ALL[@]}"; do
  if [[ "$name" =~ $NAME_RE ]]; then
    day="${BASH_REMATCH[1]}"
    if date -u -d "${day:0:4}-${day:4:2}-${day:6:2}" +%Y%m%d >/dev/null 2>&1; then
      VALID+=("$name")
      RELEASE_DAY["$name"]="$day"
    else
      UNKNOWN+=("$name")
    fi
  else
    UNKNOWN+=("$name")
  fi
done
[[ ${#VALID[@]} -gt 0 ]] || die "no recognized release directories found"

for name in "${UNKNOWN[@]}"; do
  note "SKIP unknown-name directory (never auto-delete): $name"
done

declare -A LIVE_REFERENCES=()

scan_live_references() {
  LIVE_REFERENCES=()
  LIVE_REFERENCES["$ACTIVE"]=1
  [[ -n "$PREVIOUS" ]] && LIVE_REFERENCES["$PREVIOUS"]=1

  local p cwd rel name base link target
  for p in /proc/[0-9]*; do
    cwd="$(readlink "$p/cwd" 2>/dev/null || true)"
    case "$cwd" in
      "$RELEASES_ROOT"/*)
        rel="${cwd#"$RELEASES_ROOT"/}"
        name="${rel%%/*}"
        [[ -n "$name" ]] && LIVE_REFERENCES["$name"]=1
        ;;
    esac
  done

  for base in /opt/migra /etc /srv; do
    [[ -e "$base" ]] || continue
    while IFS= read -r -d '' link; do
      # Symlinks located inside a release are package/runtime internals, not
      # evidence that another live surface references that release.
      case "$link" in
        "$RELEASES_ROOT"/*) continue ;;
      esac

      target="$(readlink -f "$link" 2>/dev/null || true)"
      case "$target" in
        "$RELEASES_ROOT"/*)
          rel="${target#"$RELEASES_ROOT"/}"
          name="${rel%%/*}"
          [[ -n "$name" ]] && LIVE_REFERENCES["$name"]=1
          ;;
      esac
    done < <(
      if [[ "$base" == "/opt/migra" && "$RELEASES_ROOT" == /opt/migra/* ]]; then
        find "$base" -maxdepth 6 -path "$RELEASES_ROOT" -prune -o -type l -print0 2>/dev/null
      else
        find "$base" -maxdepth 6 -type l -print0 2>/dev/null
      fi
    )
  done
}

is_referenced() {
  local name="$1" path="$RELEASES_ROOT/$1"

  [[ -n "${LIVE_REFERENCES[$name]:-}" ]] && return 0
  grep -rqlF "$path" /etc/systemd/system/ 2>/dev/null && return 0
  grep -rqlF "$path" /etc/nginx/ 2>/dev/null && return 0
  return 1
}

scan_live_references

# Pinned and externally referenced releases are never counted against the
# ordinary rollback budget. If live references alone exceed MAX_KEEP, all of
# them remain protected and the target expands rather than deleting a live
# runtime dependency.
declare -A KEEP_REASON=()
PROTECTED_COUNT=0
for name in "${VALID[@]}"; do
  if [[ "$name" == "$ACTIVE" ]]; then
    KEEP_REASON["$name"]="ACTIVE"
  elif [[ -n "$PREVIOUS" && "$name" == "$PREVIOUS" ]]; then
    KEEP_REASON["$name"]="PREVIOUS"
  elif is_referenced "$name"; then
    KEEP_REASON["$name"]="REFERENCED"
  else
    continue
  fi
  PROTECTED_COUNT=$((PROTECTED_COUNT + 1))
done

TARGET_KEEP="$MAX_KEEP"
if (( PROTECTED_COUNT > TARGET_KEEP )); then
  note "protected/live references ($PROTECTED_COUNT) exceed MAX_KEEP=$MAX_KEEP; expanding target rather than deleting live releases"
  TARGET_KEEP="$PROTECTED_COUNT"
fi

# Rank ordinary releases newest-first by directory mtime. Release names are
# still validated independently, but mtime gives stable ordering when several
# deployments share the same YYYYMMDD legacy prefix.
mapfile -t NEWEST_ORDINARY < <(
  for name in "${VALID[@]}"; do
    [[ -n "${KEEP_REASON[$name]:-}" ]] && continue
    printf '%s\t%s\n' "$(stat -c '%Y' "$RELEASES_ROOT/$name")" "$name"
  done | sort -k1,1nr -k2,2r | cut -f2-
)

SELECTED_COUNT="$PROTECTED_COUNT"
for name in "${NEWEST_ORDINARY[@]}"; do
  (( SELECTED_COUNT >= TARGET_KEEP )) && break
  day="${RELEASE_DAY[$name]}"
  if [[ "$day" -ge "$CUTOFF" ]]; then
    KEEP_REASON["$name"]="newest within $RETENTION_DAYS-day window"
    SELECTED_COUNT=$((SELECTED_COUNT + 1))
  fi
done

# The age ceiling must never collapse rollback history below MIN_KEEP. If a
# quiet host has too few recent releases, rescue the newest older candidates
# until the minimum rollback floor is satisfied.
if (( SELECTED_COUNT < MIN_KEEP )); then
  for name in "${NEWEST_ORDINARY[@]}"; do
    [[ -n "${KEEP_REASON[$name]:-}" ]] && continue
    KEEP_REASON["$name"]="minimum rollback reserve"
    SELECTED_COUNT=$((SELECTED_COUNT + 1))
    (( SELECTED_COUNT >= MIN_KEEP )) && break
  done
fi

KEEP=()
DELETE=()
CACHE_PRUNE=()
for name in "${VALID[@]}"; do
  reason="${KEEP_REASON[$name]:-}"
  if [[ -n "$reason" ]]; then
    KEEP+=("$name ($reason)")
    if [[ "$name" != "$ACTIVE" ]] &&
       [[ -z "$PREVIOUS" || "$name" != "$PREVIOUS" ]] &&
       ! is_referenced "$name"; then
      cache_path="$RELEASES_ROOT/$name/$BUILD_CACHE_RELATIVE"
      if [[ -d "$cache_path" && ! -L "$cache_path" ]]; then
        CACHE_PRUNE+=("$name")
      fi
    fi
  else
    DELETE+=("$name")
  fi
done

REMAINING="${#KEEP_REASON[@]}"
if (( REMAINING < MIN_KEEP )); then
  die "policy would leave $REMAINING recognized releases (< $MIN_KEEP)"
fi

echo
echo "=== KEEP (${#KEEP[@]})"
for item in "${KEEP[@]}"; do note "keep   $item"; done

echo
echo "=== BUILD CACHE prune candidates (${#CACHE_PRUNE[@]})"
if (( ${#CACHE_PRUNE[@]} == 0 )); then
  note "none"
else
  for name in "${CACHE_PRUNE[@]}"; do
    cache_path="$RELEASES_ROOT/$name/$BUILD_CACHE_RELATIVE"
    cache_size="$(du -sh "$cache_path" 2>/dev/null | awk '{print $1}' || true)"
    printf '  prune  %s/%s%s\n' "$name" "$BUILD_CACHE_RELATIVE" "${cache_size:+ ($cache_size)}"
  done
fi

echo
echo "=== DELETE candidates (${#DELETE[@]})"
if (( ${#DELETE[@]} == 0 )); then
  note "none"
else
  for name in "${DELETE[@]}"; do
    printf '  delete %s\n' "$name"
  done
fi

# Refresh live references immediately before the destructive guard so a release
# that became active/referenced after inventory cannot be removed.
scan_live_references

for name in "${DELETE[@]}"; do
  [[ "$name" =~ $NAME_RE ]] || die "candidate '$name' no longer matches release pattern"
  [[ "$name" != "$ACTIVE" ]] || die "candidate is ACTIVE"
  [[ -z "$PREVIOUS" || "$name" != "$PREVIOUS" ]] || die "candidate is PREVIOUS"
  [[ "$name" != *".."* ]] || die "candidate contains '..'"
  is_referenced "$name" && die "candidate '$name' became referenced"
done

if (( APPLY == 0 )); then
  echo
  echo "DRY RUN — nothing deleted or pruned. Re-run with --apply after reviewing the candidate list."
  exit 0
fi

# Build caches are not part of the runtime rollback artifact. Prune only from
# recognized, retained, non-pinned releases that still have no live reference
# at the moment of deletion.
for name in "${CACHE_PRUNE[@]}"; do
  [[ "$name" =~ $NAME_RE ]] || die "cache candidate '$name' no longer matches release pattern"
  [[ "$name" != "$ACTIVE" ]] || die "cache candidate is ACTIVE"
  [[ -z "$PREVIOUS" || "$name" != "$PREVIOUS" ]] || die "cache candidate is PREVIOUS"
  if is_referenced "$name"; then
    note "skipped cache prune for $name (became REFERENCED)"
    continue
  fi

  cache_path="$RELEASES_ROOT/$name/$BUILD_CACHE_RELATIVE"
  case "$cache_path" in
    "$RELEASES_ROOT/$name/"*) : ;;
    *) die "cache candidate escapes release directory: $cache_path" ;;
  esac
  if [[ -d "$cache_path" && ! -L "$cache_path" ]]; then
    rm -rf -- "$cache_path"
    note "pruned $name/$BUILD_CACHE_RELATIVE"
  fi
done

for name in "${DELETE[@]}"; do
  rm -rf -- "$RELEASES_ROOT/$name"
  note "deleted $name"
done

echo
df -Ph "$RELEASES_ROOT" | tail -1 | awk '{printf "  disk after    : %s used, %s free (%s)\n", $3, $4, $5}'
note "retained recognized releases: $REMAINING"
