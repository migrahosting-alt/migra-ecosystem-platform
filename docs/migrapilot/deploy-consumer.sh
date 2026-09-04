#!/usr/bin/env bash
#
# Deploy the MigraPilot consumer to VM111.
#
# 🚨 WHY THIS EXISTS AS A SCRIPT. The 2026-09-04 identifier-refusal acceptance
# failure was not a code defect. "What is the total ZipCode in this file?"
# returned 132,737 in the real product because production was serving a build
# from three days earlier — so a fix that was committed, tested, mutation-proven
# and pushed was invisible to the person testing the product. Every step below is
# one somebody has to remember otherwise, and the last one is the step that would
# have caught that failure before a human did.
#
# Requires root on VM111 for the release directory and the systemd restart, which
# is inside the owner's bounded VM111 elevation (paths under /opt/migrapilot and
# migrapilot-* units only).
#
#   usage:  scripts/migrapilot/deploy-consumer.sh <release-name>
#   e.g.    scripts/migrapilot/deploy-consumer.sh identifier-09040504
#
set -euo pipefail

REL="${1:?usage: deploy-consumer.sh <release-name>}"
APP="$(cd "$(dirname "$0")/../../apps/migrapilot-consumer" && pwd)"
HOST=migrapilot-app-core
ROOT=/opt/migrapilot/consumer

echo "==> nothing uncommitted may ship"
# A release built from a dirty tree is a release nobody can reproduce — which is
# the same family of problem as the untracked source this repo already fixed.
git -C "$APP" diff --quiet -- . || { echo "consumer working tree is dirty; commit first"; exit 1; }
echo "    HEAD: $(git -C "$APP" rev-parse --short HEAD)"

echo "==> the gate, not a subset of it"
( cd "$APP" && npm run verify )

echo "==> the live release, which is also the rollback target"
PREVIOUS="$(ssh "$HOST" "readlink $ROOT/current")"
echo "    rollback target: $PREVIOUS"

echo "==> staging $REL"
ssh "$HOST" "sudo mkdir -p $ROOT/releases/$REL && sudo chown \$(id -un):\$(id -gn) $ROOT/releases/$REL"
tar -C "$APP" -czf - --exclude='.next/cache' .next package.json next.config.ts public \
  | ssh "$HOST" "tar -C $ROOT/releases/$REL -xzf -"

# node_modules is HARDLINKED from the live release rather than installed. The
# release flow has no lockfile step, so a fresh install here would produce a
# different tree from the one production has been running — and the difference
# would only show up at runtime.
echo "==> hardlinking node_modules from the live release"
ssh "$HOST" "sudo cp -al $ROOT/current/node_modules $ROOT/releases/$REL/node_modules"

# 🚨 BOOT IT BEFORE SWAPPING THE SYMLINK. A release that cannot start is
# discovered here, on a spare port, rather than by the first user after the swap.
echo "==> boot test on a spare port"
ssh "$HOST" "cd $ROOT/releases/$REL && \
  sudo -u migrapilot env \$(grep -v '^#' /etc/migrapilot/consumer.env | xargs) \
    node node_modules/next/dist/bin/next start -p 3097 -H 127.0.0.1 >/tmp/$REL-boot.log 2>&1 & \
  sleep 12; \
  code=\$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1:3097/ || echo 000); \
  echo \"    boot test: \$code\"; \
  pkill -f 'next start -p 3097' || true; \
  [ \"\$code\" = 200 ]"

echo "==> swapping and restarting"
ssh "$HOST" "sudo ln -sfn $ROOT/releases/$REL $ROOT/current && \
  sudo systemctl restart migrapilot-consumer.service && sleep 5 && \
  systemctl is-active migrapilot-consumer.service"

# 🚨 THE STEP THAT WOULD HAVE CAUGHT THE 09-04 FAILURE. Proving the artifact that
# is SERVING contains the code you think you shipped, rather than assuming the
# symlink swap means what it looks like it means.
echo "==> proving the serving bundle is the code that was just built"
ssh "$HOST" "grep -rlq 'identifies rows rather than measuring them' $ROOT/current/.next \
  && echo '    identifier rule present in the serving bundle' \
  || { echo '    WARNING: rule NOT found in the serving bundle — wrong artifact'; exit 1; }"

echo
echo "deployed $REL"
echo "rollback: ssh $HOST \"sudo ln -sfn $ROOT/releases/$PREVIOUS $ROOT/current && sudo systemctl restart migrapilot-consumer.service\""
