#!/usr/bin/env bash
#
# CONTROLS FOR THE DEPLOY TARGET CONTRACT.
#
# 🚨 The property under test is a REFUSAL, and a refusal is the one thing that
# looks identical to "nothing happened". Each control states what it expected.
#
# 🚨 AND THE HARNESS ITSELF CAUGHT ME OUT. With `pipefail`, piping the deploy
# script into grep made the PIPELINE fail — because the script exits non-zero,
# which is exactly the behaviour under test. Three correct refusals were
# reported as failures. Output is captured first now, and the exit code is
# checked separately from the message.
set -uo pipefail

# Run a command, capture its output and status without pipefail confusing the two.
run() { OUT="$("$@" 2>&1)"; STATUS=$?; }
cd "$(dirname "$0")"
fails=0
ok()   { printf '  PASS  %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fails=$((fails+1)); }

# 1 — an unnamed target must refuse, because a default is how a staging build
#     reaches production.
run ./deploy-brain.sh rc-control
if [ "$STATUS" -ne 0 ] && printf '%s' "$OUT" | grep -q 'target is REQUIRED'; then
  ok "brain: unnamed target refuses (exit $STATUS)"; else bad "brain: unnamed target did NOT refuse"; fi
run ./deploy-consumer.sh rc-control
if [ "$STATUS" -ne 0 ] && printf '%s' "$OUT" | grep -q 'target is REQUIRED'; then
  ok "consumer: unnamed target refuses (exit $STATUS)"; else bad "consumer: unnamed target did NOT refuse"; fi

# 2 — an unknown target must refuse rather than fall back to anything.
run ./deploy-brain.sh --target prod rc-control
if [ "$STATUS" -ne 0 ] && printf '%s' "$OUT" | grep -q "unknown target"; then
  ok "brain: unknown target refuses (exit $STATUS)"; else bad "brain: unknown target did NOT refuse"; fi

# 3 — no host literal may reappear in executable lines. The scripts once
#     carried `HOST=migrapilot-app-core`, which is what made a production
#     deployment look like a release name.
for f in deploy-brain.sh deploy-consumer.sh; do
  if grep -vE '^\s*#' "$f" | grep -q 'migrapilot-app-core'; then
    bad "$f: a host literal is back in executable code"
  else ok "$f: no host literal in executable code"; fi
done

# 4 — the two targets must not share a runtime authority. Sharing any one of
#     these would make them one runtime with two names.
for var in DEPLOY_HOST DEPLOY_BRAIN_ROOT DEPLOY_BRAIN_UNIT DEPLOY_CONSUMER_ROOT \
           DEPLOY_CONSUMER_UNIT DEPLOY_ENV_FILE DEPLOY_CONSUMER_ENV_FILE \
           DEPLOY_DB_AUTHORITY DEPLOY_PUBLIC_HOST; do
  p=$(bash -c ". ./deploy-targets.sh; deploy_target production >/dev/null; echo \"\${$var}\"")
  s=$(bash -c ". ./deploy-targets.sh; deploy_target staging   >/dev/null; echo \"\${$var}\"")
  if [ -n "$p" ] && [ "$p" = "$s" ]; then
    bad "$var is SHARED between production and staging ($p)"
  else ok "$var differs between targets"; fi
done

# 5 — the fingerprint must name the artifact before acceptance can start.
REPO="$(cd ../.. && pwd)"
fp=$(bash -c ". ./deploy-targets.sh; deploy_target staging >/dev/null; deploy_fingerprint '$REPO' staging rc-control '$REPO/apps/brain-service/dist' '' 28")
for field in target= release= commit= short= branch= dirty= schemaVersion= brainBuildId= consumerBuildId= configFingerprint= deployedAt=; do
  if printf '%s' "$fp" | grep -q "$field"; then ok "fingerprint carries $field"
  else bad "fingerprint is missing $field"; fi
done

# 6 — the build identity must be CONTENT, not git metadata. A rebuild that
#     changes nothing must produce the same digest, or the digest cannot answer
#     "is this the same artifact" — which is the whole point of recording it.
d1=$(bash -c ". ./deploy-targets.sh; deploy_content_digest '$REPO/apps/brain-service/dist'")
d2=$(bash -c ". ./deploy-targets.sh; deploy_content_digest '$REPO/apps/brain-service/dist'")
if [ -n "$d1" ] && [ "$d1" = "$d2" ]; then ok "content digest is stable across runs"
else bad "content digest is unstable ($d1 vs $d2)"; fi

# 7 — the config fingerprint must DIFFER between targets, or an acceptance
#     record could not tell which runtime authority it tested.
c_prod=$(bash -c ". ./deploy-targets.sh; deploy_target production >/dev/null; deploy_fingerprint '$REPO' production r '' '' 26" | grep '^configFingerprint=')
c_stag=$(bash -c ". ./deploy-targets.sh; deploy_target staging   >/dev/null; deploy_fingerprint '$REPO' staging   r '' '' 28" | grep '^configFingerprint=')
if [ "$c_prod" != "$c_stag" ]; then ok "config fingerprint differs between targets"
else bad "config fingerprint is IDENTICAL across targets"; fi

printf '\n'
if [ "$fails" -eq 0 ]; then echo "DEPLOY TARGET CONTROLS PASSED"; else
  echo "DEPLOY TARGET CONTROLS FAILED: $fails"; exit 1; fi