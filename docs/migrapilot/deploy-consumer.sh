#!/usr/bin/env bash
#
# Deploy the MigraPilot consumer to VM111, and PROVE which release is serving.
#
# 🚨 WHY THIS EXISTS. The 2026-09-04 identifier-refusal acceptance failure was not
# a code defect. "What is the total ZipCode in this file?" returned 132,737 in the
# real product because production was serving a build from three days earlier — a
# fix that was committed, tested, mutation-proven and pushed was invisible to the
# person testing the product. The validation loop had no assertion that the
# running artifact corresponded to the source being evaluated, so a truthful
# harness still produced a false sense of product readiness.
#
# THE EVIDENCE CHAIN THIS SCRIPT PRODUCES, and refuses to skip a link of:
#
#   expected commit -> built artifact -> boot-tested artifact
#                   -> activated release -> RUNNING PROCESS REPORTS THE SAME ONE
#
# The last link is the one that was missing. It is asserted against /api/version,
# which answers from the artifact itself (Next's per-build BUILD_ID, plus a
# RELEASE.json stamped into `.next` at build time) and never from configuration —
# an environment variable would describe the machine, not the code it runs.
#
# Requires root on VM111 for the release directory and the systemd restart, which
# is inside the owner's bounded VM111 elevation (paths under /opt/migrapilot and
# migrapilot-* units only).
#
#   usage:  docs/migrapilot/deploy-consumer.sh --target <production|staging> <release-name>
#   e.g.    docs/migrapilot/deploy-consumer.sh identifier-09040504
#
set -euo pipefail

# ── the target is NAMED, never assumed. See deploy-targets.sh ──────────────
TARGET=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    *) break ;;
  esac
done

REL="${1:?usage: deploy-consumer.sh --target <production|staging> <release-name>}"

# shellcheck source=./deploy-targets.sh
. "$(dirname "$0")/deploy-targets.sh"
deploy_target "$TARGET" || exit 2
# The release name is interpolated into a privileged recursive delete below, so
# it is constrained here rather than trusted there. No slashes, no dots, no
# emptiness: it must name one directory inside the releases/ directory.
case "$REL" in
  ""|*/*|*..*|.*) printf 'refusing release name %q — it must be a single plain directory name\n' "$REL" >&2; exit 1 ;;
esac
REPO="$(cd "$(dirname "$0")/.." && cd .. && pwd)"
APP="$REPO/apps/migrapilot-consumer"
# Resolved from the named target — never a literal in this file again.
HOST="$DEPLOY_HOST"
ROOT="$DEPLOY_CONSUMER_ROOT"
# 🚨 THE UNIT IS PART OF THE TARGET, AND IT WAS THE ONE THING STILL HARD-CODED.
#
# The production unit name sat as a literal in the cutover restart AND in the
# rollback command this script prints. deploy-targets.sh exists so a staging
# deploy cannot touch a production runtime, and this was the hole in it:
# `--target staging` would copy the release into the staging root, swap the
# staging symlink, and then restart a unit name that only exists on production.
#
# The rollback line mattered more than the restart. It is the command an
# operator copies at the worst moment, and against staging it named a unit that
# is not there — so the symlink would go back and nothing would be restarted,
# leaving the release being rolled back FROM still serving.
UNIT="$DEPLOY_CONSUMER_UNIT"

printf '\n== deploying to %s (%s), db authority %s\n' \
  "$DEPLOY_TARGET_NAME" "$HOST" "$DEPLOY_DB_AUTHORITY"
PORT=3097

step() { printf '\n== %s\n' "$1"; }
fail() { printf '\nDEPLOY ABORTED: %s\n' "$1" >&2; exit 1; }

# ── 1. source tree is clean ────────────────────────────────────────────────
step "1. source tree is clean"
git -C "$APP" diff --quiet -- . || fail "consumer working tree is dirty; commit before deploying"
git -C "$REPO" diff --quiet -- docs/migrapilot || fail "docs/migrapilot is dirty; commit before deploying"
echo "   clean"

# ── 2. HEAD is the commit being shipped ────────────────────────────────────
step "2. HEAD is the commit being shipped"
COMMIT="$(git -C "$REPO" rev-parse HEAD)"
SHORT="$(git -C "$REPO" rev-parse --short HEAD)"
echo "   $SHORT  $(git -C "$REPO" log -1 --format=%s)"
# The fix this release exists for must actually be in the tree being built.
git -C "$APP" grep -q 'identifies rows rather than measuring them' -- src/server/tables \
  || fail "the identifier rule is not present in HEAD — wrong branch or wrong commit"
echo "   identifier rule present in source"

# ── 3. the full gate, not a subset ─────────────────────────────────────────
step "3. full consumer gate"
( cd "$APP" && npm run verify )

# ── 4. stamp the artifact, then build the release directory ────────────────
step "4. stamping the artifact with its identity"
# Written INTO .next so it travels with the bundle. This is what /api/version
# reports, which is what step 10 asserts against.
cat > "$APP/.next/RELEASE.json" <<STAMP
{"commit":"$COMMIT","release":"$REL","builtAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
STAMP
BUILD_ID="$(cat "$APP/.next/BUILD_ID")"
echo "   commit=$SHORT release=$REL buildId=$BUILD_ID"

step "4b. constructing the release directory"
PREVIOUS="$(ssh "$HOST" "readlink $ROOT/current")"
echo "   rollback target: $PREVIOUS"
# Staging must be idempotent: a run that aborts after this point leaves a
# populated directory behind, and `cp -al src dst` into an EXISTING dst nests it
# as node_modules/node_modules instead of failing loudly. Clear a stale release
# first — but never the one production is actually serving.
[ "$PREVIOUS" = "$ROOT/releases/$REL" ] \
  && fail "$REL is the currently-serving release; refusing to restage it underneath production"
ssh -n "$HOST" "sudo -n rm -rf --one-file-system $ROOT/releases/$REL"
ssh -n "$HOST" "sudo mkdir -p $ROOT/releases/$REL && sudo chown \$(id -un):\$(id -gn) $ROOT/releases/$REL"
tar -C "$APP" -czf - --exclude='.next/cache' .next package.json next.config.ts public \
  | ssh "$HOST" "tar -C $ROOT/releases/$REL -xzf -"
# node_modules is HARDLINKED from the live release rather than installed: the
# release flow has no lockfile step, so a fresh install would be a different tree
# from the one production has been running, and the difference would only appear
# at runtime.
ssh "$HOST" "sudo cp -al $ROOT/current/node_modules $ROOT/releases/$REL/node_modules"

# The same defect class as the Brain's, currently LATENT rather than absent:
# `.next` bundles most server code, but it still references
# @migrapilot/shared-types BY NAME in three files, so that package is resolved
# from the inherited node_modules at runtime. Staged from this build and
# verified for the same reason — and before the boot test, so a stale package
# that still satisfies every import is caught by its bytes rather than by
# whether it happens to crash.
bash "$(dirname "$0")/stage-workspace-deps.sh" "$REPO" "$APP" "$HOST" "$ROOT/releases/$REL" "$ROOT/current"
echo "   staged"

# ── 5+6+7. boot the new release on a spare port and interrogate it ─────────
step "5. boot test on a spare port (before anything is swapped)"
# THE BOOT TEST RUNS AS A TRANSIENT COPY OF THE PRODUCTION UNIT.
#
# Three attempts to hand-roll this failed on 2026-09-04, each differently, and
# each taught the same lesson: an approximation of the service is not the
# service.
#
#   · A plain `grep` of the root-only env file returned "Permission denied",
#     the trailing `; true` swallowed it, and Next booted with NO environment.
#     It still answered 200 and still reported the right identity — the chain
#     looked intact while testing something production would never run.
#   · The backgrounded process inherited the SSH channel and hung the deploy.
#   · `env $(... | xargs)` word-split a value containing a space, so `env` tried
#     to execute part of it: "env: 'profile': No such file or directory". Shell
#     sourcing has the same flaw; only systemd parses systemd's own format.
#
# So the test asks systemd to run it, with the SAME EnvironmentFiles (both of
# them — the drop-in adds a second that a hand-rolled test silently missed), the
# same user, and the same sandboxing. If the hardening would break this release,
# that surfaces here rather than after the cutover. No secret is ever read by,
# transported to, or printed on the deploying workstation.
BOOT_UNIT="migrapilot-boottest-$REL"
stop_boot() { ssh -n "$HOST" "sudo -n systemctl stop $BOOT_UNIT.service >/dev/null 2>&1; sudo -n systemctl reset-failed $BOOT_UNIT.service >/dev/null 2>&1; true"; }
stop_boot
ssh -n "$HOST" "sudo -n systemd-run --unit=$BOOT_UNIT --collect --quiet \
  --property=Type=simple \
  --property=User=migrapilot --property=Group=migrapilot \
  --property=EnvironmentFile=/etc/migrapilot/consumer.env \
  --property=EnvironmentFile=/etc/migrapilot/consumer-auth-origins.env \
  --property=WorkingDirectory=$ROOT/releases/$REL \
  --property=NoNewPrivileges=true \
  --property=PrivateTmp=true \
  --property=ProtectHome=true \
  --property=ProtectSystem=strict \
  --property=RestrictSUIDSGID=true \
  --property=ReadWritePaths=$ROOT/releases/$REL/.next \
  /usr/bin/node $ROOT/releases/$REL/node_modules/next/dist/bin/next start -p $PORT -H 127.0.0.1" \
  || fail "could not start the transient boot unit"
sleep 14
ssh -n "$HOST" "systemctl is-active $BOOT_UNIT.service" >/dev/null 2>&1 \
  || { ssh -n "$HOST" "journalctl -u $BOOT_UNIT.service -n 30 --no-pager"; stop_boot; fail "boot unit is not running"; }
echo "   transient unit $BOOT_UNIT active"

step "6. the boot-tested instance answers"
HEALTH="$(ssh -n "$HOST" "curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://127.0.0.1:$PORT/ || echo 000")"
[ "$HEALTH" = "200" ] || { ssh -n "$HOST" "journalctl -u $BOOT_UNIT.service -n 30 --no-pager"; stop_boot; fail "boot test returned $HEALTH"; }
echo "   HTTP $HEALTH"

step "7. the BOOT-TESTED artifact reports the identity we just built"
BOOT_ID="$(ssh -n "$HOST" "curl -s --max-time 8 http://127.0.0.1:$PORT/api/version")"
echo "   $BOOT_ID"
# Stopping by unit name, not by a command-line pattern. A `pkill -f` whose
# pattern also matches the shell issuing it kills that shell instead.
stop_boot
echo "$BOOT_ID" | grep -q "\"commit\":\"$COMMIT\"" || fail "boot-tested artifact reports a different commit"
echo "$BOOT_ID" | grep -q "\"release\":\"$REL\""    || fail "boot-tested artifact reports a different release"
echo "$BOOT_ID" | grep -q "\"buildId\":\"$BUILD_ID\"" || fail "boot-tested artifact reports a different build id"
echo "   commit, release and buildId all match"

# ── QUALIFY-ONLY STOPS HERE ────────────────────────────────────────────────
# Everything above proves the candidate without touching what users are served.
# Everything below moves production. See the Brain script for the reasoning.
if [ "${MIGRAPILOT_QUALIFY_ONLY:-0}" = "1" ]; then
  printf '\n== QUALIFIED, NOT DEPLOYED\n'
  echo "   release $REL is staged, boot-tested and identity-checked at $ROOT/releases/$REL"
  echo "   production is UNCHANGED: current -> $PREVIOUS"
  echo "   to deploy it, re-run without MIGRAPILOT_QUALIFY_ONLY"
  exit 0
fi

# ── 8+9. only now does anything move ───────────────────────────────────────
step "8. activating the release"
ssh "$HOST" "sudo ln -sfn $ROOT/releases/$REL $ROOT/current"
echo "   current -> $(ssh "$HOST" "readlink $ROOT/current")"

step "9. restarting the target against it"
ssh "$HOST" "sudo systemctl restart $UNIT && sleep 6 && systemctl is-active $UNIT"

# ── 10. the running process reports the same release ───────────────────────
step "10. THE RUNNING PRODUCTION PROCESS REPORTS THE SAME RELEASE"
# The link whose absence caused the incident. Asked of the live service on its
# real bind address, not of the directory and not of the symlink.
#
# 🚨 UNREACHABLE IS NOT "WRONG COMMIT", AND A BLIP IS NOT A VERDICT.
#
# This was one ssh call whose output fed straight into grep. A transient
# `kex_exchange_identification: Connection reset by peer` — seen once, on a
# deploy that was in fact perfectly good — left $RUNNING empty, and `set -e`
# killed the script AT THE ASSIGNMENT. The log showed step 10 starting, three
# lines of ssh noise, and then nothing: no pass, no fail, no verdict at all,
# on the one step whose entire job is to state whether production is correct.
#
# Had it survived to the greps it would have been worse — an empty response
# fails every one of them, so a network blip would have printed "PRODUCTION IS
# SERVING A DIFFERENT COMMIT — roll back" about a correct release. That is the
# same defect this product just fixed in its own refusals: never translate one
# failure ("I could not reach it") into a different and wronger claim ("it is
# serving the wrong thing").
RUNNING=""
for attempt in 1 2 3 4 5; do
  RUNNING="$(ssh -o ConnectTimeout=15 "$HOST" "curl -s --max-time 8 http://10.10.0.13:3000/api/version" 2>/dev/null || true)"
  [ -n "$RUNNING" ] && break
  echo "   attempt $attempt: no answer from the running service, retrying…"
  sleep 5
done

if [ -z "$RUNNING" ]; then
  fail "COULD NOT VERIFY what production is serving — the service did not answer after 5 attempts.
   This is NOT evidence of a bad release: the symlink was swapped and the unit restarted.
   Check it yourself before deciding anything:
     curl -s https://chat.migrateck.com/api/version
   Expected: commit $COMMIT / release $REL / buildId $BUILD_ID
   Roll back ONLY if that disagrees."
fi

echo "   $RUNNING"
echo "$RUNNING" | grep -q "\"commit\":\"$COMMIT\""   || fail "PRODUCTION IS SERVING A DIFFERENT COMMIT — roll back"
echo "$RUNNING" | grep -q "\"release\":\"$REL\""     || fail "PRODUCTION IS SERVING A DIFFERENT RELEASE — roll back"
echo "$RUNNING" | grep -q "\"buildId\":\"$BUILD_ID\"" || fail "PRODUCTION IS SERVING A DIFFERENT BUILD — roll back"

# ── 11. rollback stays available and is printed, not remembered ────────────
cat <<DONE

DEPLOYED — and proven, link by link:
  expected commit  $SHORT
  built artifact   buildId $BUILD_ID
  boot-tested      identity matched on port $PORT
  activated        current -> $REL
  RUNNING PROCESS  reports commit $SHORT / release $REL / buildId $BUILD_ID

11. rollback:
  ssh $HOST "sudo ln -sfn $PREVIOUS $ROOT/current && sudo systemctl restart $UNIT"

NOT ACCEPTED. This script proves what is RUNNING; it does not prove the product
is correct. Hand back for real-system retest.
DONE
