#!/usr/bin/env bash
#
# THE DEPLOY TARGET CONTRACT — where a build is allowed to land, stated once.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 WHY THIS EXISTS
#
# `deploy-brain.sh` and `deploy-consumer.sh` carried `HOST=migrapilot-app-core`
# as a literal. There was exactly one place a build could go, it was PRODUCTION,
# and nothing in the invocation said so. `deploy-brain.sh rc-0909` reads like a
# release name and is in fact a production deployment.
#
# That was survivable while production was the only environment. It stops being
# survivable the moment a staging environment exists, because the two
# invocations would look identical and differ only in which script somebody
# remembered to edit.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 THERE IS NO DEFAULT TARGET
#
# Deliberately. A default is what "VM111 unless otherwise stated" already was,
# and the failure mode of a wrong default is a production deployment nobody
# intended. An unnamed target FAILS, which costs one retyped word.
#
# ─────────────────────────────────────────────────────────────────────────────
# SAME ARTIFACT, DIFFERENT RUNTIME AUTHORITY
#
# A target names WHERE a build runs and WHAT it answers to — host, service unit,
# release root, ports, public hostname, secrets authority, database authority.
# It does NOT name behaviour. There is no staging mode and no production mode:
# an environment full of behavioural exceptions is an environment that proves
# nothing about the build you later promote.

set -uo pipefail

# ── the targets ─────────────────────────────────────────────────────────────
#
# Each is a flat set of variables, because a deploy script needs them in the
# shell and a nested format would be parsed by hand at exactly the wrong moment.

deploy_target() {
  local name="${1:-}"
  case "$name" in
    production)
      DEPLOY_TARGET_NAME=production
      DEPLOY_HOST=migrapilot-app-core
      DEPLOY_BRAIN_ROOT=/opt/migrapilot/brain-service
      DEPLOY_BRAIN_UNIT=migrapilot-brain.service
      DEPLOY_BRAIN_BIND=127.0.0.1
      DEPLOY_BRAIN_PORT=3988
      DEPLOY_BRAIN_BOOT_PORT=3987
      DEPLOY_CONSUMER_ROOT=/opt/migrapilot/consumer
      DEPLOY_CONSUMER_UNIT=migrapilot-consumer.service
      DEPLOY_CONSUMER_BIND=10.10.0.13
      DEPLOY_CONSUMER_PORT=3000
      DEPLOY_PUBLIC_HOST=chat.migrateck.com
      DEPLOY_ENV_FILE=/etc/migrapilot/brain.env
      DEPLOY_CONSUMER_ENV_FILE=/etc/migrapilot/consumer.env
      # 🚨 Named so a deploy cannot silently point a staging build at the
      # production database, which is the one mistake with no rollback.
      DEPLOY_DB_AUTHORITY=migrapilot-production
      ;;
    staging)
      DEPLOY_TARGET_NAME=staging
      DEPLOY_HOST=migrapilot-staging-core
      DEPLOY_BRAIN_ROOT=/opt/migrapilot-staging/brain-service
      DEPLOY_BRAIN_UNIT=migrapilot-staging-brain.service
      DEPLOY_BRAIN_BIND=127.0.0.1
      DEPLOY_BRAIN_PORT=3988
      DEPLOY_BRAIN_BOOT_PORT=3987
      DEPLOY_CONSUMER_ROOT=/opt/migrapilot-staging/consumer
      DEPLOY_CONSUMER_UNIT=migrapilot-staging-consumer.service
      DEPLOY_CONSUMER_BIND=127.0.0.1
      DEPLOY_CONSUMER_PORT=3000
      DEPLOY_PUBLIC_HOST=staging-chat.migrateck.com
      DEPLOY_ENV_FILE=/etc/migrapilot-staging/brain.env
      DEPLOY_CONSUMER_ENV_FILE=/etc/migrapilot-staging/consumer.env
      DEPLOY_DB_AUTHORITY=migrapilot-staging
      ;;
    '')
      echo "deploy: --target is REQUIRED. There is no default, deliberately:" >&2
      echo "  a default target is how a staging build reaches production." >&2
      echo "  known targets: production staging" >&2
      return 2
      ;;
    *)
      echo "deploy: unknown target '$name'. known targets: production staging" >&2
      return 2
      ;;
  esac

  # Nothing may share a service unit, a release root, an env file or a database
  # authority across targets — that is what keeps them separate runtimes rather
  # than one runtime with two names.
  export DEPLOY_TARGET_NAME DEPLOY_HOST \
         DEPLOY_BRAIN_ROOT DEPLOY_BRAIN_UNIT DEPLOY_BRAIN_BIND DEPLOY_BRAIN_PORT DEPLOY_BRAIN_BOOT_PORT \
         DEPLOY_CONSUMER_ROOT DEPLOY_CONSUMER_UNIT DEPLOY_CONSUMER_BIND DEPLOY_CONSUMER_PORT \
         DEPLOY_PUBLIC_HOST DEPLOY_ENV_FILE DEPLOY_CONSUMER_ENV_FILE DEPLOY_DB_AUTHORITY
}

# ── the release fingerprint ────────────────────────────────────────────────
#
# 🚨 RECORDED BEFORE ACCEPTANCE STARTS, not after. Acceptance evidence that
# cannot name the artifact it tested proves nothing about the artifact later
# promoted — a truthful harness once "passed" while production served
# three-day-old code.
#
# 🚨 AND GIT METADATA IS NOT AN ARTIFACT IDENTITY.
#
# A commit says what the SOURCE was. It does not say what was BUILT: workspace
# dependencies are npm-hoisted locally and resolve differently in a clean
# checkout, and Next emits a build id that changes independently of any commit.
# Two deploys of one commit can therefore run different code, which is exactly
# the stale-runtime problem this project has already been bitten by.
#
# So the record binds to CONTENT — a digest over the built closure — with the
# Git fields kept as provenance rather than as identity.
deploy_content_digest() {
  local dir="${1:?built directory}"
  # Every file's path and bytes, order-stable, hashed once. Not mtimes: a
  # rebuild that changes nothing must produce the same digest, or the digest
  # cannot answer "is this the same artifact".
  ( cd "$dir" && find . -type f ! -name RELEASE.json -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 sha256sum \
      | sha256sum | cut -d" " -f1 )
}

# The acceptance record. Every field is something a later promotion decision
# needs, and nothing here is inferred at read time.
deploy_fingerprint() {
  local repo="${1:?repo path}" target="${2:?target}" release="${3:?release}"
  local brain_dist="${4:-}" consumer_dist="${5:-}" schema="${6:-unknown}"

  printf 'target=%s\n'              "$target"
  printf 'release=%s\n'             "$release"
  printf 'commit=%s\n'              "$(git -C "$repo" rev-parse HEAD)"
  printf 'short=%s\n'               "$(git -C "$repo" rev-parse --short HEAD)"
  printf 'branch=%s\n'              "$(git -C "$repo" rev-parse --abbrev-ref HEAD)"
  printf 'dirty=%s\n'               "$(test -n "$(git -C "$repo" status --porcelain)" && echo yes || echo no)"
  printf 'schemaVersion=%s\n'       "$schema"
  printf 'brainBuildId=%s\n'        "$([ -n "$brain_dist" ] && [ -d "$brain_dist" ] && deploy_content_digest "$brain_dist" || echo unbuilt)"
  printf 'consumerBuildId=%s\n'     "$([ -n "$consumer_dist" ] && [ -d "$consumer_dist" ] && deploy_content_digest "$consumer_dist" || echo unbuilt)"
  # The runtime authority this build will answer to — the half a commit cannot
  # express, and the half that decides which database it opens.
  printf 'configFingerprint=%s\n'   "$(printf '%s|%s|%s|%s|%s' \
      "$DEPLOY_HOST" "$DEPLOY_ENV_FILE" "$DEPLOY_CONSUMER_ENV_FILE" \
      "$DEPLOY_DB_AUTHORITY" "$DEPLOY_PUBLIC_HOST" | sha256sum | cut -d" " -f1)"
  printf 'deployedAt=%s\n'          "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
