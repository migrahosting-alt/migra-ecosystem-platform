#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const vsix = process.argv[2] ?? 'migrapilot-extension-0.1.0.vsix';
if (!existsSync(vsix)) throw new Error(`VSIX not found: ${vsix}`);

const result = spawnSync('unzip', ['-Z1', vsix], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(result.stderr || 'unzip listing failed');
const files = result.stdout.split('\n').filter(Boolean).sort();
const forbidden = files.filter((file) =>
  file.endsWith('.tsbuildinfo') ||
  file.startsWith('extension/src/') ||
  file.startsWith('extension/dist/test/') ||
  file.endsWith('.test.js') ||
  file.includes('/test/') ||
  file.includes('/scripts/')
);
if (forbidden.length > 0) {
  throw new Error(`Forbidden files in VSIX:\n${forbidden.join('\n')}`);
}


const forbiddenRuntimeArtifacts = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)migraai-state\.db(?:-shm|-wal)?$/i,
  /\.sqlite3?$/i,
  /\.tsbuildinfo$/i,
];

const forbiddenRuntimeMatches = files.filter((entry) =>
  forbiddenRuntimeArtifacts.some((pattern) => pattern.test(entry)),
);

if (forbiddenRuntimeMatches.length > 0) {
  console.error(JSON.stringify({
    ok: false,
    reason: "FORBIDDEN_RUNTIME_ARTIFACTS",
    files: forbiddenRuntimeMatches,
  }, null, 2));
  process.exit(1);
}

const packageJson = files.includes('extension/package.json');
const bundledEntry = files.includes('extension/dist/extension.js');
if (!packageJson || !bundledEntry) {
  throw new Error('VSIX is missing package.json or bundled dist/extension.js.');
}

const staging = mkdtempSync(path.join(tmpdir(), 'migrapilot-vsix-inspect-'));
try {
  const unzip = spawnSync('unzip', ['-q', '-o', vsix, '-d', staging], { encoding: 'utf8' });
  if (unzip.status !== 0) throw new Error(unzip.stderr || 'VSIX extraction failed');
  const manifest = JSON.parse(readFileSync(path.join(staging, 'extension/package.json'), 'utf8'));
  const commands = manifest.contributes?.commands ?? [];
  const hiddenAgentApproval = commands.filter((entry) => {
    const text = `${entry.command ?? ''} ${entry.title ?? ''}`;
    return /agent/i.test(text) && /(approve|approval|reject|cancel|decide|execute)/i.test(text);
  });
  if (hiddenAgentApproval.length > 0) {
    throw new Error(`Packaged manifest exposes hidden Agent approval commands: ${hiddenAgentApproval.map((entry) => entry.command).join(', ')}`);
  }
  const bundled = readFileSync(path.join(staging, 'extension/dist/extension.js'), 'utf8');
  for (const disabledRecipe of ['workspace.test', 'npm.test']) {
    if (bundled.includes(disabledRecipe)) {
      throw new Error(`Packaged bundle contains disabled Agent recipe/tool surface: ${disabledRecipe}`);
    }
  }

  // ── Canonical-interface contract ───────────────────────────────────────────
  //
  // The packaged manifest must ship exactly ONE user-facing chat composer, ONE
  // Agent Mode approval surface and ONE run-history surface. The superseded
  // classic views are retained for developer verification but must be gated
  // behind the explicit `migrapilot.enableClassicViews` setting, so a default
  // install can never present two competing experiences.
  const CLASSIC_GATE = 'config.migrapilot.enableClassicViews';
  const CLASSIC_VIEW_IDS = ['migrapilot.chatView', 'migrapilot.agentMode'];
  const sidebarViews = manifest.contributes?.views?.migrapilot ?? [];
  const defaultVisibleViews = sidebarViews.filter((view) => !view.when);

  if (sidebarViews[0]?.id !== 'migrapilot.sidebar') {
    throw new Error(
      `The compact navigation view must be first so the activity-bar icon focuses it; got: ${sidebarViews[0]?.id ?? '(none)'}`,
    );
  }

  const leakedClassicViews = defaultVisibleViews.filter((view) => CLASSIC_VIEW_IDS.includes(view.id));
  if (leakedClassicViews.length > 0) {
    throw new Error(
      `Packaged manifest exposes superseded classic views by default: ${leakedClassicViews.map((view) => view.id).join(', ')}`,
    );
  }

  const ungatedClassicViews = CLASSIC_VIEW_IDS
    .map((id) => sidebarViews.find((view) => view.id === id))
    .filter((view) => view && view.when !== CLASSIC_GATE);
  if (ungatedClassicViews.length > 0) {
    throw new Error(
      `Classic views must be gated on ${CLASSIC_GATE}: ${ungatedClassicViews.map((view) => `${view.id} (when=${view.when ?? 'none'})`).join(', ')}`,
    );
  }

  // A default-visible view must not read as a second chat / Agent Mode surface.
  const duplicateSurfaces = defaultVisibleViews.filter((view) => /chat|agent mode/i.test(view.name ?? ''));
  if (duplicateSurfaces.length > 0) {
    throw new Error(
      `Packaged manifest exposes duplicate chat/Agent Mode surfaces by default: ${duplicateSurfaces.map((view) => `${view.id} ("${view.name}")`).join(', ')}`,
    );
  }

  const classicSetting = manifest.contributes?.configuration?.properties?.['migrapilot.enableClassicViews'];
  if (!classicSetting || classicSetting.type !== 'boolean' || classicSetting.default !== false) {
    throw new Error('migrapilot.enableClassicViews must be a boolean setting defaulting to false.');
  }

  // The developer escape hatches must be hidden from the palette by default.
  const palette = manifest.contributes?.menus?.commandPalette ?? [];
  for (const devCommand of ['migrapilot.dev.openClassicChat', 'migrapilot.dev.openClassicAgentMode']) {
    if (!commands.some((entry) => entry.command === devCommand)) {
      throw new Error(`Missing developer restore command: ${devCommand}`);
    }
    const gate = palette.find((item) => item.command === devCommand);
    if (!gate || gate.when !== CLASSIC_GATE) {
      throw new Error(`Developer command ${devCommand} must be palette-gated on ${CLASSIC_GATE}.`);
    }
  }

  // The Command Center must be reachable as a first-class command.
  if (!commands.some((entry) => entry.command === 'migrapilot.openStudio')) {
    throw new Error('Packaged manifest is missing migrapilot.openStudio (the canonical Command Center).');
  }

  console.log(JSON.stringify({
    ok: true,
    fileCount: files.length,
    commandCount: commands.length,
    disabledRecipesAbsent: true,
    hiddenAgentApprovalCommands: 0,
    canonicalInterface: 'migrapilot.openStudio',
    defaultVisibleViews: defaultVisibleViews.map((view) => view.id),
    classicViewsGatedBy: CLASSIC_GATE,
    classicViewsDefaultEnabled: classicSetting.default,
    duplicateChatSurfaces: 0,
    vsix: path.resolve(vsix),
  }, null, 2));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
