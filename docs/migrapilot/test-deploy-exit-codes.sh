#!/usr/bin/env bash
#
# A DEPLOY COMMAND MUST NEVER REPORT SUCCESS UNLESS THE WHOLE CHAIN SUCCEEDED.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 WHY THIS EXISTS, AND WHAT IT IS NOT
#
# On 2026-09-13 I reported that `deploy-consumer.sh` returned exit 0 after its
# dirty-tree guard aborted a deploy. That was WRONG. My invocation was
#
#   bash deploy-consumer.sh … > log 2>&1; echo "EXIT=$?"; grep … || tail -20 log
#
# whose own status is that of the final `tail`. The script had returned 1 the
# whole time; I attributed my shell's aggregate status to it.
#
# So this file does not fix a defect. It pins a PROPERTY that was already true
# and was, for an afternoon, believed to be false — because an exit code is
# read by scripts and by CI, and nothing else in the deploy chain notices when
# it lies. `/api/version` proves what is RUNNING; the exit code is what a
# caller branches on, and the two are independent claims.
#
# ─────────────────────────────────────────────────────────────────────────────
# HOW IT TESTS THE REAL SCRIPT WITHOUT TOUCHING A SERVER
#
# The script under test is copied, byte for byte, into a synthetic repository
# laid out the way it computes its own paths:
#
#   $T/docs/migrapilot/deploy-consumer.sh   →  REPO=$T, APP=$T/apps/migrapilot-consumer
#
# Everything that leaves the machine — ssh, tar, npm, node — is replaced on
# PATH by a stub that answers from environment variables, so each link in the
# chain can be made to fail on demand. No host is contacted. Nothing is
# deployed. The assertions are only ever about the EXIT CODE and about whether
# the word DEPLOYED was printed.
#
#   usage:  docs/migrapilot/test-deploy-exit-codes.sh
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0

T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

# ── the synthetic repository ───────────────────────────────────────────────
mkdir -p "$T/docs/migrapilot" "$T/scripts" "$T/apps/migrapilot-consumer/.next" \
         "$T/apps/migrapilot-consumer/src/server/tables" "$T/apps/migrapilot-consumer/public"
cp "$HERE/deploy-consumer.sh" "$HERE/deploy-targets.sh" "$T/docs/migrapilot/"
# The completeness predicate the deploy sources — one definition, shared with
# release-retention.sh. Copied rather than stubbed: the point of the harness is
# to exercise the REAL check.
cp "$HERE/../../scripts/release-completeness.sh" "$T/scripts/"
# stage-workspace-deps.sh is its own contract with its own tests; here it only
# has to succeed or fail on command, so the harness owns a stub of it.
cat > "$T/docs/migrapilot/stage-workspace-deps.sh" <<'STAGE'
#!/usr/bin/env bash
[ "${STUB_STAGE_FAIL:-0}" = "1" ] && { echo "stage-workspace-deps: forced failure" >&2; exit 1; }
echo "   (stub) workspace deps staged"
STAGE
chmod +x "$T/docs/migrapilot/stage-workspace-deps.sh"

A="$T/apps/migrapilot-consumer"
echo "buildid-under-test" > "$A/.next/BUILD_ID"
# The source marker step 2 insists on before it will ship anything.
echo '// identifies rows rather than measuring them' > "$A/src/server/tables/identifiers.ts"
printf '{"name":"migrapilot-consumer"}\n' > "$A/package.json"
printf 'export default {}\n' > "$A/next.config.ts"

git -C "$T" init -q
git -C "$T" config user.email t@t.t
git -C "$T" config user.name t
git -C "$T" add -A
git -C "$T" commit -qm "harness baseline"
COMMIT="$(git -C "$T" rev-parse HEAD)"

# ── the stubs: everything that would leave this machine ────────────────────
BIN="$T/bin"; mkdir -p "$BIN"

cat > "$BIN/ssh" <<'SSH'
#!/usr/bin/env bash
# Answers the handful of remote questions deploy-consumer.sh asks. Every
# scenario is selected by an environment variable so the real control flow of
# the script under test is exercised, not a rewritten copy of it.
cmd="${*: -1}"
case "$cmd" in
  *"readlink"*)
      # __SELF__ means "current already points at the release being built",
      # which the script must refuse rather than restage underneath itself.
      if [ "${STUB_PREVIOUS:-}" = "__SELF__" ]; then
        echo "/opt/migrapilot-staging/consumer/releases/$HARNESS_REL"
      else
        echo "${STUB_PREVIOUS:-/opt/migrapilot-staging/consumer/releases/prev-release}"
      fi ;;
  *"tar -C"*)                       [ "${STUB_TRANSFER_FAIL:-0}" = "1" ] && exit 3; cat >/dev/null ;;
  *"systemd-run"*)                  [ "${STUB_BOOT_START_FAIL:-0}" = "1" ] && exit 4; : ;;
  *"is-active"*)                    [ "${STUB_BOOT_ACTIVE:-1}" = "1" ] || exit 5; echo active ;;
  *"journalctl"*)                   echo "(stub journal)" ;;
  # The rollback-target completeness probe: `test -d … && test -f … && echo yes`.
  *"echo yes || echo no"*)          echo "${STUB_ROLLBACK_OK:-yes}" ;;
  *"-w '%{http_code}'"*)            echo "${STUB_HEALTH:-200}" ;;
  *"/api/version"*)
      printf '{"buildId":"%s","commit":"%s","release":"%s","builtAt":"x","stamped":true}\n' \
        "${STUB_ID_BUILD:-buildid-under-test}" "${STUB_ID_COMMIT:-$HARNESS_COMMIT}" "${STUB_ID_RELEASE:-$HARNESS_REL}" ;;
  *"systemctl restart"*)            [ "${STUB_RESTART_FAIL:-0}" = "1" ] && exit 6; echo active ;;
  *)                                : ;;
esac
exit 0
SSH

cat > "$BIN/npm" <<'NPM'
#!/usr/bin/env bash
[ "${STUB_GATE_FAIL:-0}" = "1" ] && { echo "npm: the gate failed" >&2; exit 1; }
echo "   (stub) gate passed"
NPM

cat > "$BIN/tar" <<'TAR'
#!/usr/bin/env bash
# Only the outgoing side is stubbed; the incoming side is the ssh stub.
if [ "${STUB_TAR_FAIL:-0}" = "1" ]; then echo "tar: forced failure" >&2; exit 2; fi
case " $* " in *" -xzf "*) cat >/dev/null ;; *) echo "(stub tarball)" ;; esac
TAR

chmod +x "$BIN/ssh" "$BIN/npm" "$BIN/tar"

# ── the assertion ──────────────────────────────────────────────────────────
# A deploy either succeeds completely and says DEPLOYED, or it exits non-zero
# and does not. There is no third outcome, and "printed an error but exited 0"
# is the outcome this file exists to make impossible.
expect() {
  local name="$1" want="$2"; shift 2
  local rel="rel-$RANDOM" out status
  out="$(cd "$T" && env PATH="$BIN:$PATH" HARNESS_COMMIT="$COMMIT" HARNESS_REL="$rel" "$@" \
        bash docs/migrapilot/deploy-consumer.sh --target staging "$rel" 2>&1)"
  status=$?

  local ok=1 why=""
  if [ "$want" = "success" ]; then
    [ "$status" -eq 0 ] || { ok=0; why="expected exit 0, got $status"; }
    grep -q 'DEPLOYED — and proven' <<<"$out" || { ok=0; why="${why:+$why; }did not print DEPLOYED"; }
  else
    [ "$status" -ne 0 ] || { ok=0; why="🚨 REPORTED SUCCESS (exit 0) ON A FAILED DEPLOY"; }
    # The harder half: a failed deploy must not also CLAIM to have deployed.
    grep -q 'DEPLOYED — and proven' <<<"$out" && { ok=0; why="${why:+$why; }printed DEPLOYED anyway"; }
  fi

  if [ "$ok" -eq 1 ]; then
    printf '  ok    %-44s exit=%s\n' "$name" "$status"; PASS=$((PASS+1))
  else
    printf '  FAIL  %-44s exit=%s  (%s)\n' "$name" "$status" "$why"; FAIL=$((FAIL+1))
    printf '%s\n' "$out" | tail -6 | sed 's/^/          | /'
  fi
}

printf '\n== deploy-consumer.sh exit-code truthfulness\n\n'

# 1. the dirty-tree guard
echo "# a tracked change" >> "$A/package.json"
expect "dirty tree aborts non-zero"            failure
git -C "$T" checkout -- apps/migrapilot-consumer/package.json

# 2. the build/gate
expect "gate failure aborts non-zero"          failure STUB_GATE_FAIL=1

# 3. the transfer
expect "outgoing transfer failure"             failure STUB_TAR_FAIL=1
expect "receiving transfer failure"            failure STUB_TRANSFER_FAIL=1
expect "workspace-dep staging failure"         failure STUB_STAGE_FAIL=1

# 4. the boot test
expect "boot unit will not start"              failure STUB_BOOT_START_FAIL=1
expect "boot unit starts then is not active"   failure STUB_BOOT_ACTIVE=0
expect "boot test answers HTTP 500"            failure STUB_HEALTH=500
expect "boot test unreachable (000)"           failure STUB_HEALTH=000

# 5. identity mismatch — the incident this whole script was written for
expect "boot artifact reports another commit"  failure STUB_ID_COMMIT=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
expect "boot artifact reports another release" failure STUB_ID_RELEASE=some-other-release
expect "boot artifact reports another buildId" failure STUB_ID_BUILD=some-other-buildid

# 6. the guards that refuse before any work
expect "refuses to restage the live release"   failure STUB_PREVIOUS=__SELF__

# 7. 🚨 A DIRECTORY IS NOT A WAY BACK.
#
# Found on staging: an aborted deploy left a 491 MB release with .next and
# package.json but no node_modules sitting in the rollback slot. Deploying over
# a rollback target that cannot serve leaves no validated way back, which is the
# one failure a deploy script exists to prevent.
expect "rollback target cannot serve"          failure STUB_ROLLBACK_OK=no

# 7b. 🚨 FAIL CLOSED WHEN THE PREDICATE ITSELF IS MISSING.
#
# The completeness definition is shared, so a deploy run without it cannot know
# whether its rollback target can serve. Guessing — or silently falling back to
# an inlined copy — is how one fact came to have three answers. Refusing is free.
mv "$T/scripts/release-completeness.sh" "$T/scripts/release-completeness.sh.hidden"
expect "aborts when the shared predicate is absent" failure
mv "$T/scripts/release-completeness.sh.hidden" "$T/scripts/release-completeness.sh"

# 8. and the one path that is allowed to say DEPLOYED
expect "a complete deploy reports success"     success

printf '\n  %s passed, %s failed\n\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
