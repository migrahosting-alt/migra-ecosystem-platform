#!/usr/bin/env bash
### Add VM 111 to the `migra-nightly` backup job — smallest possible change.
###
### DRY-RUN BY DEFAULT.  Execute with:  CONFIRM=yes bash add-111-to-backup.sh
###
### /etc/pve/jobs.cfg is shared cluster configuration covering every backed-up
### guest, so this script never hand-edits the file. It reads the authoritative
### list from the API, appends one id, writes it back through the API (which
### validates), and re-reads to prove nothing else moved.
set -euo pipefail

JOB="migra-nightly"
NEW_ID="111"
CONFIRM="${CONFIRM:-no}"

api_get() { pvesh get "/cluster/backup/${JOB}" --output-format json 2>/dev/null; }
field() { api_get | python3 -c "import sys,json; print(json.load(sys.stdin).get('$1',''))"; }

BEFORE_VMID="$(field vmid)"
BEFORE_PRUNE="$(api_get | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('prune-backups',{}),sort_keys=True))")"
BEFORE_SCHED="$(field schedule)"
BEFORE_STORAGE="$(field storage)"
BEFORE_MODE="$(field mode)"
BEFORE_ENABLED="$(field enabled)"

[ -n "$BEFORE_VMID" ] || { echo "ERROR: could not read job $JOB" >&2; exit 1; }

echo "── BEFORE ─────────────────────────────────────────────────────"
echo "vmid    : $BEFORE_VMID"
echo "schedule: $BEFORE_SCHED   storage: $BEFORE_STORAGE   mode: $BEFORE_MODE   enabled: $BEFORE_ENABLED"
echo "prune   : $BEFORE_PRUNE"

if echo ",$BEFORE_VMID," | grep -q ",${NEW_ID},"; then
  echo
  echo "$NEW_ID is already present. Nothing to do."
  exit 0
fi

# Append, then sort numerically so the list keeps its existing ordering style.
AFTER_VMID="$(printf '%s\n%s\n' "${BEFORE_VMID//,/$'\n'}" "$NEW_ID" | grep -v '^$' | sort -n -u | paste -sd,)"

echo
echo "── PROPOSED ───────────────────────────────────────────────────"
echo "vmid    : $AFTER_VMID"
echo "delta   : +$NEW_ID  (count $(echo "$BEFORE_VMID" | tr ',' '\n' | wc -l) -> $(echo "$AFTER_VMID" | tr ',' '\n' | wc -l))"
echo "Only the vmid list is sent; schedule/storage/mode/prune are untouched."

if [ "$CONFIRM" != "yes" ]; then
  echo
  echo "DRY RUN — nothing changed. Re-run with CONFIRM=yes to apply."
  exit 0
fi

echo
echo "── APPLYING ───────────────────────────────────────────────────"
pvesh set "/cluster/backup/${JOB}" --vmid "$AFTER_VMID"

echo
echo "── AFTER (re-read from API) ───────────────────────────────────"
AFTER_READ_VMID="$(field vmid)"
AFTER_READ_PRUNE="$(api_get | python3 -c "import sys,json; print(json.dumps(json.load(sys.stdin).get('prune-backups',{}),sort_keys=True))")"
echo "vmid    : $AFTER_READ_VMID"
echo "schedule: $(field schedule)   storage: $(field storage)   mode: $(field mode)   enabled: $(field enabled)"
echo "prune   : $AFTER_READ_PRUNE"

echo
echo "── VERIFICATION ───────────────────────────────────────────────"
fail=0
[ "$AFTER_READ_VMID" = "$AFTER_VMID" ] && echo "  ok  vmid matches intent" || { echo "  FAIL vmid mismatch"; fail=1; }
echo ",$AFTER_READ_VMID," | grep -q ",${NEW_ID}," && echo "  ok  $NEW_ID present" || { echo "  FAIL $NEW_ID absent"; fail=1; }
[ "$AFTER_READ_PRUNE" = "$BEFORE_PRUNE" ] && echo "  ok  retention unchanged" || { echo "  FAIL retention changed"; fail=1; }
[ "$(field schedule)" = "$BEFORE_SCHED" ] && echo "  ok  schedule unchanged" || { echo "  FAIL schedule changed"; fail=1; }
[ "$(field storage)" = "$BEFORE_STORAGE" ] && echo "  ok  storage unchanged" || { echo "  FAIL storage changed"; fail=1; }
[ "$(field enabled)" = "$BEFORE_ENABLED" ] && echo "  ok  enabled unchanged" || { echo "  FAIL enabled changed"; fail=1; }

# Every previously-listed guest must still be listed.
for id in ${BEFORE_VMID//,/ }; do
  echo ",$AFTER_READ_VMID," | grep -q ",${id}," || { echo "  FAIL guest $id was dropped"; fail=1; }
done
[ "$fail" -eq 0 ] && echo "  ok  all $(echo "$BEFORE_VMID" | tr ',' '\n' | wc -l) pre-existing guests retained"

exit "$fail"
