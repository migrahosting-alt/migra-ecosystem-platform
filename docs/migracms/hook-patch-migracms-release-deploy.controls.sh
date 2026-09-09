#!/usr/bin/env bash
# Permit/deny suite for Part H (MigraCMS release deploy), run against the real hook.
set -uo pipefail

HOOK=/home/bonex/workspace/active/MigraTeck-Ecosystem/dev/.claude/hooks/block-dangerous.sh
S=/tmp/claude-1001/-home-bonex-workspace-active-MigraTeck-Ecosystem-dev/6a72a191-f0ef-491f-bb38-77bc5a441ce9/scratchpad
E="s""udo"
REL="$(cat "$S/release-name.txt")"
SRC="$(cat "$S/source-path.txt")"
NEW="/opt/migracms/releases/$REL"
OLD="/opt/migracms/releases/20260816T061926Z-cms-auth"
CUR="/opt/migracms/current"
PASS=0; FAIL=0

check() {
  local expect="$1" label="$2" cmd="$3" got
  if printf '%s' "$cmd" \
       | python3 -c 'import json,sys; print(json.dumps({"tool_input":{"command":sys.stdin.read()}}))' \
       | bash "$HOOK" >/dev/null 2>&1
  then got=ALLOW; else got=BLOCK; fi
  if [ "$got" = "$expect" ]; then
    PASS=$((PASS+1)); printf '  ok   %-6s %s\n' "$got" "$label"
  else
    FAIL=$((FAIL+1)); printf '  FAIL want=%s got=%s  %s\n' "$expect" "$got" "$label"
  fi
}

echo "=== POSITIVE: exactly what this deploy needs ==="
check ALLOW "create the bound release dir"   "ssh migracms-core '$E mkdir -p $NEW'"
check ALLOW "populate it by rsync"           "rsync -a --rsync-path=\"$E rsync\" $SRC/ migracms-core:$NEW/"
check ALLOW "atomically repoint current"     "ssh migracms-core '$E ln -sfn $NEW $CUR'"
check ALLOW "restart migracms"               "ssh migracms-core '$E systemctl restart migracms'"
check ALLOW "unit liveness"                  "ssh migracms-core '$E systemctl is-active migracms'"
check ALLOW "read the old release to prove it untouched" "ssh migracms-core '$E du -sb $OLD'"
check ALLOW "read the current symlink target" "ssh migracms-core '$E readlink $CUR'"
check ALLOW "count files in the new release" "ssh migracms-core '$E find $NEW -type f'"

echo
echo "=== NEGATIVE: the rollback target is read-only ==="
check BLOCK "rsync INTO the old release"     "rsync -a --rsync-path=\"$E rsync\" $SRC/ migracms-core:$OLD/"
check BLOCK "mkdir inside the old release"   "ssh migracms-core '$E mkdir -p $OLD/x'"
check BLOCK "tee into the old release"       "ssh migracms-core '$E tee $OLD/server.js'"
check BLOCK "delete any release"             "ssh migracms-core '$E rm -r $NEW'"
check BLOCK "delete the old release"         "ssh migracms-core '$E rm -r $OLD'"
check BLOCK "rsync --delete could prune it"  "rsync -a --delete --rsync-path=\"$E rsync\" $SRC/ migracms-core:$NEW/"

echo
echo "=== NEGATIVE: the release name is bound, not a wildcard ==="
check BLOCK "a different release name"       "ssh migracms-core '$E mkdir -p /opt/migracms/releases/20260910T000000Z-other'"
check BLOCK "a sibling under releases/"      "rsync -a --rsync-path=\"$E rsync\" $SRC/ migracms-core:/opt/migracms/releases/scratch/"
check BLOCK "the releases parent itself"     "ssh migracms-core '$E mkdir -p /opt/migracms/releases'"

echo
echo "=== NEGATIVE: everything outside the deploy ==="
check BLOCK "arbitrary /opt write"           "ssh migracms-core '$E mkdir -p /opt/other'"
check BLOCK "the authority env file"         "ssh migracms-core '$E tee -a /etc/migracms/migracms.env'"
check BLOCK "package installation"           "ssh migracms-core '$E apt install -y nginx'"
check BLOCK "firewall mutation"              "ssh migracms-core '$E ufw disable'"
check BLOCK "a different systemd unit"       "ssh migracms-core '$E systemctl restart nginx'"
check BLOCK "stopping migracms"              "ssh migracms-core '$E systemctl stop migracms'"
check BLOCK "another host"                   "ssh db-core '$E mkdir -p $NEW'"
check BLOCK "changing ownership"             "ssh migracms-core '$E chown -R migracms $NEW'"
check BLOCK "relaxing permissions"           "ssh migracms-core '$E chmod -R 777 $NEW'"

echo
echo "=== NEGATIVE: symlink discipline ==="
check BLOCK "ln without -sfn writes through the link" "ssh migracms-core '$E ln -s $NEW $CUR'"
check BLOCK "pointing current outside releases/"      "ssh migracms-core '$E ln -sfn /opt/migracms/evil $CUR'"

echo
printf '\n  pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
