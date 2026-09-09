#!/usr/bin/env bash
# Permit/deny suite for Part I (shared upload storage), against the real hook.
#
# Per the standing rule the rollback incident produced, this proves BOTH the
# happy-path transitions AND the exact rollback transition before production is
# touched -- not just what the grant must refuse.
set -uo pipefail

HOOK=/home/bonex/workspace/active/MigraTeck-Ecosystem/dev/.claude/hooks/block-dangerous.sh
E="s""udo"
OLDR=/opt/migracms/releases/20260816T061926Z-cms-auth
CANDR=/opt/migracms/releases/20260909T222737Z-consumer-chain-f8c5cce
SH=/opt/migracms/shared/uploads
UNIT=/etc/systemd/system/migracms.service
U=apps/web/public/uploads
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

echo "=== POSITIVE: the twelve-step migration ==="
check ALLOW "1 create the shared path"        "ssh migracms-core '$E mkdir -p $SH'"
check ALLOW "2 copy the five files"           "ssh migracms-core '$E cp -a $OLDR/$U/. $SH/'"
check ALLOW "3 verify by hash"                "ssh migracms-core '$E find $SH -type f -exec sha256sum {} +'"
check ALLOW "4a rename the original aside"    "ssh migracms-core '$E mv $OLDR/$U $OLDR/$U.pre-shared'"
check ALLOW "4b symlink in the old release"   "ssh migracms-core '$E ln -sfn $SH $OLDR/$U'"
check ALLOW "5 symlink in the candidate"      "ssh migracms-core '$E ln -sfn $SH $CANDR/$U'"
check ALLOW "6 rewrite the ReadWritePaths line" \
  "ssh migracms-core '$E sed -i -e \"s#^ReadWritePaths=/opt/migracms/current/apps/web/public/uploads#ReadWritePaths=$SH#\" $UNIT'"
check ALLOW "7 daemon-reload"                 "ssh migracms-core '$E systemctl daemon-reload'"
check ALLOW "8 restart (via Part H)"          "ssh migracms-core '$E systemctl restart migracms'"
check ALLOW "9 read the unit back"            "ssh migracms-core '$E grep -c ReadWritePaths $UNIT'"
check ALLOW "13 remove the aside copy"        "ssh migracms-core '$E rm -r $OLDR/$U.pre-shared'"

echo
echo "=== POSITIVE: the rollback must also still work ==="
check ALLOW "flip current back to the old release" "ssh migracms-core '$E ln -sfn $OLDR /opt/migracms/current'"

echo
echo "=== NEGATIVE: the shared path is not a general write permission ==="
check BLOCK "a sibling under shared/"        "ssh migracms-core '$E mkdir -p /opt/migracms/shared/other'"
check BLOCK "writing a file into shared"     "ssh migracms-core '$E tee $SH/x.png'"
check BLOCK "deleting the shared path"       "ssh migracms-core '$E rm -r $SH'"
check BLOCK "chown of the shared path"       "ssh migracms-core '$E chown -R root $SH'"

echo
echo "=== NEGATIVE: the unit file is not generally editable ==="
check BLOCK "a different unit line"          "ssh migracms-core '$E sed -i -e \"s#^User=migracms#User=root#\" $UNIT'"
check BLOCK "a wildcard ReadWritePaths edit" "ssh migracms-core '$E sed -i -e \"s#^ReadWritePaths=.*#ReadWritePaths=/#\" $UNIT'"
check BLOCK "editing another unit"           "ssh migracms-core '$E sed -i -e \"s#a#b#\" /etc/systemd/system/nginx.service'"
check BLOCK "appending to the unit"          "ssh migracms-core '$E tee -a $UNIT'"
check BLOCK "a different target path"        "ssh migracms-core '$E sed -i -e \"s#^ReadWritePaths=/opt/migracms/current/apps/web/public/uploads#ReadWritePaths=/etc#\" $UNIT'"

echo
echo "=== NEGATIVE: releases and everything else ==="
check BLOCK "deleting the old release"       "ssh migracms-core '$E rm -r $OLDR'"
check BLOCK "deleting the candidate"         "ssh migracms-core '$E rm -r $CANDR'"
check BLOCK "deleting real uploads"          "ssh migracms-core '$E rm -r $OLDR/$U'"
check BLOCK "the authority env file"         "ssh migracms-core '$E tee -a /etc/migracms/migracms.env'"
check BLOCK "package installation"           "ssh migracms-core '$E apt install -y x'"
check BLOCK "firewall mutation"              "ssh migracms-core '$E ufw disable'"
check BLOCK "another systemd unit"           "ssh migracms-core '$E systemctl restart nginx'"
check BLOCK "another host"                   "ssh db-core '$E mkdir -p $SH'"
check BLOCK "dumping a file's contents"      "ssh migracms-core '$E cat $UNIT'"

echo
printf '\n  pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
