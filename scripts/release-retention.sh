#!/usr/bin/env bash
#
# Release retention for MigraPilot on VM111.
#
# Enumerates release directories, resolves what is actually IN USE, and prints a
# plan. It deletes nothing unless --apply is passed, and even then only paths it
# has individually proven are unreferenced.
#
# POLICY (conservative, set by Bonex 2026-08-27):
#   keep the active release
#   keep the rollback target
#   keep the 5 most recent additional releases
#   keep anything a running process is using
#   staging trees are kept only while a release operation owns them
#
# 🚨 It never globs. Age orders the candidates; it never selects them. Every
# deletion is by exact resolved path, and every keep-reason is printed so the
# decision can be audited before anything happens.
#
set -euo pipefail

APPLY=0
KEEP_EXTRA=5
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --keep=*) KEEP_EXTRA="${a#--keep=}" ;;
    *) echo "usage: release-retention.sh [--apply] [--keep=N]" >&2; exit 2 ;;
  esac
done

# Every path a running process has open, so a release in use is never a
# candidate however old it looks. Read once: /proc is expensive to walk.
INUSE="$(mktemp)"
trap 'rm -f "$INUSE"' EXIT
{
  for p in /proc/[0-9]*; do
    [ -r "$p/cwd" ] && readlink -f "$p/cwd" 2>/dev/null || true
    [ -r "$p/exe" ] && readlink -f "$p/exe" 2>/dev/null || true
    if [ -r "$p/cmdline" ]; then tr '\0' '\n' < "$p/cmdline" 2>/dev/null || true; fi
  done
} | grep -oE '/opt/migrapilot/[a-z-]+/(releases|staging)/[^/[:space:]]+' | sort -u > "$INUSE" || true

echo "paths currently referenced by a running process:"
if [ -s "$INUSE" ]; then sed 's/^/   /' "$INUSE"; else echo "   (none)"; fi

# 🚨 EVERY `current` SYMLINK UNDER /opt/migrapilot, NOT JUST THIS APP'S.
#
# The canaries live under their own roots and point INTO the main release
# directories: brain-canary/current -> brain-service/releases/bc99059, and
# consumer-canary/current -> consumer/releases/87658f5. Nothing in a per-app
# scan would see that.
#
# They were protected in the first report only because the canary processes
# happened to be RUNNING. Stop a canary for an afternoon and its release becomes
# an ordinary old directory that age-based pruning deletes — and the breakage
# appears later, when someone tries to start it again. A pointer is a
# reservation whether or not anything is currently reading it.
LINKED="$(mktemp)"
trap 'rm -f "$INUSE" "$LINKED"' EXIT
for d in /opt/migrapilot/*/; do
  for link in "$d/current" "$d/previous"; do
    [ -L "$link" ] || continue
    t="$(readlink -f "$link" 2>/dev/null || true)"
    [ -n "$t" ] && echo "$t"
  done
done | sort -u > "$LINKED"

echo "paths referenced by a current/previous symlink anywhere under /opt/migrapilot:"
if [ -s "$LINKED" ]; then sed 's/^/   /' "$LINKED"; else echo "   (none)"; fi

TOTAL_FREED=0

for APP in consumer brain-service; do
  ROOT="/opt/migrapilot/$APP"
  [ -d "$ROOT/releases" ] || continue

  echo
  echo "══ $APP ═══════════════════════════════════════════════════════════"

  ACTIVE="$(readlink -f "$ROOT/current" 2>/dev/null || true)"
  # A durable rollback pointer if one exists; otherwise the most recent release
  # that is not the active one, which is what the release scripts roll back to.
  #
  # 🚨 `readlink -f` RESOLVES A PATH THAT DOES NOT EXIST — it returned
  # "$ROOT/previous" for a missing symlink, so the emptiness test never fired and
  # the real rollback target went unprotected. It survived only because the
  # 5-most-recent rule happened to cover it. Existence is checked first now.
  ROLLBACK=""
  [ -e "$ROOT/previous" ] && ROLLBACK="$(readlink -f "$ROOT/previous")"
  if [ -z "$ROLLBACK" ]; then
    ROLLBACK="$(ls -1dt "$ROOT"/releases/*/ 2>/dev/null \
      | while read -r d; do r="$(readlink -f "$d")"; [ "$r" = "$ACTIVE" ] || { echo "$r"; break; }; done)"
  fi

  echo "  active:   ${ACTIVE:-none}"
  echo "  rollback: ${ROLLBACK:-none}"

  # Newest first. Order only — selection happens against the keep-set below.
  mapfile -t ORDERED < <(ls -1dt "$ROOT"/releases/*/ 2>/dev/null | while read -r d; do readlink -f "$d"; done)

  KEPT=0
  CANDIDATES=()
  for R in "${ORDERED[@]}"; do
    reason=""
    if [ "$R" = "$ACTIVE" ]; then reason="ACTIVE"
    elif [ "$R" = "$ROLLBACK" ]; then reason="ROLLBACK TARGET"
    elif grep -qxF "$R" "$INUSE"; then reason="IN USE by a running process"
    elif grep -qxF "$R" "$LINKED"; then reason="TARGET of a current/previous symlink"
    elif [ "$KEPT" -lt "$KEEP_EXTRA" ]; then reason="within the $KEEP_EXTRA most recent"; KEPT=$((KEPT+1))
    fi
    if [ -n "$reason" ]; then
      printf '  KEEP   %-58s %s\n' "$(basename "$R")" "$reason"
    else
      CANDIDATES+=("$R")
    fi
  done

  if [ "${#CANDIDATES[@]}" -eq 0 ]; then
    echo "  nothing to prune"
  else
    echo "  ${#CANDIDATES[@]} prune candidate(s):"
    for R in "${CANDIDATES[@]}"; do
      sz="$(du -sh "$R" 2>/dev/null | cut -f1)"
      printf '    %-56s %6s\n' "$(basename "$R")" "$sz"
    done
  fi

  # Staging trees: kept only while something is using them.
  if [ -d "$ROOT/staging" ]; then
    STALE=()
    for S in "$ROOT"/staging/*/; do
      [ -d "$S" ] || continue
      SR="$(readlink -f "$S")"
      if grep -qxF "$SR" "$INUSE"; then
        printf '  KEEP   %-58s %s\n' "staging/$(basename "$SR")" "IN USE"
      else
        STALE+=("$SR")
      fi
    done
    if [ "${#STALE[@]}" -gt 0 ]; then
      echo "  ${#STALE[@]} abandoned staging tree(s):"
      for S in "${STALE[@]}"; do
        printf '    %-56s %6s\n' "staging/$(basename "$S")" "$(du -sh "$S" 2>/dev/null | cut -f1)"
      done
      CANDIDATES+=("${STALE[@]}")
    fi
  fi

  if [ "$APPLY" = 1 ] && [ "${#CANDIDATES[@]}" -gt 0 ]; then
    echo "  --- applying ---"
    for R in "${CANDIDATES[@]}"; do
      # Re-proven immediately before deletion, not once at the top: the plan may
      # be minutes old and a deploy could have started in the meantime.
      case "$R" in
        "$ROOT/releases/"*|"$ROOT/staging/"*) : ;;
        *) echo "    REFUSING (outside $ROOT): $R" >&2; continue ;;
      esac
      [ "$R" = "$ACTIVE" ]   && { echo "    REFUSING (active): $R" >&2; continue; }
      [ "$R" = "$ROLLBACK" ] && { echo "    REFUSING (rollback): $R" >&2; continue; }
      grep -qxF "$R" "$INUSE"  && { echo "    REFUSING (in use): $R" >&2; continue; }
      grep -qxF "$R" "$LINKED" && { echo "    REFUSING (symlink target): $R" >&2; continue; }
      if grep -qxF "$R" <<<"$(readlink -f "$ROOT/current")"; then
        echo "    REFUSING (now active): $R" >&2; continue
      fi
      kb="$(du -sk "$R" 2>/dev/null | cut -f1)"
      rm -r "$R"
      TOTAL_FREED=$((TOTAL_FREED + kb))
      echo "    removed $R"
    done
  fi
done

echo
if [ "$APPLY" = 1 ]; then
  echo "freed: $((TOTAL_FREED / 1024)) MiB"
else
  echo "REPORT ONLY — nothing was deleted. Re-run with --apply to act on this plan."
fi
df -h / | tail -1
