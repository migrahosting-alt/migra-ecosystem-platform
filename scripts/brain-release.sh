#!/usr/bin/env bash
#
# Hardened brain-service release: source + lockfile -> install exact production
# deps -> verify -> boot-test -> atomically activate -> health-check -> rollback.
#
# WHY THIS EXISTS
# ---------------
# Releases used to be seeded by `cp -al` from the previous release, so
# node_modules was an inherited artifact that nothing checked against
# package.json. That is not a theoretical risk: the CONSUMER tree already
# demonstrates it, carrying 5 declared runtime dependencies that are absent from
# the deployed node_modules. It stays invisible there only because Next bundles
# them into .next at build time.
#
# brain-service has no such safety net. It runs `node dist/src/server.js`
# directly, so its runtime node_modules is load-bearing, and a missing dependency
# is a crash at require() time — in production, after activation.
#
# This script never inherits a previous node_modules. Every release installs from
# the repo lockfile, and a release that cannot prove its dependencies is never
# activated.
#
# RUNS ON THE TARGET (VM111) AS ROOT. The payload is built by the caller; see
# `build_payload` in the companion notes at the bottom of this file.
#
set -euo pipefail

APP_ROOT=/opt/migrapilot/brain-service
SERVICE=migrapilot-brain.service
HEALTH_URL=http://127.0.0.1:3988/health
BOOT_TEST_PORT=3991

usage() {
  cat >&2 <<'USAGE'
usage: brain-release.sh --payload <tarball> --name <release-name> [--activate]

  --payload    tarball holding: package.json, package-lock.json, every workspace
               package.json, apps/brain-service/{package.json,dist} and
               packages/*/{package.json,dist}
  --name       release directory name under releases/
  --activate   flip the `current` symlink and restart. WITHOUT this flag the
               script installs, verifies and boot-tests, then STOPS — the running
               service is left completely untouched.
USAGE
  exit 2
}

PAYLOAD="" ; NAME="" ; ACTIVATE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --payload) PAYLOAD="${2:-}" ; shift 2 ;;
    --name)    NAME="${2:-}"    ; shift 2 ;;
    --activate) ACTIVATE=1      ; shift ;;
    *) echo "unknown arg: $1" >&2 ; usage ;;
  esac
done
[ -n "$PAYLOAD" ] && [ -n "$NAME" ] || usage
[ -f "$PAYLOAD" ] || { echo "payload not found: $PAYLOAD" >&2 ; exit 2 ; }

STAGE="$APP_ROOT/staging/$NAME"
RELEASE="$APP_ROOT/releases/$NAME"
[ -e "$RELEASE" ] && { echo "release already exists: $RELEASE" >&2 ; exit 2 ; }

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*" ; }

step "1/7 unpack payload into staging"
mkdir -p "$STAGE"
tar -xzf "$PAYLOAD" -C "$STAGE"

# The root `prepare` hook runs husky, which is a devDependency. Under
# --omit=dev it is by definition absent, so the hook fails with `husky: not
# found` and npm exits 127 — taking the whole install down with it. Stripping
# the hook is safe: `npm ci` validates the lockfile against DEPENDENCIES, not
# scripts. Verified on the target: with the hook present npm exits 127, without
# it npm exits 0 and installs all 154 packages.
step "2/7 strip the dev-only prepare hook"
node -e '
  const f = process.argv[1] + "/package.json";
  const pkg = require(f);
  if (pkg.scripts && pkg.scripts.prepare) {
    delete pkg.scripts.prepare;
    require("fs").writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
    console.log("   removed scripts.prepare");
  } else {
    console.log("   no prepare hook present");
  }
' "$STAGE"

# `npm ci` — not `npm install`. ci refuses to proceed when package.json and the
# lockfile disagree, which is exactly the guarantee this slice is buying: the
# release is reproducible from repo state rather than from whatever the previous
# release happened to contain.
step "3/7 install exact production dependencies from the lockfile"
( cd "$STAGE" && npm ci --omit=dev \
    --workspace @migrapilot/brain-service --include-workspace-root ) \
  || { echo "INSTALL FAILED — refusing to build a release" >&2 ; exit 1 ; }

step "4/7 assemble the release (dist + package.json + node_modules)"
# Layout is deliberately IDENTICAL to the existing releases so systemd's
# ExecStart path and the rollback chain keep working untouched.
mkdir -p "$RELEASE"
cp -a "$STAGE/apps/brain-service/dist"         "$RELEASE/dist"
cp -a "$STAGE/apps/brain-service/package.json" "$RELEASE/package.json"
# -L dereferences the workspace symlinks npm created, so @migrapilot/* land as
# real directories — matching how the current production release is laid out,
# and leaving the release self-contained rather than pointing back at staging.
cp -rL "$STAGE/node_modules" "$RELEASE/node_modules"

# NESTED workspace deps must be overlaid, and this is not a detail: npm nests a
# package under apps/brain-service/node_modules whenever the workspace needs a
# different version than the hoisted one. pngjs is exactly that case — the root
# tree holds 5.0.0 while brain-service declares ^7.0.0 — and
# engine/media/glyphRender.ts imports it at runtime. Copying only the hoisted
# tree produced a release that resolved 12 of 13 dependencies and would have
# crashed with MODULE_NOT_FOUND the first time glyph rendering ran.
# Nested wins on purpose: the nested copy exists BECAUSE the hoisted version is
# wrong for this workspace.
NESTED="$STAGE/apps/brain-service/node_modules"
if [ -d "$NESTED" ]; then
  echo "   overlaying nested workspace deps: $(ls "$NESTED" | grep -v '^\.' | tr '\n' ' ')"
  cp -rL "$NESTED/." "$RELEASE/node_modules/"
fi

step "5/7 verify every declared runtime dependency actually loads"
node -e '
  const path = require("path");
  const { createRequire } = require("module");
  const release = process.argv[1];
  const pkg = require(path.join(release, "package.json"));
  const req = createRequire(path.join(release, "dist", "src", "server.js"));
  const deps = Object.keys(pkg.dependencies || {});
  const missing = [];
  for (const dep of deps) {
    // Resolve the packages entry point the way node will at runtime. A bare
    // specifier respects "exports"; a deep import into package.json does NOT
    // and produces false negatives, which cost a debugging cycle to notice.
    try { req.resolve(dep); }
    catch (err) {
      try { req.resolve(dep + "/package.json"); }
      catch { missing.push(dep + " (" + err.code + ")"); }
    }
  }
  if (!require("fs").existsSync(path.join(release, "dist", "src", "server.js")))
    missing.push("dist/src/server.js (entry point)");
  console.log("   declared:", deps.length, "| unresolvable:", missing.length ? missing : "none");
  if (missing.length) { console.error("VERIFY FAILED"); process.exit(1); }
' "$RELEASE" || { echo "VERIFICATION FAILED — release will NOT be activated" >&2 ; exit 1 ; }

step "6/7 boot-test the release on port $BOOT_TEST_PORT"
# Proves the release actually starts before it is allowed anywhere near the live
# symlink. A release that installs and resolves can still die on boot.
# The port variable is MIGRAPILOT_BRAIN_PORT, not PORT.
#
# And the override CANNOT be passed with --setenv: systemd applies Environment=
# first and lets EnvironmentFile= override it, so brain.env's own
# MIGRAPILOT_BRAIN_PORT=3988 silently wins. The brain then finds 3988 already
# held by the live service and logs "port already in use; reusing the existing
# healthy local service" — it never listens on the test port, and the boot test
# fails while the release itself is perfectly fine.
# So the override goes in its own env file, listed LAST, because the last
# EnvironmentFile wins.
BOOT_UNIT="brain-boottest-$NAME"
BOOT_ENV="$STAGE/boottest.env"
printf 'MIGRAPILOT_BRAIN_PORT=%s\n' "$BOOT_TEST_PORT" > "$BOOT_ENV"
systemctl reset-failed "$BOOT_UNIT" >/dev/null 2>&1 || true
systemd-run --unit="$BOOT_UNIT" --property=Type=simple --collect \
  --property=EnvironmentFile=/etc/migrapilot/brain.env \
  --property=EnvironmentFile=-/etc/migrapilot/brain-postgres.env \
  --property=EnvironmentFile="$BOOT_ENV" \
  /usr/bin/node "$RELEASE/dist/src/server.js" >/dev/null 2>&1 || true
BOOT_OK=0
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "http://127.0.0.1:$BOOT_TEST_PORT/health" >/dev/null 2>&1; then BOOT_OK=1 ; break ; fi
  sleep 2
done
systemctl stop "$BOOT_UNIT" >/dev/null 2>&1 || true
[ "$BOOT_OK" = 1 ] || { echo "BOOT TEST FAILED — release will NOT be activated" >&2 ; exit 1 ; }
echo "   boot test passed"

if [ "$ACTIVATE" != 1 ]; then
  step "7/7 STOPPING — verified but not activated (no --activate)"
  echo "   release ready at: $RELEASE"
  echo "   live service untouched: $(readlink -f "$APP_ROOT/current")"
  exit 0
fi

step "7/7 activate atomically, then health-check with rollback"
PREVIOUS="$(readlink -f "$APP_ROOT/current" || true)"
ln -sfn "$RELEASE" "$APP_ROOT/current.new"
mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"   # atomic rename
systemctl restart "$SERVICE"

HEALTHY=0
for _ in $(seq 1 30); do
  if curl -fsS -m 3 "$HEALTH_URL" >/dev/null 2>&1; then HEALTHY=1 ; break ; fi
  sleep 2
done

if [ "$HEALTHY" != 1 ] && [ -n "$PREVIOUS" ]; then
  echo "HEALTH CHECK FAILED — rolling back to $PREVIOUS" >&2
  ln -sfn "$PREVIOUS" "$APP_ROOT/current.new"
  mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
  systemctl restart "$SERVICE"
  exit 1
fi

echo "   activated: $RELEASE"
echo "   rollback target: ${PREVIOUS:-none}"

# ── Building the payload (run from the repo root on the dev machine) ──────────
#
#   npm run build -w @migrapilot/brain-service     # tsc -b builds workspace deps too
#   tar -czf /tmp/brain-payload.tgz \
#     package.json package-lock.json \
#     apps/*/package.json packages/*/package.json \
#     apps/brain-service/dist packages/*/dist
#
# Then copy it to the target and run this script there.
