#!/usr/bin/env bash
# STAGE INTERNAL WORKSPACE PACKAGES FROM *THIS* BUILD, AND PROVE IT.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 THE DEFECT THIS EXISTS FOR
#
# Both release scripts hardlink node_modules from the previous release:
#
#   sudo cp -al $PREVIOUS/node_modules $RELEASE/node_modules
#
# That is RIGHT for third-party packages — the release flow has no lockfile
# step, so a fresh install would be a different tree from the one production has
# been running, and the difference would surface only at runtime.
#
# It is WRONG for workspace packages, which are built from the very commit being
# deployed. `chat-platform-rc-0907` inherited a `@migrapilot/shared-types` built
# three days earlier and aborted at the boot test on a missing export. Every
# local gate passed, because the repo resolves that specifier through a symlink
# to freshly built output while the artifact carries a copied snapshot.
#
# ─────────────────────────────────────────────────────────────────────────────
# 🚨 WHY IT REPLACES RATHER THAN WRITES
#
# `cp -al` creates HARDLINKS. Writing into a staged file would edit the SAME
# INODE the previous release serves — silently mutating the rollback target,
# which is the one thing a deploy must never do. So each package directory is
# REMOVED and re-extracted: unlink breaks the link, and the new file is a new
# inode. The rollback release keeps its own bytes.
#
# ─────────────────────────────────────────────────────────────────────────────
# Usage: stage-workspace-deps.sh <repo> <app-dir> <host> <release-dir>
set -euo pipefail

REPO="${1:?repo}"; APP="${2:?app dir}"; HOST="${3:?host}"; RELEASE="${4:?release dir}"
# The release a rollback would return to. Optional only so the script stays
# usable in isolation; when present its bytes are proven UNCHANGED across
# staging, which is the second failure direction — a corrupted way back.
ROLLBACK="${5:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"

fail() { echo "   ✗ $*" >&2; exit 1; }

# Discovered from package metadata, never a handwritten list: a dependency added
# next month must be staged without anyone remembering this file exists.
mapfile -t DEPS < <(node -e "
  const p=require('$APP/package.json');
  const all={...p.dependencies,...p.optionalDependencies};
  for (const [name, spec] of Object.entries(all)) {
    // A workspace package is one this repo builds: scoped to @migrapilot, or
    // linked by file:. Anything else is third-party and stays inherited.
    if (name.startsWith('@migrapilot/') || String(spec).startsWith('file:')) console.log(name);
  }
")

[ "${#DEPS[@]}" -eq 0 ] && { echo "   no workspace dependencies to stage"; exit 0; }
echo "   workspace dependencies: ${DEPS[*]}"

HERE_DIGEST_REMOTE=/tmp/workspace-digest.mjs
scp -q "$HERE/workspace-digest.mjs" "$HOST:$HERE_DIGEST_REMOTE"

# ── rollback fingerprint, BEFORE anything is written ────────────────────────
# Captured first so "unchanged" is a comparison rather than an assumption. The
# hazard is specific: cp -al hardlinks, so a staging step that wrote through a
# link would edit the very bytes a rollback depends on.
declare -A ROLLBACK_BEFORE=()
if [ -n "$ROLLBACK" ]; then
  for NAME in "${DEPS[@]}"; do
    ROLLBACK_BEFORE[$NAME]="$(ssh -n "$HOST" \
      "node $HERE_DIGEST_REMOTE '$ROLLBACK/node_modules/$NAME' 2>/dev/null || echo '{\"ok\":false}'")"
  done
  echo "   rollback fingerprint captured for ${#DEPS[@]} package(s)"
fi

for NAME in "${DEPS[@]}"; do
  SHORT="${NAME#@migrapilot/}"
  SRC="$REPO/packages/$SHORT"
  [ -d "$SRC" ] || SRC="$(node -e "
      const p=require('$APP/package.json');
      const spec={...p.dependencies}['$NAME'] ?? '';
      console.log(spec.startsWith('file:') ? require('node:path').resolve('$APP', spec.slice(5)) : '');
  ")"
  [ -n "$SRC" ] && [ -d "$SRC" ] || fail "$NAME: cannot locate its workspace source"
  [ -d "$SRC/dist" ] || fail "$NAME: has no dist/ — build the workspace before staging"

  # Break the hardlink by REMOVING, then extract. See the header.
  ssh -n "$HOST" "sudo rm -rf --one-file-system '$RELEASE/node_modules/$NAME' \
    && sudo mkdir -p '$RELEASE/node_modules/$NAME' \
    && sudo chown \$(id -un):\$(id -gn) '$RELEASE/node_modules/$NAME'"
  tar -C "$SRC" -czf - dist package.json \
    | ssh "$HOST" "tar -C '$RELEASE/node_modules/$NAME' -xzf -"
  echo "   staged $NAME from this build"
done

# ── the gate ────────────────────────────────────────────────────────────────
# Compare what was BUILT against what Node will RESOLVE in the release. A stale
# package that still satisfies every import produces no error at all — just old
# behaviour — so bytes are compared rather than trusting the copy succeeded.
echo "   verifying staged workspace packages against the build"

for NAME in "${DEPS[@]}"; do
  SHORT="${NAME#@migrapilot/}"
  SRC="$REPO/packages/$SHORT"
  [ -d "$SRC" ] || SRC="$(node -e "
      const p=require('$APP/package.json');
      const spec={...p.dependencies}['$NAME'] ?? '';
      console.log(spec.startsWith('file:') ? require('node:path').resolve('$APP', spec.slice(5)) : '');
  ")"

  LOCAL="$(node "$HERE/workspace-digest.mjs" "$SRC")"
  STAGED="$(ssh -n "$HOST" "node /tmp/workspace-digest.mjs '$RELEASE/node_modules/$NAME'")"

  node -e "
    const local = JSON.parse(process.argv[1]);
    const staged = JSON.parse(process.argv[2]);
    const name = '$NAME';
    const die = (m) => { console.error('   ✗ ' + name + ': ' + m); process.exit(1); };

    if (!local.ok)  die('the LOCAL build is not usable — ' + (local.error ?? 'unknown'));
    if (!staged.ok) die('the STAGED package is not loadable — ' + (staged.error ?? 'unknown'));
    if (staged.missingTargets?.length) die('missing export targets: ' + staged.missingTargets.join(', '));
    if (local.distDigest !== staged.distDigest) {
      die('STALE OR DIVERGENT — the release would run different bytes than were tested.\n' +
          '       built:  ' + local.distDigest.slice(0,16) + '… (' + local.distFiles + ' files)\n' +
          '       staged: ' + staged.distDigest.slice(0,16) + '… (' + staged.distFiles + ' files)');
    }
    console.log('   ✓ ' + name + ' ' + staged.version + '  ' + staged.distDigest.slice(0,16) + '…  '
                + staged.distFiles + ' files, ' + staged.runtimeTargets + ' export targets');
  " "$LOCAL" "$STAGED" || fail "workspace staging verification failed for $NAME"
done

echo "   ✓ staged bytes match the build (direction 1 of 2)"

# ── direction 2: the way back is still intact ──────────────────────────────
if [ -n "$ROLLBACK" ]; then
  for NAME in "${DEPS[@]}"; do
    AFTER="$(ssh -n "$HOST" "node $HERE_DIGEST_REMOTE '$ROLLBACK/node_modules/$NAME' 2>/dev/null || echo '{\"ok\":false}'")"
    node -e "
      const before = JSON.parse(process.argv[1]); const after = JSON.parse(process.argv[2]);
      const name = process.argv[3];
      if (before.distDigest !== after.distDigest) {
        console.error('   ✗ ROLLBACK RELEASE WAS MUTATED for ' + name + '.');
        console.error('     Staging wrote through a hardlink and changed the bytes a rollback');
        console.error('     depends on. The way back is no longer the release that was running.');
        console.error('     before: ' + String(before.distDigest).slice(0,16) + '…');
        console.error('     after:  ' + String(after.distDigest).slice(0,16) + '…');
        process.exit(1);
      }
    " "${ROLLBACK_BEFORE[$NAME]}" "$AFTER" "$NAME" || fail "rollback integrity check failed for $NAME"
  done
  echo "   ✓ rollback release bytes unchanged (direction 2 of 2)"
fi

ssh -n "$HOST" "rm -f $HERE_DIGEST_REMOTE" || true
echo "   all workspace dependencies match the build they were tested against"
