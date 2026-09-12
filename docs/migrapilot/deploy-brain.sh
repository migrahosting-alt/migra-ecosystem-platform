#!/usr/bin/env bash
#
# Deploy the MigraPilot Brain to VM111, and PROVE which release is serving.
#
# 🚨 WHY THIS EXISTS. A fix that is committed, tested and pushed is invisible to
# the person testing the product until the artifact serving them contains it. The
# consumer learned that expensively; this applies the same chain to the Brain, and
# refuses to skip a link of it:
#
#   expected commit -> built artifact -> boot-tested artifact
#                   -> activated release -> RUNNING PROCESS REPORTS THE SAME ONE
#
# Identity is asserted against /api/version, which answers from a RELEASE.json
# stamped into `dist` at build time and never from configuration — an environment
# variable describes the machine, not the code on it, and would survive a failed
# deploy still reporting the release someone intended.
#
# THIS DEPLOYS THE BRAIN AND NOTHING ELSE. One explicit release argument, no
# second target, no command passthrough, no interactive shell. Every remote call
# is a fixed command with interpolated paths that are constrained above.
#
# TWO THINGS IT DOES THAT THE CONSUMER SCRIPT LEARNED THE HARD WAY:
#
#  · The rollback target is VALIDATED BEFORE CUTOVER, not printed optimistically
#    afterwards. A rollback command is only worth having if it runs, and the one
#    time it is needed is the worst time to discover the release it names is
#    missing, incomplete, or was garbage-collected.
#  · The boot test runs as a TRANSIENT COPY OF THE PRODUCTION UNIT rather than a
#    hand-rolled approximation. Three attempts to imitate the consumer's unit
#    failed differently, and the last one booted with no environment at all while
#    still answering 200 with the correct identity.
#
#   usage:  docs/migrapilot/deploy-brain.sh <release-name>
#   e.g.    docs/migrapilot/deploy-brain.sh capability-boundary-0905
#
set -euo pipefail

# ── the target is NAMED, never assumed ──────────────────────────────────────
#
# 🚨 THIS SCRIPT USED TO DEPLOY TO PRODUCTION AND NOT SAY SO.
#
# `HOST=migrapilot-app-core` sat as a literal below, so `deploy-brain.sh
# rc-0909` read like a release name and was in fact a production deployment.
# Survivable while production was the only environment; not survivable once
# staging exists, because the two invocations would look identical.
#
# There is deliberately no default: a default is exactly what "VM111 unless
# otherwise stated" already was, and the cost of an unnamed target is one
# retyped word against a production deployment nobody intended.
TARGET=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    *) break ;;
  esac
done

REL="${1:?usage: deploy-brain.sh --target <production|staging> <release-name>}"
if [ "$#" -ne 1 ]; then
  echo "refusing: exactly one positional argument (the release name) is accepted" >&2
  echo "usage: deploy-brain.sh --target <production|staging> <release-name>" >&2
  exit 1
fi

# shellcheck source=./deploy-targets.sh
. "$(dirname "$0")/deploy-targets.sh"
deploy_target "$TARGET" || exit 2
# The release name is interpolated into a privileged recursive delete below, so
# it is constrained here rather than trusted there.
case "$REL" in
  ""|*/*|*..*|.*|*[!A-Za-z0-9._-]*)
    printf 'refusing release name %q — letters, digits, dot, dash and underscore only\n' "$REL" >&2
    exit 1 ;;
esac

REPO="$(cd "$(dirname "$0")/.." && cd .. && pwd)"
APP="$REPO/apps/brain-service"
# Resolved from the named target — never a literal in this file again.
HOST="$DEPLOY_HOST"
ROOT="$DEPLOY_BRAIN_ROOT"
UNIT="$DEPLOY_BRAIN_UNIT"
BOOT_PORT="$DEPLOY_BRAIN_BOOT_PORT"
PROD_BIND="$DEPLOY_BRAIN_BIND"
PROD_PORT="$DEPLOY_BRAIN_PORT"

# 🚨 SAID OUT LOUD, EVERY TIME. A deployment that does not announce where it is
# going is one somebody runs from the wrong terminal.
printf '\n== deploying to %s (%s), db authority %s\n' \
  "$DEPLOY_TARGET_NAME" "$HOST" "$DEPLOY_DB_AUTHORITY"

step() { printf '\n== %s\n' "$1"; }
fail() { printf '\nDEPLOY ABORTED: %s\n' "$1" >&2; exit 1; }

# ── 1. source tree is clean ────────────────────────────────────────────────
step "1. source tree is clean"
git -C "$APP" diff --quiet -- . || fail "brain-service working tree is dirty; commit before deploying"
git -C "$REPO" diff --quiet -- docs/migrapilot || fail "docs/migrapilot is dirty; commit before deploying"
echo "   clean"

# ── 2. HEAD is the commit being shipped ────────────────────────────────────
step "2. HEAD is the commit being shipped"
COMMIT="$(git -C "$REPO" rev-parse HEAD)"
SHORT="$(git -C "$REPO" rev-parse --short HEAD)"
echo "   $SHORT  $(git -C "$REPO" log -1 --format=%s)"

# ── 3. the full gate, not a subset ─────────────────────────────────────────
step "3. full brain gate (build + tests)"
( cd "$APP" && npm test )

# ── 4. would this release MIGRATE the production database? ─────────────────
#
# A rollback cannot undo a migration. If the artifact carries schema versions
# production has not applied, then the boot test — which runs startup migrations
# against the real database, because it uses the real environment — would migrate
# production BEFORE cutover. A boot test that then failed would leave a forward-
# migrated schema underneath the old code, and the validated rollback below would
# restore code that no longer matches its database.
#
# So the delta is measured and the deploy refuses by default. Set
# MIGRAPILOT_ALLOW_MIGRATIONS=1 to proceed deliberately, knowing rollback is then
# code-only.
step "4. schema migration delta"
BUILT_SCHEMA="$(cd "$APP" && node -e "import('./dist/src/engine/persistence/postgres/migrations.js').then(m=>console.log(m.latestVersion()))")"
LIVE_SCHEMA="$(ssh -n "$HOST" "curl -s --max-time 8 http://$PROD_BIND:$PROD_PORT/health" \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const h=JSON.parse(s);const f=JSON.stringify(h).match(/\"schemaVersion\":\s*(\d+)/);console.log(f?f[1]:'unknown')}catch{console.log('unknown')}})")"
echo "   built artifact: schema $BUILT_SCHEMA   production: schema $LIVE_SCHEMA"
[ "$LIVE_SCHEMA" = "unknown" ] && fail "could not read production schema version; refusing to guess"
if [ "$BUILT_SCHEMA" -gt "$LIVE_SCHEMA" ]; then
  if [ "${MIGRAPILOT_ALLOW_MIGRATIONS:-0}" != "1" ]; then
    fail "this release would apply schema migrations $((LIVE_SCHEMA+1))..$BUILT_SCHEMA. The boot test runs them against the REAL database, and rollback cannot undo them. Re-run with MIGRAPILOT_ALLOW_MIGRATIONS=1 to accept a code-only rollback."
  fi
  echo "   MIGRAPILOT_ALLOW_MIGRATIONS=1 — proceeding; rollback will be CODE-ONLY"
elif [ "$BUILT_SCHEMA" -lt "$LIVE_SCHEMA" ]; then
  fail "the built artifact is BEHIND production's schema ($BUILT_SCHEMA < $LIVE_SCHEMA) — this is a downgrade, not a deploy"
else
  echo "   no migrations pending; rollback restores code AND schema"
fi

# ── 5. stamp the artifact with its identity ────────────────────────────────
step "5. stamping the artifact"
# buildId is a digest of the built output itself, so two builds of the same
# commit with different bytes are distinguishable. RELEASE.json is excluded from
# its own digest.
BUILD_ID="$(cd "$APP/dist" && find . -type f ! -name RELEASE.json -print0 \
  | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-40)"
cat > "$APP/dist/RELEASE.json" <<STAMP
{"commit":"$COMMIT","release":"$REL","buildId":"sha256:$BUILD_ID","builtAt":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
STAMP
echo "   commit=$SHORT release=$REL buildId=sha256:${BUILD_ID:0:16}…"

# ── 6. VALIDATE THE ROLLBACK TARGET, BEFORE ANYTHING MOVES ─────────────────
step "6. validating the rollback target"
PREVIOUS="$(ssh -n "$HOST" "readlink $ROOT/current")"
[ -n "$PREVIOUS" ] || fail "$ROOT/current is not a symlink; refusing to deploy over an unknown layout"
echo "   rollback target: $PREVIOUS"
[ "$PREVIOUS" = "$ROOT/releases/$REL" ] \
  && fail "$REL is the currently-serving release; refusing to restage it underneath production"
# Not "it exists" — it must be a release that could actually SERVE.
ROLLBACK_OK="$(ssh -n "$HOST" "test -d '$PREVIOUS' \
  && test -f '$PREVIOUS/dist/src/server.js' \
  && test -d '$PREVIOUS/node_modules' \
  && test -f '$PREVIOUS/package.json' && echo yes || echo no")"
[ "$ROLLBACK_OK" = "yes" ] \
  || fail "the rollback target $PREVIOUS is missing its entrypoint, node_modules or package.json. Deploying now would leave no validated way back."
echo "   rollback target is complete and servable"
ROLLBACK_CMD="ssh $HOST \"sudo ln -sfn $PREVIOUS $ROOT/current && sudo systemctl restart $UNIT\""

# ── 7. build the release directory ─────────────────────────────────────────
step "7. constructing the release directory"
# Idempotent: a run that aborts after this point leaves a populated directory,
# and `cp -al src dst` into an EXISTING dst nests it as node_modules/node_modules
# instead of failing loudly.
ssh -n "$HOST" "sudo -n rm -rf --one-file-system $ROOT/releases/$REL"
ssh -n "$HOST" "sudo mkdir -p $ROOT/releases/$REL && sudo chown \$(id -un):\$(id -gn) $ROOT/releases/$REL"
tar -C "$APP" -czf - dist package.json \
  | ssh "$HOST" "tar -C $ROOT/releases/$REL -xzf -"
# node_modules is HARDLINKED from the live release rather than installed: the
# release flow has no lockfile step, so a fresh install would be a different tree
# from the one production has been running, and the difference would only appear
# at runtime.
ssh -n "$HOST" "sudo cp -al $PREVIOUS/node_modules $ROOT/releases/$REL/node_modules"

# 🚨 WORKSPACE PACKAGES COME FROM *THIS* BUILD, NOT THE PREVIOUS RELEASE.
#
# The hardlink above is right for third-party packages and wrong for the ones
# this repo builds. chat-platform-rc-0907 inherited a @migrapilot/shared-types
# built three days earlier and aborted at the boot test on a missing export,
# while every local gate passed — the repo resolves that specifier through a
# symlink to freshly built output, the artifact carried a copied snapshot.
#
# This replaces each workspace package (removing first, so the hardlink to the
# rollback release is BROKEN rather than written through) and then verifies the
# staged bytes against the built bytes. A stale package that still satisfies
# every import raises no error at all — just old behaviour — so the check is a
# digest, not a copy that appeared to succeed.
bash "$(dirname "$0")/stage-workspace-deps.sh" "$REPO" "$APP" "$HOST" "$ROOT/releases/$REL" "$PREVIOUS"
echo "   staged"

# ── 8. boot test, as a transient copy of the production unit ───────────────
step "8. boot test on port $BOOT_PORT (before anything is swapped)"
BOOT_UNIT="migrapilot-brain-boottest-$REL"
stop_boot() { ssh -n "$HOST" "sudo -n systemctl stop $BOOT_UNIT.service >/dev/null 2>&1; sudo -n systemctl reset-failed $BOOT_UNIT.service >/dev/null 2>&1; true"; }
# EVERY exit path, not the ones we remembered. `fail` can be reached from the
# health check, the identity comparisons, or systemd-run itself failing after it
# has already created the unit — and a leaked boot instance holds the port and
# the database connections against the next attempt.
trap stop_boot EXIT
stop_boot
# Mirrors migrapilot-brain.service: same user and group, all three
# EnvironmentFiles (the third is optional there and stays optional here), and the
# same sandboxing, so a release that the hardening would break fails HERE rather
# than after cutover. Verified directive-by-directive against `systemctl cat`.
#
# Two deliberate differences. WorkingDirectory points at the NEW release rather
# than `current`, which is the whole point. And Restart= is NOT copied: the real
# unit restarts on failure, but a boot test must not — a crash-looping process
# reports `active` and would mask exactly the failure this step exists to catch.
#
# ReadWritePaths is single-quoted because its value contains a space. Unquoted,
# the remote shell split it and systemd-run took /var/log/migrapilot as the start
# of the command.
#
# 🚨 THE PORT OVERRIDE IS AN ENVIRONMENT FILE, NOT --setenv.
#
# `--setenv` becomes Environment=, and systemd applies EnvironmentFile= AFTER
# Environment= regardless of the order they are written — so brain.env put the
# port back to 3988 and the boot instance tried to bind the PRODUCTION port. It
# found production already there, logged "port already in use; reusing the
# existing healthy local service", and stayed `active` while serving nothing.
#
# That is exactly the false-confidence shape this script exists to prevent, and
# it was caught only because /health is probed on the SPARE port: a probe against
# 3988 would have got production's healthy answer and passed. A boot-test that
# can accidentally interrogate production is not a boot test.
#
# A last-listed EnvironmentFile wins over the earlier ones — the same mechanism
# the real unit's own drop-in uses to add configuration.
BOOT_ENV="$ROOT/releases/$REL/.boot-test.env"
ssh -n "$HOST" "printf 'MIGRAPILOT_BRAIN_PORT=%s\nMIGRAPILOT_BRAIN_HOST=127.0.0.1\n' '$BOOT_PORT' > $BOOT_ENV"
ssh -n "$HOST" "sudo -n systemd-run --unit=$BOOT_UNIT --collect --quiet \
  --property=Type=simple \
  --property=User=$DEPLOY_SERVICE_USER --property=Group=$DEPLOY_SERVICE_GROUP \
  $(env_file_properties "$DEPLOY_ENV_FILES") \
  --property=WorkingDirectory=$ROOT/releases/$REL \
  --property=NoNewPrivileges=true \
  --property=PrivateTmp=true \
  --property=ProtectHome=true \
  --property=ProtectSystem=strict \
  --property=ProtectKernelTunables=true \
  --property=RestrictSUIDSGID=true \
  --property='ReadWritePaths=/var/lib/migrapilot /var/log/migrapilot' \
  --property=EnvironmentFile=$BOOT_ENV \
  /usr/bin/node $ROOT/releases/$REL/dist/src/server.js" \
  || fail "could not start the transient boot unit"
sleep 16
ssh -n "$HOST" "systemctl is-active $BOOT_UNIT.service" >/dev/null 2>&1 \
  || { ssh -n "$HOST" "journalctl -u $BOOT_UNIT.service -n 40 --no-pager"; stop_boot; fail "boot unit is not running"; }
echo "   transient unit $BOOT_UNIT active"

step "9. the boot-tested instance answers"
HEALTH="$(ssh -n "$HOST" "curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://127.0.0.1:$BOOT_PORT/health || echo 000")"
[ "$HEALTH" = "200" ] || { ssh -n "$HOST" "journalctl -u $BOOT_UNIT.service -n 40 --no-pager"; stop_boot; fail "boot test /health returned $HEALTH"; }
echo "   HTTP $HEALTH"

step "10. the BOOT-TESTED artifact reports the identity we just built"
BOOT_ID="$(ssh -n "$HOST" "curl -s --max-time 10 http://127.0.0.1:$BOOT_PORT/api/version")"
echo "   $BOOT_ID"
stop_boot
echo "$BOOT_ID" | grep -q "\"commit\":\"$COMMIT\""            || fail "boot-tested artifact reports a different commit"
echo "$BOOT_ID" | grep -q "\"release\":\"$REL\""              || fail "boot-tested artifact reports a different release"
echo "$BOOT_ID" | grep -q "\"buildId\":\"sha256:$BUILD_ID\""  || fail "boot-tested artifact reports a different build id"
echo "$BOOT_ID" | grep -q '"stamped":true'                    || fail "boot-tested artifact is not stamped"
echo "   commit, release and buildId all match"
# The boot-test override must not travel into production. It is inert there —
# nothing in the real unit reads it — but a release directory should contain the
# release and nothing else.
ssh -n "$HOST" "rm -f $BOOT_ENV"

# ── 11+12. only now does anything move ─────────────────────────────────────
# ── QUALIFY-ONLY STOPS HERE ────────────────────────────────────────────────
#
# Everything above proves the candidate WITHOUT touching what users are served:
# gates, staged workspace parity, rollback integrity, a boot on a spare port and
# an identity assertion against the artifact that actually booted. Everything
# below moves production.
#
# A release candidate needs exactly the first half. Running the whole script and
# hoping to interrupt it before the symlink swap is not a qualification method.
if [ "${MIGRAPILOT_QUALIFY_ONLY:-0}" = "1" ]; then
  printf '\n== QUALIFIED, NOT DEPLOYED\n'
  echo "   release $REL is staged, boot-tested and identity-checked at $ROOT/releases/$REL"
  echo "   production is UNCHANGED: current -> $PREVIOUS"
  echo "   to deploy it, re-run without MIGRAPILOT_QUALIFY_ONLY"
  exit 0
fi

step "11. activating the release"
ssh -n "$HOST" "sudo ln -sfn $ROOT/releases/$REL $ROOT/current"
echo "   current -> $(ssh -n "$HOST" "readlink $ROOT/current")"

step "12. restarting production against it"
ssh -n "$HOST" "sudo systemctl restart $UNIT && sleep 8 && systemctl is-active $UNIT"

# ── 13. the running process reports the same release ───────────────────────
step "13. THE RUNNING PRODUCTION PROCESS REPORTS THE SAME RELEASE"
# Asked of the live service on its real bind address, not of the directory and
# not of the symlink.
#
# 🚨 UNREACHABLE IS NOT "WRONG COMMIT". The consumer deploy carried this same
# single-ssh pattern and hit a transient
# `kex_exchange_identification: Connection reset by peer` on a release that was
# in fact correct. $RUNNING came back empty, `set -e` killed the script at the
# assignment, and the log showed this step starting and then nothing — no
# verdict on the one step whose job is to give one. Surviving to the greps would
# have been worse: an empty response fails all four, so a network blip would
# have ordered a rollback of a good release.
RUNNING=""
for attempt in 1 2 3 4 5; do
  RUNNING="$(ssh -n -o ConnectTimeout=15 "$HOST" "curl -s --max-time 10 http://$PROD_BIND:$PROD_PORT/api/version" 2>/dev/null || true)"
  [ -n "$RUNNING" ] && break
  echo "   attempt $attempt: no answer from the running service, retrying…"
  sleep 5
done

if [ -z "$RUNNING" ]; then
  fail "COULD NOT VERIFY what production is serving — no answer after 5 attempts.
   This is NOT evidence of a bad release: the symlink was swapped and the unit restarted.
   Check before deciding anything, and roll back ONLY if it disagrees:
     ssh $HOST \"curl -s http://$PROD_BIND:$PROD_PORT/api/version\"
   Expected: commit $COMMIT / release $REL / buildId sha256:$BUILD_ID
   Rollback if needed: $ROLLBACK_CMD"
fi

echo "   $RUNNING"
echo "$RUNNING" | grep -q "\"commit\":\"$COMMIT\""            || fail "PRODUCTION IS SERVING A DIFFERENT COMMIT — roll back: $ROLLBACK_CMD"
echo "$RUNNING" | grep -q "\"release\":\"$REL\""              || fail "PRODUCTION IS SERVING A DIFFERENT RELEASE — roll back: $ROLLBACK_CMD"
echo "$RUNNING" | grep -q "\"buildId\":\"sha256:$BUILD_ID\""  || fail "PRODUCTION IS SERVING A DIFFERENT BUILD — roll back: $ROLLBACK_CMD"
echo "$RUNNING" | grep -q '"stamped":true'                    || fail "production artifact is not stamped — roll back: $ROLLBACK_CMD"

cat <<DONE

DEPLOYED — and proven, link by link:
  expected commit  $SHORT
  built artifact   buildId sha256:${BUILD_ID:0:16}…
  schema           built $BUILT_SCHEMA / production was $LIVE_SCHEMA
  boot-tested      identity matched on port $BOOT_PORT, as a copy of the real unit
  activated        current -> $REL
  RUNNING PROCESS  reports commit $SHORT / release $REL

14. rollback (validated BEFORE cutover, at step 6):
  $ROLLBACK_CMD

NOT ACCEPTED. This script proves what is RUNNING; it does not prove the product
is correct. Hand back for real-system retest.
DONE
