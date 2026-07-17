#!/usr/bin/env bash
set -euo pipefail

INPUT="$(cat)"

# Inspect ONLY the command being run — not the whole hook JSON, whose
# human-readable description field would false-positive (e.g. a grep whose
# description merely mentions "git push"). Falls back to the raw input when jq
# is unavailable or the command field is empty.
CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$CMD" ] || CMD="$INPUT"

block() {
  echo "Blocked dangerous command ($1). Ask Bonex for explicit approval." >&2
  exit 2
}

# Always-blocked patterns.
case "$CMD" in
  *"rm -rf"*) block "rm -rf" ;;
  *"sudo "*) block "sudo" ;;
  *"git reset --hard"*) block "hard reset" ;;
  *"git clean"*) block "git clean" ;;
  *"chmod 777"*) block "chmod 777" ;;
  *"chown "*) block "chown" ;;
esac

# git push policy (Bonex, 2026-07-16): plain pushes to ORIGIN are allowed;
# force/delete/mirror pushes and pushes to any other remote (e.g. the on-host
# `core` remote) remain blocked.
if [[ "$CMD" == *"git push"* ]]; then
  case "$CMD" in
    *"push --force"*|*"push -f"*|*"--force-with-lease"*|*"--delete"*|*"--mirror"*|*"origin +"*|*"push origin :"*)
      block "force/delete push" ;;
  esac
  if [[ "$CMD" != *"git push -u origin "* && "$CMD" != *"git push origin "* ]]; then
    block "push to a non-origin remote or ambiguous target"
  fi
fi

exit 0
