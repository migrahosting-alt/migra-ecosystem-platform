import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * The extension MANIFEST is part of the product surface: it decides which views a
 * user sees by default. These assertions pin the canonical-interface contract so
 * a superseded surface cannot silently return to the sidebar.
 */
const manifest = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
) as {
  contributes: {
    views: { migrapilot: Array<{ id: string; name: string; when?: string }> };
    commands: Array<{ command: string; title: string }>;
    configuration: { properties: Record<string, { type: string; default: unknown; description?: string; markdownDescription?: string }> };
    menus: { commandPalette?: Array<{ command: string; when?: string }> };
  };
};

const views = manifest.contributes.views.migrapilot;
const commands = manifest.contributes.commands.map((entry) => entry.command);
const CLASSIC_VIEWS = ['migrapilot.chatView', 'migrapilot.agentMode', 'migrapilot.workspace'];
const CLASSIC_GATE = 'config.migrapilot.enableClassicViews';

/** Views a user sees with default settings. */
function defaultVisibleViews(): Array<{ id: string; name: string; when?: string }> {
  return views.filter((view) => !view.when);
}

// ── Canonical interface ───────────────────────────────────────────────────────

test('the compact navigation view is the FIRST view, so the activity-bar icon focuses it', () => {
  assert.equal(views[0]?.id, 'migrapilot.sidebar');
  assert.equal(views[0]?.name, 'MigraPilot');
  assert.equal(views[0]?.when, undefined, 'the launcher must never be conditionally hidden');
});

test('the Command Center is a first-class command', () => {
  assert.ok(commands.includes('migrapilot.openStudio'));
  const entry = manifest.contributes.commands.find((c) => c.command === 'migrapilot.openStudio');
  assert.match(entry?.title ?? '', /Command Center/i);
});

// ── Classic surfaces are not default-visible ─────────────────────────────────

test('CHAT (CLASSIC) and AGENT MODE (CLASSIC) are absent from the default sidebar', () => {
  const visible = defaultVisibleViews().map((view) => view.id);
  for (const id of CLASSIC_VIEWS) {
    assert.ok(!visible.includes(id), `${id} must NOT be visible by default`);
  }
  // They are still contributed — retained, not deleted.
  for (const id of CLASSIC_VIEWS) {
    assert.ok(views.some((view) => view.id === id), `${id} must still be contributed for developer restore`);
  }
});

test('each classic view is gated on the explicit developer setting', () => {
  for (const id of CLASSIC_VIEWS) {
    const view = views.find((entry) => entry.id === id);
    assert.equal(view?.when, CLASSIC_GATE, `${id} must be gated on ${CLASSIC_GATE}`);
    // Named so a developer cannot mistake them for the canonical interface.
    assert.match(view?.name ?? '', /Classic/, `${id} must be labelled as classic`);
    assert.match(view?.name ?? '', /Developer/i, `${id} must be labelled developer-only`);
  }
});

test('the launcher is the ONLY default-visible view', () => {
  const visible = defaultVisibleViews();
  // The MigraAI Workspace panel joined the retired set once the Command Center's
  // Workspace tab took over the full lifecycle.
  assert.deepEqual(visible.map((view) => view.id), ['migrapilot.sidebar']);
  for (const view of visible) {
    assert.doesNotMatch(view.name, /chat/i, `${view.id} must not be a second chat surface`);
    assert.doesNotMatch(view.name, /agent mode/i, `${view.id} must not be a second Agent Mode surface`);
    assert.doesNotMatch(view.name, /migraai workspace/i, `${view.id} must not be a second workspace surface`);
  }
});

// ── The developer gate ────────────────────────────────────────────────────────

test('the classic-views setting exists, defaults to OFF, and documents the canonical surface', () => {
  const setting = manifest.contributes.configuration.properties['migrapilot.enableClassicViews'];
  assert.ok(setting, 'the developer setting must exist');
  assert.equal(setting.type, 'boolean');
  assert.equal(setting.default, false, 'classic views must be OFF by default');
  const text = setting.markdownDescription ?? setting.description ?? '';
  assert.match(text, /Developer only/i);
  assert.match(text, /Command Center/);
  // It must be explicit that the gate grants no extra authority.
  assert.match(text, /same server-owned proposal|one-time approval/i);
});

test('the classic-view developer commands exist and are hidden from the palette by default', () => {
  const devCommands = ['migrapilot.dev.openClassicChat', 'migrapilot.dev.openClassicAgentMode', 'migrapilot.dev.openClassicWorkspace'];
  const palette = manifest.contributes.menus.commandPalette ?? [];
  for (const command of devCommands) {
    assert.ok(commands.includes(command), `${command} must be contributed`);
    const entry = palette.find((item) => item.command === command);
    assert.ok(entry, `${command} must have a commandPalette entry`);
    assert.equal(entry?.when, CLASSIC_GATE, `${command} must be palette-gated on ${CLASSIC_GATE}`);
    assert.match(
      manifest.contributes.commands.find((c) => c.command === command)?.title ?? '',
      /Developer/,
      `${command} must be titled as developer-only`,
    );
  }
});

// ── No regression in the command surface ─────────────────────────────────────

test('every pre-existing command is still contributed', () => {
  // The command set shipped before the redesign. None may disappear (§9).
  const preExisting = [
    'migrapilot.openChat',
    'migrapilot.openWorkspacePanel',
    'migrapilot.openAgentMode',
    'migrapilot.pairAgentMode',
    'migrapilot.health',
    'migrapilot.repairConnection',
    'migrapilot.showLogs',
    'migrapilot.showDiagnostics',
    'migrapilot.productionDiagnostics',
    'migrapilot.executionPolicy',
    'migrapilot.providerStatus',
    'migrapilot.aiUsage',
    'migrapilot.explainSelection',
    'migrapilot.fixDiagnostics',
    'migrapilot.generateTests',
    'migrapilot.generateCommit',
    'migrapilot.setToken',
    'migrapilot.clearToken',
    'migrapilot.reviewApprovals',
    'migrapilot.showBackendDiagnostics',
  ];
  // migrapilot.setProviderKey / clearProviderKey / providerInfo were removed
  // deliberately: the extension no longer has a model provider to configure,
  // key, or identify — inference belongs to the Brain. See noDirectModelPath.
  for (const command of preExisting) {
    assert.ok(commands.includes(command), `pre-existing command removed: ${command}`);
  }
});

test('no command title advertises an Agent approval or execution shortcut', () => {
  // Mirrors the VSIX inspection guard: approval must only be reachable through
  // the governed proposal lifecycle, never a direct command.
  for (const entry of manifest.contributes.commands) {
    const text = `${entry.command} ${entry.title}`;
    if (!/agent/i.test(text)) continue;
    assert.doesNotMatch(text, /(approve|approval|reject|decide|execute)/i, `${entry.command} must not expose approval directly`);
  }
});
