#!/usr/bin/env bash
# Durable Claude guard bootstrap (Operational Readiness Slice 1).
#
# The PreToolUse guard (.claude/hooks/block-dangerous.sh) and .claude/settings.json
# are ignore-by-default local files — they silently disappear on checkout, clone,
# worktree recreation, or environment reset. This installs the guard from a
# VERSION-CONTROLLED canonical source and verifies it, FAILING CLOSED if the
# guard is missing, tampered, unregistered, or its allow/deny policy regresses.
#
# Usage:
#   scripts/dev/install-claude-guards.sh            # install (copy) then verify
#   scripts/dev/install-claude-guards.sh --verify   # verify only (no copy)
#
# Exit non-zero on ANY incomplete/incorrect state so callers (CI, post-checkout,
# npm scripts) treat a broken guard as a hard failure.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CANONICAL="$REPO_ROOT/tooling/claude/block-dangerous.sh"
INSTALLED="$REPO_ROOT/.claude/hooks/block-dangerous.sh"
SETTINGS="$REPO_ROOT/.claude/settings.json"

MODE="install"
[[ "${1:-}" == "--verify" ]] && MODE="verify"

fail() {
  echo "GUARD-INSTALL FAIL: $1" >&2
  exit 1
}
ok() { echo "  ok: $1"; }

sha() { sha256sum "$1" | cut -d' ' -f1; }

# ── 1. canonical source must exist ──────────────────────────────────────────────
[[ -f "$CANONICAL" ]] || fail "canonical guard missing: $CANONICAL"

# ── 2. install (copy + exec bit), unless verify-only ────────────────────────────
if [[ "$MODE" == "install" ]]; then
  mkdir -p "$(dirname "$INSTALLED")"
  cp "$CANONICAL" "$INSTALLED"
  chmod +x "$INSTALLED"
  ok "installed guard → $INSTALLED"
fi

# ── 3. installed guard must exist, be executable, and match the canonical hash ──
[[ -f "$INSTALLED" ]] || fail "installed guard missing: $INSTALLED (run without --verify to install)"
[[ -x "$INSTALLED" ]] || fail "installed guard is not executable: $INSTALLED"
[[ "$(sha "$CANONICAL")" == "$(sha "$INSTALLED")" ]] || fail "installed guard content differs from canonical (tampered or stale)"
ok "checksum matches canonical"

# ── 4. PreToolUse registration must reference the guard ─────────────────────────
[[ -f "$SETTINGS" ]] || fail "settings missing: $SETTINGS"
command -v jq >/dev/null 2>&1 || fail "jq is required to verify the PreToolUse registration"
REG="$(jq -r '.hooks.PreToolUse[]? | select(.matcher=="Bash") | .hooks[]? | select(.type=="command") | .command' "$SETTINGS" 2>/dev/null || true)"
echo "$REG" | grep -q "block-dangerous.sh" || fail "no PreToolUse/Bash registration references block-dangerous.sh in settings.json"
ok "PreToolUse registration present"

# ── 5. run the full allow/deny policy matrix against the INSTALLED guard ─────────
# Each case: a command payload + expected verdict (allow=exit0, block=exit!=0).
run_case() {
  local desc="$1" cmd="$2" expect="$3"
  local verdict
  if printf '{"tool_input":{"command":%s}}' "$(jq -Rn --arg c "$cmd" '$c')" | bash "$INSTALLED" >/dev/null 2>&1; then
    verdict="allow"
  else
    verdict="block"
  fi
  [[ "$verdict" == "$expect" ]] || fail "policy matrix: '$desc' expected $expect, got $verdict"
  ok "policy: $desc → $verdict"
}

# argv[0] split so this script's own text never contains the literal patterns.
PUSH="git pu""sh"
run_case "upstream origin push (intended)" "$PUSH -u origin my-branch" "allow"
run_case "benign command"                   "ls -la"                     "allow"
run_case "force push"                        "$PUSH --force origin main"  "block"
run_case "delete-refspec push"               "$PUSH origin :dead"         "block"
run_case "non-origin remote push"            "$PUSH core main"            "block"
run_case "mirror push"                        "$PUSH --mirror origin"      "block"
run_case "rm -rf"                            "rm -r""f /tmp/x"            "block"
run_case "sudo"                              "su""do systemctl restart x" "block"

echo "GUARD-INSTALL OK: guard installed, checksum-verified, registered, and policy matrix green ($MODE)."
