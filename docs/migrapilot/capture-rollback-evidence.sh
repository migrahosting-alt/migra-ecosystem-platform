#!/usr/bin/env bash
#
# One snapshot of everything a rollback leg has to be judged on.
#
# Read-only and unprivileged by design: this is the OBSERVER, and it must never
# be able to change what it is observing. Run it before a leg and after it; the
# two outputs side by side are the proof.
#
# 🚨 PRODUCTION IS READ ON EVERY SNAPSHOT, on purpose. "Production was untouched"
# is a claim, and a claim made once at the start of an afternoon is not evidence
# about what happened in the middle of it.
#
#   usage:  capture-rollback-evidence.sh <label>
#
set -uo pipefail
LABEL="${1:-snapshot}"
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=./deploy-targets.sh
. "$HERE/deploy-targets.sh"

printf '\n═══ %s — %s ═══\n' "$LABEL" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"

deploy_target staging >/dev/null || exit 2
SHOST="$DEPLOY_HOST"
SCONSUMER="$DEPLOY_CONSUMER_ROOT"; SCUNIT="$DEPLOY_CONSUMER_UNIT"
SCBIND="$DEPLOY_CONSUMER_BIND";    SCPORT="$DEPLOY_CONSUMER_PORT"
SBRAIN="$DEPLOY_BRAIN_ROOT";       SBUNIT="$DEPLOY_BRAIN_UNIT"
SBBIND="$DEPLOY_BRAIN_BIND";       SBPORT="$DEPLOY_BRAIN_PORT"

printf '\n── staging pointers ───────────────────────────────────────────────\n'
ssh -n -o ConnectTimeout=20 "$SHOST" "
  for pair in 'consumer $SCONSUMER' 'brain-service $SBRAIN'; do
    set -- \$pair
    printf '  %-14s current  -> %s\n' \"\$1\" \"\$(basename \$(readlink \$2/current 2>/dev/null || echo none))\"
    printf '  %-14s previous -> %s\n' ''    \"\$(basename \$(readlink \$2/previous 2>/dev/null || echo NONE))\"
  done" 2>&1 | sed 's/^/  /'

printf '\n── staging: what the RUNNING processes report ─────────────────────\n'
ssh -n -o ConnectTimeout=20 "$SHOST" "
  printf '  consumer HTTP  : %s\n' \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://$SCBIND:$SCPORT/api/version || echo 000)\"
  printf '  consumer /api/version : %s\n' \"\$(curl -s --max-time 8 http://$SCBIND:$SCPORT/api/version || echo '(no answer)')\"
  printf '  brain    HTTP  : %s\n' \"\$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://$SBBIND:$SBPORT/api/version || echo 000)\"
  printf '  brain    /api/version : %s\n' \"\$(curl -s --max-time 8 http://$SBBIND:$SBPORT/api/version || echo '(no answer)')\"
  printf '  brain    /health      : %s\n' \"\$(curl -s --max-time 8 http://$SBBIND:$SBPORT/health | head -c 200 || echo '(no answer)')\"
" 2>&1 | sed 's/^/  /'

printf '\n── staging: service start timestamps ──────────────────────────────\n'
ssh -n -o ConnectTimeout=20 "$SHOST" "
  systemctl show -p ActiveEnterTimestamp --value $SCUNIT | sed 's/^/  consumer : /'
  systemctl show -p ActiveEnterTimestamp --value $SBUNIT | sed 's/^/  brain    : /'
  df -h / | tail -1 | sed 's/^/  disk     : /'
" 2>&1 | sed 's/^/  /'

printf '\n── 🚨 PRODUCTION, which must not move ─────────────────────────────\n'
deploy_target production >/dev/null || exit 2
ssh -n -o ConnectTimeout=20 "$DEPLOY_HOST" "
  printf '  consumer current : %s\n' \"\$(basename \$(readlink $DEPLOY_CONSUMER_ROOT/current))\"
  printf '  brain    current : %s\n' \"\$(basename \$(readlink $DEPLOY_BRAIN_ROOT/current))\"
  printf '  consumer started : %s\n' \"\$(systemctl show -p ActiveEnterTimestamp --value $DEPLOY_CONSUMER_UNIT)\"
  printf '  brain    started : %s\n' \"\$(systemctl show -p ActiveEnterTimestamp --value $DEPLOY_BRAIN_UNIT)\"
" 2>&1 | sed 's/^/  /'
printf '\n'
