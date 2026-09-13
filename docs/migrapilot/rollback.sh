#!/usr/bin/env bash
#
# Roll a MigraPilot service back to its recorded previous release — coherently.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 WHY THIS EXISTS
#
# There was no rollback COMMAND. There was a line the deploy scripts PRINT:
#
#   ssh $HOST "sudo ln -sfn $PREVIOUS $ROOT/current && sudo systemctl restart $UNIT"
#
# It flips `current` and never touches `previous`. Once `previous` became a
# durable recorded pointer rather than a guess, that line stopped being correct:
# run it and `current` and `previous` both name the same release, so
#
#   · there is no way back from the way back — rolling forward again is not
#     expressible through the pointers;
#   · retention sees rollback == active, and the release that ought to hold the
#     rollback slot is demoted to an ordinary spare.
#
# A rollback that leaves the pointers incoherent is not a rollback, it is a
# symlink swap that happens to work once.
#
# ─────────────────────────────────────────────────────────────────────────────
# WHAT IT GUARANTEES
#
#   · the destination is COMPLETE — checked with the same shared predicate the
#     deploy scripts and retention use, never a directory-exists test
#   · the release being LEFT is complete too, because it becomes the new
#     `previous` and an unbootable rollback target is the defect being fixed
#   · `current` and `previous` are swapped TOGETHER, so the operation is its own
#     inverse: running it twice returns to where you started
#   · the RUNNING PROCESS is asked what it serves afterwards — the same last
#     link the deploy scripts assert, and the only one that cannot be faked
#
#   usage:  rollback.sh --target <production|staging> --app <consumer|brain>
#                       [--to <release>] [--apply]
#
#   Prints a plan and changes nothing without --apply.
#
set -euo pipefail

TARGET=""; APP=""; TO=""; APPLY=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --app) APP="${2:-}"; shift 2 ;;
    --app=*) APP="${1#*=}"; shift ;;
    --to) TO="${2:-}"; shift 2 ;;
    --to=*) TO="${1#*=}"; shift ;;
    --apply) APPLY=1; shift ;;
    *) echo "usage: rollback.sh --target <production|staging> --app <consumer|brain> [--to <release>] [--apply]" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && cd .. && pwd)"
# shellcheck source=./deploy-targets.sh
. "$HERE/deploy-targets.sh"
deploy_target "$TARGET" || exit 2
# shellcheck source=../../scripts/release-completeness.sh
. "$REPO/scripts/release-completeness.sh"

case "$APP" in
  consumer)
    ROOT="$DEPLOY_CONSUMER_ROOT"; UNIT="$DEPLOY_CONSUMER_UNIT"
    BIND="$DEPLOY_CONSUMER_BIND"; PORT="$DEPLOY_CONSUMER_PORT"; KIND=consumer ;;
  brain)
    ROOT="$DEPLOY_BRAIN_ROOT";    UNIT="$DEPLOY_BRAIN_UNIT"
    BIND="$DEPLOY_BRAIN_BIND";    PORT="$DEPLOY_BRAIN_PORT";    KIND=brain ;;
  *) echo "rollback: --app must be 'consumer' or 'brain'" >&2; exit 2 ;;
esac
HOST="$DEPLOY_HOST"

step() { printf '\n== %s\n' "$1"; }
fail() { printf '\nROLLBACK ABORTED: %s\n' "$1" >&2; exit 1; }

printf '\n== rolling back %s on %s (%s)\n' "$APP" "$DEPLOY_TARGET_NAME" "$HOST"

# ── 1. where we are ────────────────────────────────────────────────────────
step "1. current pointers"
CURRENT="$(ssh -n "$HOST" "readlink $ROOT/current" 2>/dev/null || true)"
PREVIOUS="$(ssh -n "$HOST" "readlink $ROOT/previous" 2>/dev/null || true)"
[ -n "$CURRENT" ] || fail "$ROOT/current is not a symlink — refusing to guess what is serving"
echo "   current  -> $CURRENT"
echo "   previous -> ${PREVIOUS:-NONE}"

DEST="${TO:+$ROOT/releases/$TO}"
if [ -z "$DEST" ]; then
  [ -n "$PREVIOUS" ] \
    || fail "no recorded rollback target. $ROOT/previous does not exist, and this script will not
   infer one from directory age — recency is not proof that a release can serve.
   Name one explicitly with --to <release> once you have checked it."
  DEST="$PREVIOUS"
fi

[ "$DEST" = "$CURRENT" ] \
  && fail "$(basename "$DEST") is already serving. Nothing to roll back to."

# ── 2. both ends must be able to serve ─────────────────────────────────────
step "2. both releases can serve"
# The destination, obviously. But ALSO the one being left: it becomes the new
# `previous`, and recording an unbootable rollback target is the whole defect.
for R in "$DEST" "$CURRENT"; do
  OK="$(ssh -n "$HOST" "$(release_completeness_test "$KIND" "$R") && echo yes || echo no")"
  [ "$OK" = "yes" ] \
    || fail "$(basename "$R") cannot serve — a $KIND release needs $(release_requirements "$KIND")"
  echo "   ✓ $(basename "$R")"
done

# ── 3. the plan ────────────────────────────────────────────────────────────
step "3. plan"
echo "   current  $(basename "$CURRENT")  ->  $(basename "$DEST")"
echo "   previous $(basename "${PREVIOUS:-none}")  ->  $(basename "$CURRENT")"
echo "   restart  $UNIT"

if [ "$APPLY" -ne 1 ]; then
  printf '\nREPORT ONLY — nothing was changed. Re-run with --apply to act on this plan.\n'
  exit 0
fi

# ── 4. swap BOTH pointers, then restart ────────────────────────────────────
step "4. swapping pointers"
# 🚨 TOGETHER, AND `previous` FIRST.
#
# If the run dies between the two, having written `previous` first leaves
# current=old, previous=old — visibly wrong and harmless, because what is
# SERVING has not moved. The other order leaves current=new, previous=new: the
# service has moved and the way back has been erased.
ssh -n "$HOST" "sudo ln -sfn $CURRENT $ROOT/previous"
ssh -n "$HOST" "sudo ln -sfn $DEST $ROOT/current"
echo "   current  -> $(ssh -n "$HOST" "readlink $ROOT/current")"
echo "   previous -> $(ssh -n "$HOST" "readlink $ROOT/previous")"

step "5. restarting $UNIT"
ssh -n "$HOST" "sudo systemctl restart $UNIT && sleep 6 && systemctl is-active $UNIT"

# ── 6. ask the running process what it serves ──────────────────────────────
step "6. THE RUNNING PROCESS REPORTS THE ROLLED-BACK RELEASE"
# Same discipline as the deploy scripts: retry, and never translate "I could not
# reach it" into "it is serving the wrong thing".
REL="$(basename "$DEST")"
RUNNING=""
for attempt in 1 2 3 4 5; do
  RUNNING="$(ssh -n -o ConnectTimeout=15 "$HOST" "curl -s --max-time 8 http://$BIND:$PORT/api/version" 2>/dev/null || true)"
  [ -n "$RUNNING" ] && break
  echo "   attempt $attempt: no answer yet, retrying…"
  sleep 5
done
[ -n "$RUNNING" ] || fail "COULD NOT VERIFY what $DEPLOY_TARGET_NAME is serving after the swap.
   This is NOT evidence of a bad rollback: the symlinks were swapped and the unit restarted.
   Check it yourself before deciding anything:
     ssh $HOST \"curl -s http://$BIND:$PORT/api/version\"
   Expected release: $REL"

echo "   $RUNNING"
echo "$RUNNING" | grep -q "\"release\":\"$REL\"" \
  || fail "the running service does NOT report $REL. Investigate before touching anything else."

UP="$(printf '%s' "$DEPLOY_TARGET_NAME" | tr '[:lower:]' '[:upper:]')"
cat <<DONE

ROLLED BACK — and proven, link by link:
  $UP $APP
  current   -> $REL
  previous  -> $(basename "$CURRENT")
  restarted $UNIT
  RUNNING PROCESS reports release $REL

to reverse this, run the same command again:
  $0 --target $DEPLOY_TARGET_NAME --app $APP --apply

NOT ACCEPTED. This proves what is RUNNING; it does not prove the product is correct.
DONE
