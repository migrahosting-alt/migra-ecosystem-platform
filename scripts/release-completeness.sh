#!/usr/bin/env bash
#
# WHAT MAKES A RELEASE DIRECTORY ABLE TO SERVE — DEFINED ONCE.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 WHY THIS IS ITS OWN FILE
#
# The same question — "could this release actually boot?" — was being answered
# in three places with three different answers:
#
#   deploy-consumer.sh   .next + node_modules/next/dist/bin/next + package.json
#   deploy-brain.sh      dist/src/server.js + node_modules + package.json
#   release-retention.sh node_modules
#
# Three definitions of one fact is how the `exitprobe` incident became possible
# in the first place: an aborted deploy left a directory that every one of those
# checks would have judged differently, and the one that mattered — retention's —
# did not exist yet.
#
# The release FORMAT will change. A fully bundled standalone artifact would not
# carry node_modules at all, and on that day the predicate must move in one
# place rather than be rediscovered as folklore in whichever script happens to
# break first.
#
# ─────────────────────────────────────────────────────────────────────────────
# THE TWO CONSUMERS, AND WHY THE SHAPE IS AWKWARD
#
# `release-retention.sh` runs ON the release host and asks about LOCAL paths.
# The deploy scripts run on the workstation and ask about REMOTE paths over ssh.
# So this file exposes the predicate twice:
#
#   release_is_complete <dir>            local test, returns 0/1
#   release_completeness_test <dir>      prints a shell expression to run elsewhere
#
# Both are generated from ONE table, so they cannot disagree.

# ─────────────────────────────────────────────────────────────────────────────
# THE TABLE. Everything below is derived from it.
#
# Each entry is: <kind>|<marker that identifies the kind>|<required paths…>
# The marker is what says "this is a consumer release" without being told.
#
# 🚨 `node_modules` IS THE COMMON FLOOR, not the whole definition. It is the one
# requirement both app shapes share today, and it is what the `unknown` rule
# falls back to when a directory cannot be identified — deliberately the most
# permissive rule, because a false negative DELETES something.
RELEASE_SHAPES=(
  "consumer|d:.next|d:.next|f:node_modules/next/dist/bin/next|f:package.json|d:node_modules"
  "brain|f:dist/src/server.js|f:dist/src/server.js|d:node_modules|f:package.json"
  "unknown||d:node_modules"
)

# shellcheck: the loop below reads the table; nothing else may.
_release_shape_fields() {
  local kind="$1" row
  for row in "${RELEASE_SHAPES[@]}"; do
    [ "${row%%|*}" = "$kind" ] || continue
    printf '%s' "${row#*|*|}"
    return 0
  done
  return 1
}

# Which app a release directory belongs to, decided by its own contents.
#
# Never by name: release directories are named by the operator and a name has
# never been evidence of anything.
release_kind() {
  local dir="$1" row kind marker
  for row in "${RELEASE_SHAPES[@]}"; do
    kind="${row%%|*}"
    marker="${row#*|}"; marker="${marker%%|*}"
    [ -n "$marker" ] || continue
    case "$marker" in
      d:*) [ -d "$dir/${marker#d:}" ] && { printf '%s' "$kind"; return 0; } ;;
      f:*) [ -f "$dir/${marker#f:}" ] && { printf '%s' "$kind"; return 0; } ;;
    esac
  done
  printf 'unknown'
}

# Can this LOCAL directory serve? Used by retention, on the release host.
release_is_complete() {
  local dir="$1" kind fields field
  [ -d "$dir" ] || return 1
  kind="$(release_kind "$dir")"
  fields="$(_release_shape_fields "$kind")" || return 1
  local IFS='|'
  for field in $fields; do
    case "$field" in
      d:*) [ -d "$dir/${field#d:}" ] || return 1 ;;
      f:*) [ -f "$dir/${field#f:}" ] || return 1 ;;
    esac
  done
  return 0
}

# The same predicate as a shell expression, for asking about a REMOTE path.
#
# The deploy scripts know which app they are, so the kind is passed rather than
# detected — they are validating a rollback target for a specific service.
release_completeness_test() {
  local kind="$1" dir="$2" fields field out=""
  fields="$(_release_shape_fields "$kind")" || return 1
  local IFS='|'
  for field in $fields; do
    case "$field" in
      d:*) out="${out}${out:+ && }test -d '$dir/${field#d:}'" ;;
      f:*) out="${out}${out:+ && }test -f '$dir/${field#f:}'" ;;
    esac
  done
  printf "test -d '%s' && %s" "$dir" "$out"
}

# Every requirement for a kind, for an operator reading a failure message.
release_requirements() {
  local fields; fields="$(_release_shape_fields "$1")" || return 1
  printf '%s' "$(printf '%s' "$fields" | tr '|' ' ' | sed 's/[df]://g')"
}
