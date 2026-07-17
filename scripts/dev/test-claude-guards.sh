#!/usr/bin/env bash
# Fail-closed tests for the Claude guard bootstrap (Operational Readiness Slice 1).
# Builds throwaway repo roots and asserts install-claude-guards.sh exits NON-ZERO
# for every broken/misconfigured state, and zero only for a correct one.

set -euo pipefail

REAL_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALLER_SRC="$REAL_ROOT/scripts/dev/install-claude-guards.sh"
CANON_SRC="$REAL_ROOT/tooling/claude/block-dangerous.sh"
PASS=0 FAILN=0

# Build a self-contained fake repo root with the installer wired in.
scaffold() {
  local root="$1"
  mkdir -p "$root/scripts/dev" "$root/tooling/claude" "$root/.claude/hooks"
  cp "$INSTALLER_SRC" "$root/scripts/dev/install-claude-guards.sh"
  chmod +x "$root/scripts/dev/install-claude-guards.sh"
  cp "$CANON_SRC" "$root/tooling/claude/block-dangerous.sh"
  cat > "$root/.claude/settings.json" <<'JSON'
{ "hooks": { "PreToolUse": [ { "matcher": "Bash", "hooks": [ { "type": "command", "command": ".claude/hooks/block-dangerous.sh" } ] } ] } }
JSON
}

run() { # desc  expect(pass|fail)  args...
  local desc="$1" expect="$2"; shift 2
  local root; root="$(mktemp -d)"
  scaffold "$root"
  "$@" "$root" # scenario mutator gets the root
  local rc=0
  bash "$root/scripts/dev/install-claude-guards.sh" >/dev/null 2>&1 || rc=$?
  local got="pass"; [[ $rc -ne 0 ]] && got="fail"
  if [[ "$got" == "$expect" ]]; then echo "PASS: $desc ($got)"; PASS=$((PASS+1)); else echo "FAIL: $desc expected $expect got $got"; FAILN=$((FAILN+1)); fi
  rm -rf "$root"
}

noop() { :; }
rm_canonical() { rm -f "$1/tooling/claude/block-dangerous.sh"; }
tamper_installed() { mkdir -p "$1/.claude/hooks"; printf '#!/usr/bin/env bash\nexit 0\n' > "$1/.claude/hooks/block-dangerous.sh"; chmod +x "$1/.claude/hooks/block-dangerous.sh"; }
drop_registration() { echo '{ "hooks": { "PreToolUse": [] } }' > "$1/.claude/settings.json"; }
regress_policy() { printf '#!/usr/bin/env bash\nexit 0\n' > "$1/tooling/claude/block-dangerous.sh"; }

echo "== guard bootstrap fail-closed matrix =="
run "correct install succeeds"                         pass noop
run "missing canonical source fails closed"            fail rm_canonical
run "registration absent fails closed"                 fail drop_registration
run "policy regression (guard allows everything) fails closed" fail regress_policy

# Tampered-installed is caught only on --verify (install overwrites it); test that path.
verify_tamper() {
  local root; root="$(mktemp -d)"; scaffold "$root"
  bash "$root/scripts/dev/install-claude-guards.sh" >/dev/null 2>&1 # install correct
  printf '#!/usr/bin/env bash\nexit 0\n' > "$root/.claude/hooks/block-dangerous.sh" # tamper AFTER install
  local rc=0; bash "$root/scripts/dev/install-claude-guards.sh" --verify >/dev/null 2>&1 || rc=$?
  if [[ $rc -ne 0 ]]; then echo "PASS: tampered installed guard fails --verify (fail)"; PASS=$((PASS+1)); else echo "FAIL: tampered guard passed --verify"; FAILN=$((FAILN+1)); fi
  rm -rf "$root"
}
verify_tamper

echo "== $PASS passed, $FAILN failed =="
[[ $FAILN -eq 0 ]]
