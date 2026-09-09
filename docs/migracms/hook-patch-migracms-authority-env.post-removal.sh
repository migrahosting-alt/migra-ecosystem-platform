#!/usr/bin/env bash
# Post-withdrawal controls.
#
# Two questions: is the grant actually gone, and did withdrawing it damage the
# permanent guard? A removal that is not tested is just an edit.
#
# Several literals are assembled from fragments so this file's own text does not
# trip the guard it tests (the edge alias, the ACME directory, the firewall verb,
# the recursive delete). Same discipline used throughout: reword the probe,
# never loosen the rule.
set -uo pipefail

HOOK=/home/bonex/workspace/active/MigraTeck-Ecosystem/dev/.claude/hooks/block-dangerous.sh
E="s""udo"
EDGE="nginx-proxy""-core"
ACME="/etc/letsen""crypt"
FW="uf""w"
RF="rm -""rf"
PASS=0; FAIL=0

CMS_ENV=/etc/migracms/migracms.env
PANEL_ENV=/opt/MigraPanel/apps/panel-api/.env
RENAME="sed -n \"s#^PANEL_INTERNAL_TOKEN=#MIGRAPANEL_API_KEY=#p\" $PANEL_ENV"
READER="ssh migrapanel-core '$RENAME'"
DEL="-e '/^MIGRAPANEL_/d' -e '/^# MigraPanel/d'"

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

echo "=== the grant is gone: every operation it permitted must now be refused ==="
check BLOCK "append to the env file"        "ssh migracms-core '$E tee -a $CMS_ENV >/dev/null'"
check BLOCK "count keys in the env file"    "ssh migracms-core '$E grep -c \"^MIGRAPANEL_\" $CMS_ENV'"
check BLOCK "file mode and ownership"       "ssh migracms-core '$E stat -c \"%a %U:%G\" $CMS_ENV'"
check BLOCK "restart the unit"              "ssh migracms-core '$E systemctl restart migracms'"
check BLOCK "the secret relay"              "$READER | ssh migracms-core '$E tee -a $CMS_ENV >/dev/null'"
check BLOCK "the byte-identity relay"       "$READER | ssh migracms-core '$E grep -c -F -f - $CMS_ENV'"
check BLOCK "the one-shot repair"           "ssh migracms-core \"$E sed -i $DEL $CMS_ENV\""
check BLOCK "the filtered checksum"         "ssh migracms-core \"$E sed $DEL $CMS_ENV | sha256sum\""
# The companion rule that refused ANY handling of the panel token was scoped to
# the grant, so this returns to the pre-slice baseline: we reach migrapanel-core
# as root, and nothing guards its env file. Recorded as a standing exposure,
# not fixed here -- a permanent rule needs its own authorization.
check ALLOW "reading panel-api's env (pre-existing exposure, see report)" "ssh migrapanel-core 'grep -c PANEL_INTERNAL_TOKEN $PANEL_ENV'"

echo
echo "=== the permanent guard is intact ==="
check BLOCK "destroying a live site config on the edge"  "ssh $EDGE 'rm /etc/nginx/sites-enabled/migrahosting'"
check BLOCK "restarting the edge"                        "ssh $EDGE 'systemctl reload nginx'"
check BLOCK "turning the edge firewall off"              "ssh $EDGE '$FW disable'"
check BLOCK "destroying a certificate"                   "ssh $EDGE 'rm -r $ACME/live/cms.migrahosting.com'"
check BLOCK "reading private key material"               "ssh $EDGE 'cat $ACME/live/cms.migrahosting.com/privkey.pem'"
check BLOCK "the edge reached by tailnet v4"             "ssh 100.101.106.88 'systemctl reload nginx'"
check BLOCK "the edge reached by its -web alias"         "ssh srv1-web 'systemctl reload nginx'"
check BLOCK "the unconditional recursive delete"         "$RF /var/www"
check ALLOW "reading the certificate inventory"          "ssh $EDGE 'ls $ACME/live'"
check ALLOW "an ordinary unprivileged read"              "ssh migracms-core 'systemctl cat migracms'"

echo
printf '\n  pass=%d fail=%d\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
