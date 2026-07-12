#!/usr/bin/env bash
#
# Install THE extension. The one you just built. Nothing else.
#
# Why this exists: every GUI failure in the smoke traced back to WHICH extension VS Code
# had loaded, never to the product. F5 (Extension Development Host) loads whatever folder
# VS Code has open — which was a tree stranded on an old branch — and an EDH also OVERRIDES
# any installed copy of the same extension id. So hours were spent debugging features
# against a build that did not contain them.
#
# This removes the entire class of failure:
#   * no F5, no dev host, no --extensionDevelopmentPath
#   * no stale out/ (it always recompiles)
#   * a UNIQUE version every run, because reinstalling the SAME version leaves a running
#     window on the old bundle — that alone cost an afternoon
#   * every previous copy uninstalled first, so nothing can shadow it
#   * it VERIFIES what actually landed on disk, and fails loudly if it did not
#
# Usage:  ./scripts/install-migrapilot.sh
# Then:   close any [Extension Development Host] window, and Developer: Reload Window.

set -euo pipefail

EXT_ID="migrateck.migrapilot-vscode"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

say()  { printf "\n\033[1m%s\033[0m\n" "$*"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$*"; }
bad()  { printf "  \033[31m✗\033[0m %s\n" "$*"; }
die()  { bad "$*"; exit 1; }

# `code` from a Claude/VS Code extension host inherits ELECTRON_RUN_AS_NODE=1, which makes
# the VS Code binary run as plain node and reject every flag as a "bad option".
unset ELECTRON_RUN_AS_NODE

command -v code >/dev/null || die "the 'code' CLI is not on PATH"

say "1. Source"
git -C "$HERE" rev-parse --abbrev-ref HEAD | sed 's/^/  branch: /'
git -C "$HERE" log --oneline -1 | sed 's/^/  commit: /'
DIRTY=$(git -C "$HERE" status --porcelain -- . | wc -l)
[ "$DIRTY" -gt 0 ] && bad "$DIRTY uncommitted file(s) — you are installing local edits, not main" || ok "tree clean"

say "2. Build"
npm run compile --silent
[ -f out/extension.js ] || die "out/extension.js was not produced"
ok "compiled  ($(stat -c %y out/extension.js | cut -d. -f1))"

# A UNIQUE version. VS Code will not swap a bundle for the same version number in a running
# window — reinstalling 0.18.0 over 0.18.0 silently leaves you on the OLD code.
BASE=$(node -p "require('./package.json').version")
VERSION="${BASE%.*}.$(( ${BASE##*.} + 1 ))"

say "3. Package  (v$VERSION)"
# Bump for the package, then put package.json back: the repo must not be dirtied by a run
# of the installer. The bump exists only so VS Code is FORCED to swap the bundle.
node -e "
  const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json','utf8'));
  p.version='$VERSION'; fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n');
"
VSIX="/tmp/${EXT_ID}-${VERSION}.vsix"
restore() { git -C "$HERE" checkout -- package.json 2>/dev/null || true; }
trap restore EXIT
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o "$VSIX" >/dev/null
ok "packaged  $VSIX  ($(du -h "$VSIX" | cut -f1))"

say "4. Remove every previous copy"
# Uninstall until it is genuinely gone — VS Code keeps obsolete dirs around.
for _ in 1 2 3; do
  code --uninstall-extension "$EXT_ID" >/dev/null 2>&1 || true
done
REMAIN=$(code --list-extensions 2>/dev/null | grep -cx "$EXT_ID" || true)
[ "$REMAIN" = "0" ] && ok "no copy of $EXT_ID registered" || bad "still registered — a dev host may be holding it"

say "5. Install"
code --install-extension "$VSIX" --force 2>&1 | tail -1 | sed 's/^/  /'

say "6. Verify what actually landed"
DIR=$(ls -dt "$HOME"/.vscode-server/extensions/${EXT_ID}-* 2>/dev/null | head -1)
[ -n "$DIR" ] || die "no installed directory found — the install did not take"
ok "dir: $DIR"

node -e "
  const fs=require('fs');
  const m=JSON.parse(fs.readFileSync('$DIR/package.json','utf8'));
  // Scan the WHOLE compiled output, not just the entry file: the marker for a feature can
  // live in any module (the workspace policy lives in pilotClient/workspace, not extension.js).
  // Checking one file produced a false 'not the code you built' alarm.
  const walk = (d) => fs.readdirSync(d, {withFileTypes:true}).flatMap(e =>
    e.isDirectory() ? walk(d+'/'+e.name) : (e.name.endsWith('.js') ? [d+'/'+e.name] : []));
  const bundle = walk('$DIR/out').map(f => fs.readFileSync(f,'utf8')).join('\n');
  const cmds=m.contributes.commands.map(c=>c.command);
  const need=['migrapilot.conversationState','migrapilot.history','migrapilot.newChat'];
  const missing=need.filter(c=>!cmds.includes(c));
  const markers={
    'D.1 conversation persistence':'activeConversationId',
    'restore banner':'Continuing your previous conversation',
    'no-folder warning':'No folder is open',
    'Phase E workspace policy':'DENIED_BY_OPERATOR',
  };
  console.log('  version : ' + m.version);
  console.log('  commands: ' + cmds.length);
  let bad=missing.length>0;
  if (missing.length) console.log('  \x1b[31m✗ MISSING COMMANDS: ' + missing.join(', ') + '\x1b[0m');
  else console.log('  \x1b[32m✓\x1b[0m all expected commands present');
  for (const [name,needle] of Object.entries(markers)) {
    const has = bundle.includes(needle);
    if (!has) bad = true;
    console.log('  ' + (has ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m') + ' ' + name);
  }
  if (bad) { console.log('\n  \x1b[31mThe installed bundle is NOT the code you just built.\x1b[0m'); process.exit(1); }
"

say "7. Backend"
if curl -s -m3 -o /dev/null -w '%{http_code}' http://127.0.0.1:3377/health | grep -q 200; then
  ok "pilot-api :3377 healthy"
else
  bad "pilot-api is NOT running on :3377 — start it (VS Code task: Start Pilot API)"
fi

cat <<'EOF'

────────────────────────────────────────────────────────────────
NOW, IN VS CODE — in this order, or it will not take effect:

  1. CLOSE any window titled [Extension Development Host].
     A dev host OVERRIDES the installed extension with whatever it
     loaded at F5 time. It is the reason nothing worked.

  2. Developer: Reload Window

  3. Ctrl+Shift+P → "MigraPilot: Show Conversation State"
     If that command is missing, the old extension is STILL loaded —
     run  Developer: Show Running Extensions  and check the path.

  4. File → Open Folder → the project you want MigraPilot to work on.
     With no folder open it cannot read files, cannot run tests, and
     cannot persist a conversation — while looking perfectly healthy.
────────────────────────────────────────────────────────────────
EOF
