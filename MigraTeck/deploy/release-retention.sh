#!/usr/bin/env bash
set -euo pipefail

HOST_LABEL="${HOST_LABEL:-$(hostname)}"
RELEASES_ROOT="${RELEASES_ROOT:-/opt/migra/releases/migrateck}"
ACTIVE_LINK="${ACTIVE_LINK:-/opt/migra/apps/migrateck/current}"
PREVIOUS_LINK="${PREVIOUS_LINK:-/opt/migra/apps/migrateck/previous}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MIN_KEEP="${MIN_KEEP:-4}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

NAME_RE='^([0-9]{8})(T[0-9]{6}Z)?-.+$'

die() { echo "ABORT: $*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }

[[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "RETENTION_DAYS must be numeric"
[[ "$MIN_KEEP" =~ ^[0-9]+$ ]] || die "MIN_KEEP must be numeric"
(( RETENTION_DAYS >= 1 )) || die "RETENTION_DAYS must be at least 1"
(( MIN_KEEP >= 2 )) || die "MIN_KEEP must be at least 2"

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
note "policy        : keep pinned + releases newer than $RETENTION_DAYS days + minimum $MIN_KEEP"
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

KEEP=()
DELETE=()
for name in "${VALID[@]}"; do
  day="${RELEASE_DAY[$name]}"
  if [[ "$name" == "$ACTIVE" ]]; then
    KEEP+=("$name (ACTIVE)")
  elif [[ -n "$PREVIOUS" && "$name" == "$PREVIOUS" ]]; then
    KEEP+=("$name (PREVIOUS)")
  elif [[ "$day" -ge "$CUTOFF" ]]; then
    KEEP+=("$name (inside $RETENTION_DAYS-day window)")
  elif is_referenced "$name"; then
    KEEP+=("$name (REFERENCED)")
  else
    DELETE+=("$name")
  fi
done

REMAINING=$(( ${#VALID[@]} - ${#DELETE[@]} ))
if (( REMAINING < MIN_KEEP )); then
  die "policy would leave $REMAINING recognized releases (< $MIN_KEEP)"
fi

echo
echo "=== KEEP (${#KEEP[@]})"
for item in "${KEEP[@]}"; do note "keep   $item"; done

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
  [[ "${RELEASE_DAY[$name]}" -lt "$CUTOFF" ]] || die "candidate '$name' is inside retention window"
  is_referenced "$name" && die "candidate '$name' became referenced"
done

if (( APPLY == 0 )); then
  echo
  echo "DRY RUN — nothing deleted. Re-run with --apply after reviewing the candidate list."
  exit 0
fi

for name in "${DELETE[@]}"; do
  rm -rf -- "$RELEASES_ROOT/$name"
  note "deleted $name"
done

echo
df -Ph "$RELEASES_ROOT" | tail -1 | awk '{printf "  disk after    : %s used, %s free (%s)\n", $3, $4, $5}'
note "retained recognized releases: $REMAINING"
