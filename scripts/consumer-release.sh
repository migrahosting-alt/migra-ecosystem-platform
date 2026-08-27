#!/usr/bin/env bash
#
# Hardened consumer release: source + lockfile -> install exact production deps
# -> verify -> boot-test -> atomically activate -> health-check -> rollback,
# then PROVE the new release does not depend on the one it replaced.
#
# WHY THIS EXISTS
# ---------------
# Consumer releases used to inherit `node_modules` by copying it out of the
# outgoing release. Every deploy therefore carried forward whatever the previous
# one happened to contain, and nothing ever checked that against package.json.
# The Brain's own release script names the consumer as the standing example:
# five declared runtime dependencies are absent from the deployed tree and it
# stays invisible only because Next bundles them into `.next` at build time.
#
# "Invisible" is the problem. The day a dependency stops being bundled — a new
# import from a route handler, a package marked external, a Next upgrade that
# changes what it inlines — the release is already broken and nothing said so.
#
# This script never copies node_modules from anywhere. Every release installs
# from the repo lockfile, and a release that cannot prove its dependencies is
# never activated.
#
# RUNS ON THE TARGET (VM111) AS ROOT. Build the payload with `build_payload`
# in the companion notes at the bottom.
#
set -euo pipefail

APP_ROOT=/opt/migrapilot/consumer
SERVICE=migrapilot-consumer.service
HEALTH_URL=http://10.10.0.13:3000/
BOOT_TEST_PORT=3001
WORKSPACE=migrapilot-consumer

PAYLOAD=""; NAME=""; ACTIVATE=0; MARKER=""
usage() {
  cat >&2 <<'USAGE'
usage: consumer-release.sh --payload <tarball> --name <release-name> [--activate] [--marker <string>]

  --marker  a string that must appear in .next/server for the release to be
            promoted. Use it to assert THIS build is the one being shipped.
USAGE
  exit 2
}
while [ $# -gt 0 ]; do
  case "$1" in
    --payload) PAYLOAD="$2"; shift 2 ;;
    --name)    NAME="$2";    shift 2 ;;
    --marker)  MARKER="$2";  shift 2 ;;
    --activate) ACTIVATE=1;  shift ;;
    *) echo "unknown arg: $1" >&2; usage ;;
  esac
done
[ -n "$PAYLOAD" ] && [ -n "$NAME" ] || usage
[ -f "$PAYLOAD" ] || { echo "payload not found: $PAYLOAD" >&2; exit 2; }

STAGE="$APP_ROOT/staging/$NAME"
RELEASE="$APP_ROOT/releases/$NAME"
PREVIOUS="$(readlink -f "$APP_ROOT/current" || true)"

# This script deletes exactly one thing: the staging tree IT created, at a path
# derived from --name, and only after the release is assembled. It never
# removes a release, and a path that already exists is a question for a person
# rather than something to clear away.
[ -e "$RELEASE" ] && { echo "release already exists: $RELEASE" >&2; exit 2; }
[ -e "$STAGE" ]   && { echo "staging already exists: $STAGE" >&2; exit 2; }

step() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }

step "1/11 unpack payload into a clean staging tree"
mkdir -p "$STAGE"
tar -xzf "$PAYLOAD" -C "$STAGE"

# The root `prepare` hook runs husky, a devDependency. Under --omit=dev it is by
# definition absent, so the hook fails and npm exits 127, taking the install with
# it. Stripping it is safe: `npm ci` validates the lockfile against DEPENDENCIES,
# not scripts.
step "2/11 strip the dev-only prepare hook"
node -e '
  const f = process.argv[1] + "/package.json";
  const pkg = require(f);
  if (pkg.scripts && pkg.scripts.prepare) {
    delete pkg.scripts.prepare;
    require("fs").writeFileSync(f, JSON.stringify(pkg, null, 2) + "\n");
    console.log("   removed scripts.prepare");
  } else { console.log("   no prepare hook present"); }
' "$STAGE"

# `npm ci`, not `npm install`: ci refuses to proceed when package.json and the
# lockfile disagree, which is the entire guarantee being bought here — the
# release is reproducible from repo state rather than from whatever the previous
# release happened to contain.
step "3/11 install exact production dependencies from the lockfile"
( cd "$STAGE" && npm ci --omit=dev --workspace "$WORKSPACE" --include-workspace-root ) \
  || { echo "INSTALL FAILED — refusing to build a release" >&2; exit 1; }

step "4/11 assemble the release"
mkdir -p "$RELEASE"
cp -a "$STAGE/apps/$WORKSPACE/.next"           "$RELEASE/.next"
cp -a "$STAGE/apps/$WORKSPACE/package.json"    "$RELEASE/package.json"
cp -a "$STAGE/apps/$WORKSPACE/next.config.ts"  "$RELEASE/next.config.ts"
[ -d "$STAGE/apps/$WORKSPACE/public" ] && cp -a "$STAGE/apps/$WORKSPACE/public" "$RELEASE/public"
# -L dereferences the workspace symlinks npm created, so @migrapilot/* and the
# file: dependency land as real directories and the release is self-contained
# rather than pointing back at staging.
cp -rL "$STAGE/node_modules" "$RELEASE/node_modules"
# npm nests a package under the workspace whenever it needs a different version
# than the hoisted one. Nested wins on purpose: it exists BECAUSE the hoisted
# version is wrong for this workspace.
NESTED="$STAGE/apps/$WORKSPACE/node_modules"
if [ -d "$NESTED" ]; then
  echo "   overlaying nested workspace deps: $(ls "$NESTED" | grep -v '^\.' | tr '\n' ' ')"
  cp -rL "$NESTED/." "$RELEASE/node_modules/"
fi

step "5/11 verify every declared runtime dependency resolves FROM THIS RELEASE"
node -e '
  const path = require("path"), fs = require("fs");
  const { createRequire } = require("module");
  const release = process.argv[1];
  const pkg = require(path.join(release, "package.json"));
  const req = createRequire(path.join(release, "package.json"));
  const missing = [];
  for (const dep of Object.keys(pkg.dependencies || {})) {
    // Resolve the way node will at runtime: a bare specifier respects
    // "exports"; a deep import into package.json does not, and produces false
    // negatives.
    try { req.resolve(dep); }
    catch (err) {
      try { req.resolve(dep + "/package.json"); }
      catch { missing.push(dep + " (" + err.code + ")"); }
    }
  }
  // The server is started through this exact file by the unit.
  for (const entry of ["node_modules/next/dist/bin/next", ".next/BUILD_ID"])
    if (!fs.existsSync(path.join(release, entry))) missing.push(entry + " (entry point)");
  console.log("   declared:", Object.keys(pkg.dependencies || {}).length,
              "| unresolvable:", missing.length ? missing : "none");
  if (missing.length) { console.error("VERIFY FAILED"); process.exit(1); }
' "$RELEASE" || { echo "VERIFICATION FAILED — release will NOT be activated" >&2; exit 1; }

step "6/11 assert NOTHING was inherited from the outgoing release"
[ -L "$RELEASE/node_modules" ] && { echo "node_modules is a SYMLINK" >&2; exit 1; }
if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS/node_modules" ]; then
  # A hardlinked tree (`cp -al`) looks like a real directory and is not one.
  # npm's own cache legitimately hardlinks, so link COUNT proves nothing —
  # sharing an inode with the previous RELEASE is what would.
  shared=0
  for probe in next/package.json react/package.json react-dom/package.json; do
    a="$RELEASE/node_modules/$probe"; b="$PREVIOUS/node_modules/$probe"
    [ -f "$a" ] && [ -f "$b" ] || continue
    [ "$(stat -c %i "$a")" = "$(stat -c %i "$b")" ] && { echo "   SHARED INODE: $probe" >&2; shared=1; }
  done
  [ "$shared" = 0 ] || { echo "RELEASE INHERITS THE PREVIOUS node_modules" >&2; exit 1; }
  echo "   no shared inodes with $PREVIOUS"
else
  echo "   no previous release to compare against"
fi

if [ -n "$MARKER" ]; then
  step "6b/11 the expected build is the one being shipped"
  n=$(grep -rho -- "$MARKER" "$RELEASE/.next/server" 2>/dev/null | wc -l)
  [ "$n" -gt 0 ] || { echo "MARKER '$MARKER' ABSENT from .next/server" >&2; exit 1; }
  echo "   found '$MARKER' x$n"
fi

step "7/11 boot-test on port $BOOT_TEST_PORT with the real environment"
set -a; . /etc/migrapilot/consumer.env
[ -f /etc/migrapilot/consumer-auth-origins.env ] && . /etc/migrapilot/consumer-auth-origins.env
set +a
( cd "$RELEASE" && node node_modules/next/dist/bin/next start -p "$BOOT_TEST_PORT" -H 127.0.0.1 \
    >/tmp/consumer-boot.log 2>&1 & echo $! >/tmp/consumer-boot.pid )
BOOT_OK=0
for _ in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:$BOOT_TEST_PORT/" || true)" = "200" ] \
    && { BOOT_OK=1; break; }
  sleep 2
done
kill "$(cat /tmp/consumer-boot.pid)" 2>/dev/null || true; sleep 1
[ "$BOOT_OK" = 1 ] || { echo "BOOT TEST FAILED — not activating" >&2; tail -20 /tmp/consumer-boot.log >&2; exit 1; }
echo "   served HTTP 200 on the spare port"

if [ "$ACTIVATE" != 1 ]; then
  step "8/11 STOPPING — verified but not activated (no --activate)"
  echo "   release ready at: $RELEASE"
  echo "   live service untouched: $PREVIOUS"
  exit 0
fi

step "8/11 activate atomically, then health-check with rollback"
ln -sfn "$RELEASE" "$APP_ROOT/current.new"
mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
systemctl restart "$SERVICE"

HEALTHY=0
for _ in $(seq 1 40); do
  [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$HEALTH_URL" || true)" = "200" ] && { HEALTHY=1; break; }
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

# ── The decisive control ────────────────────────────────────────────────────
#
# Everything above can pass while the release still quietly depends on the tree
# it replaced. The only way to know is to take that tree away and see whether
# this one still boots.
#
# Safe here and nowhere earlier: the new release is already serving, so the
# outgoing one is idle. It is MOVED, never deleted, and restored by a trap so an
# interruption cannot leave the rollback target broken.
step "9/11 prove independence — restart with the outgoing node_modules absent"
if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS/node_modules" ]; then
  HIDDEN="$PREVIOUS/node_modules.hidden-$$"
  restore() {
    [ -d "$HIDDEN" ] && mv -T "$HIDDEN" "$PREVIOUS/node_modules" || true
  }
  trap restore EXIT INT TERM
  mv -T "$PREVIOUS/node_modules" "$HIDDEN"
  systemctl restart "$SERVICE"
  INDEP=0
  for _ in $(seq 1 40); do
    [ "$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$HEALTH_URL" || true)" = "200" ] && { INDEP=1; break; }
    sleep 2
  done
  restore; trap - EXIT INT TERM
  [ "$INDEP" = 1 ] || {
    echo "NOT INDEPENDENT — the release needs the outgoing node_modules. Rolling back." >&2
    ln -sfn "$PREVIOUS" "$APP_ROOT/current.new"; mv -Tf "$APP_ROOT/current.new" "$APP_ROOT/current"
    systemctl restart "$SERVICE"; exit 1
  }
  echo "   booted and served 200 with $PREVIOUS/node_modules absent"
else
  echo "   skipped: no previous node_modules to hide"
fi

step "10/11 the rollback target is still intact"
if [ -n "$PREVIOUS" ]; then
  for entry in .next/BUILD_ID node_modules/next/dist/bin/next package.json; do
    [ -e "$PREVIOUS/$entry" ] || { echo "ROLLBACK TARGET DAMAGED: missing $entry" >&2; exit 1; }
  done
  echo "   rollback target usable: $PREVIOUS"
else
  echo "   no previous release"
fi

# Staging holds a full second copy of node_modules — 530 MB for this app. Left
# behind every run it is the largest avoidable consumer of disk on the box, and
# /opt was already at 92%% when this script was written. Removed only after the
# release is assembled and serving, and only at the exact path built from
# --name, so it cannot reach a release or another deploy's staging tree.
step "11/11 remove this run's staging tree"
if [ -d "$STAGE" ]; then
  case "$STAGE" in
    "$APP_ROOT/staging/$NAME") rm -r "$STAGE"; echo "   removed $STAGE" ;;
    *) echo "   REFUSING: '$STAGE' is not this run's staging path" >&2; exit 1 ;;
  esac
else
  echo "   nothing to remove"
fi

# ── Building the payload (run from the repo root on the dev machine) ──────────
#
#   npm run build -w migrapilot-consumer
#   tar -czf /tmp/consumer-payload.tgz \
#     --exclude='.next/cache' --exclude='.next/dev' \
#     package.json package-lock.json \
#     apps/*/package.json packages/*/package.json packages/*/dist \
#     MigraTeck/packages/auth-client/package.json \
#     MigraTeck/packages/auth-client/dist \
#     apps/migrapilot-consumer/.next \
#     apps/migrapilot-consumer/next.config.ts \
#     apps/migrapilot-consumer/public
#
# `.next/cache` and `.next/dev` are excluded deliberately: cache is build state,
# and `.next/dev` is stale DEV-SERVER output that was shipped to production in
# every earlier release — 207 MB that `next start` never serves.
#
# MigraTeck/packages/auth-client is a `file:` dependency living OUTSIDE the
# workspace globs. Omit it and `npm ci` fails on the target.
