// The locked PRODUCT / CONTROL-PLANE / ENGINEERING split.
//
// The classification is only worth having if the manifest cannot disagree with it,
// so these tests check the two against each other in both directions: every
// contributed command must be classified, and every classification must match how
// the command palette actually gates that command.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { NAV_ACTIONS, navActionAllowed, navActionsFor } from '../../panel/shell/navigationModel.js';

import {
  PRODUCT_CLASSES,
  SURFACES,
  classify,
  isProductSurface,
  surfacesOfClass,
  visibleIds,
  type SurfaceRecord,
} from '../../panel/shell/surfaceClassification.js';

interface Manifest {
  contributes: {
    commands: Array<{ command: string; title: string }>;
    menus: Record<string, Array<{ command: string; when?: string }>>;
    configuration: { properties: Record<string, unknown> };
    views: Record<string, Array<{ id: string; when?: string }>>;
    viewsContainers?: Record<string, Array<{ id: string }>>;
  };
}

const manifest = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../../package.json'), 'utf8'),
) as Manifest;

const contributed = manifest.contributes.commands.map((entry) => entry.command.replace(/^migrapilot\./, ''));
const palette = manifest.contributes.menus.commandPalette ?? [];
const DEV_GATE = 'config.migrapilot.developerMode';
const CLASSIC_GATE = 'config.migrapilot.enableClassicViews';

/** The one engineering command deliberately left in the normal palette. */
const DEVELOPER_DOOR = 'showDiagnostics';

function commandRecords(): SurfaceRecord[] {
  return SURFACES.filter((surface) => surface.kind === 'command');
}

// ── The classification is complete and well formed ───────────────────────────

test('EVERY contributed command is classified', () => {
  const unclassified = contributed.filter((id) => classify('command', id) === undefined);
  assert.deepEqual(unclassified, [], 'a new command must be classified before it can ship');
});

test('every classified command actually exists in the manifest', () => {
  const missing = commandRecords().map((r) => r.id).filter((id) => !contributed.includes(id));
  assert.deepEqual(missing, [], 'the classification must not describe commands that were removed');
});

test('no surface is classified twice, and every one says why', () => {
  const seen = new Set<string>();
  for (const surface of SURFACES) {
    const key = `${surface.kind}:${surface.id}`;
    assert.ok(!seen.has(key), `${key} is classified more than once`);
    seen.add(key);
    assert.ok(surface.why.length > 15, `${key} must record WHY it is classified this way`);
    assert.ok(surface.label.length > 0);
  }
});

test('EVERY registered user-facing surface is classified — no escapes', () => {
  // The sidebar shipped an entire engineering console through a "complete" pivot
  // because nothing required its rows to be classified. This is that requirement.
  for (const action of NAV_ACTIONS) {
    assert.ok(classify('nav-action', action.id), `sidebar row ${action.id} must be classified`);
  }
  // Editor context-menu entries.
  const contextMenu = (manifest.contributes.menus['editor/context'] ?? []) as Array<{ command: string }>;
  assert.ok(contextMenu.length > 0, 'the manifest contributes context-menu entries');
  for (const entry of contextMenu) {
    assert.ok(classify('context-menu', entry.command), `${entry.command} must be classified`);
  }
  // Activity Bar containers.
  const containers = (manifest.contributes.viewsContainers?.activitybar ?? []) as Array<{ id: string }>;
  for (const container of containers) {
    assert.ok(classify('activity-bar', container.id), `activity bar ${container.id} must be classified`);
  }
  // Views.
  for (const [, views] of Object.entries(manifest.contributes.views)) {
    for (const view of views) assert.ok(classify('view', view.id), `view ${view.id} must be classified`);
  }
});

test('THE SIDEBAR IS PRODUCT-ONLY, and every rendered row is a product surface', () => {
  const rows = navActionsFor('quick', false).map((a) => a.id);
  assert.deepEqual(rows, ['explainCode', 'fixCode', 'reviewChanges', 'runTests']);
  // Engineering groups render nothing in product mode.
  assert.deepEqual(navActionsFor('agent', false), []);
  assert.deepEqual(navActionsFor('service', false), []);
  // Settings belongs to no section — the footer gear serves it in both modes.
  assert.equal(NAV_ACTIONS.find((a) => a.id === 'settings')?.group, undefined);
  // …and developer mode gets them back.
  assert.ok(navActionsFor('agent', true).length > 0);
  assert.ok(navActionsFor('service', true).length > 0);
});

test('A WEBVIEW MESSAGE CANNOT REACH A HIDDEN SIDEBAR ROW', () => {
  // Hiding markup is a display rule. This is the boundary the host enforces.
  for (const engineering of ['brainStatus', 'repairConnection', 'logs', 'runHistory', 'activeRuns', 'submitTask']) {
    assert.equal(navActionAllowed(engineering, false), false, `${engineering} must be refused in product mode`);
    assert.equal(navActionAllowed(engineering, true), true, `${engineering} must work in developer mode`);
  }
  for (const product of ['newTask', 'explainCode', 'fixCode', 'reviewChanges', 'runTests', 'pendingApprovals', 'settings']) {
    assert.equal(navActionAllowed(product, false), true, `${product} must be dispatchable`);
  }
  assert.equal(navActionAllowed('notARealRow', false), false, 'unknown ids fail closed');
});

test('every setting the manifest declares is classified', () => {
  const declared = Object.keys(manifest.contributes.configuration.properties);
  const unclassified = declared.filter((id) => classify('setting', id) === undefined);
  assert.deepEqual(unclassified, [], 'a new setting must be classified');
});

test('UNKNOWN SURFACES FAIL CLOSED', () => {
  // Forgetting to classify a new engineering panel must hide it, not ship it.
  assert.equal(isProductSurface('tab', 'some-new-console'), false);
  assert.equal(isProductSurface('command', 'notARealCommand'), false);
  assert.deepEqual(visibleIds('tab', false), ['chat', 'diff']);
});

// ── The manifest agrees with the classification ──────────────────────────────

test('THE NORMAL PALETTE OFFERS THE PRODUCT, AND ONE DEVELOPER DOOR', () => {
  const gated = new Set(
    palette.filter((entry) => entry.when === DEV_GATE || entry.when === CLASSIC_GATE)
      .map((entry) => entry.command.replace(/^migrapilot\./, '')),
  );
  const visible = contributed.filter((id) => !gated.has(id));

  const unexpected = visible.filter((id) => !isProductSurface('command', id) && id !== DEVELOPER_DOOR);
  assert.deepEqual(unexpected, [], 'an engineering or administrative command is reachable by default');

  const hidden = visible.length;
  assert.ok(hidden < contributed.length, 'something must be gated');
  // Every product command stays reachable — the pivot hides machinery, not work.
  for (const record of commandRecords()) {
    if (PRODUCT_CLASSES.includes(record.cls)) {
      assert.ok(visible.includes(record.id), `${record.id} is product and must stay in the palette`);
    }
  }
});

test('every engineering and administrative command is gated', () => {
  const gated = new Map(palette.map((entry) => [entry.command.replace(/^migrapilot\./, ''), entry.when]));
  for (const record of commandRecords()) {
    if (PRODUCT_CLASSES.includes(record.cls) || record.id === DEVELOPER_DOOR) continue;
    const when = gated.get(record.id);
    assert.ok(when !== undefined, `${record.id} (${record.cls}) must be gated in the command palette`);
    assert.match(when, /^config\.migrapilot\.(developerMode|enableClassicViews)$/, `${record.id} gate`);
  }
});

test('the developer gate exists and is OFF by default', () => {
  const setting = manifest.contributes.configuration.properties['migrapilot.developerMode'] as
    | { type: string; default: boolean; description: string }
    | undefined;
  assert.ok(setting, 'migrapilot.developerMode must be declared');
  assert.equal(setting.type, 'boolean');
  assert.equal(setting.default, false, 'a normal install is the product, not the console');
  // The description must promise that nothing is lost by leaving it off.
  assert.match(setting.description, /Nothing is disabled/i);
});

test('command titles carry the classification a user can see', () => {
  const titles = new Map(manifest.contributes.commands.map((c) => [c.command.replace(/^migrapilot\./, ''), c.title]));
  for (const record of commandRecords()) {
    const title = titles.get(record.id) ?? '';
    if (PRODUCT_CLASSES.includes(record.cls)) {
      assert.ok(!/\(Developer\)|\(Admin\)/.test(title), `${record.id} is product but reads as internal: "${title}"`);
    }
    if (record.cls === 'control-plane') {
      assert.match(title, /\(Admin\)/, `${record.id} is administrative and must say so: "${title}"`);
    }
    if (record.cls === 'internal-diagnostics') {
      assert.match(title, /\(Developer\)/, `${record.id} is engineering and must say so: "${title}"`);
    }
  }
});

// ── The split says what the owner locked ─────────────────────────────────────

test('the six things a user must be able to do are all core product', () => {
  // where to ask · what it can do · what it is doing · what it wants to change ·
  // whether the change succeeded · whether verification passed
  for (const id of ['openChat', 'quickEdit', 'gitOverview', 'runTests', 'diagnoseFailure', 'explainSelection']) {
    assert.equal(classify('command', id)?.cls, 'core-product', `${id}`);
  }
  assert.equal(classify('context-panel', 'ctx-run')?.cls, 'supporting-product-state', 'what it is doing');
  assert.equal(classify('nav-section', 'nav-workspace')?.cls, 'supporting-product-state', 'repo, branch, changed files');
});

test('index internals, model inventory and service lifecycle are ENGINEERING', () => {
  for (const id of ['openWorkspacePanel', 'providerStatus', 'health', 'repairConnection', 'showLogs']) {
    assert.equal(classify('command', id)?.cls, 'internal-diagnostics', `${id}`);
  }
  for (const id of ['migrapilot.brainUrl', 'migrapilot.maxContextChunks', 'migrapilot.mode']) {
    assert.equal(classify('setting', id)?.cls, 'internal-diagnostics', `${id}`);
  }
});

test('users, plans, usage, policies and credentials are CONTROL PLANE', () => {
  for (const id of ['executionPolicy', 'aiUsage', 'setToken', 'clearToken', 'pairAgentMode']) {
    assert.equal(classify('command', id)?.cls, 'control-plane', `${id} belongs in the Migra control panel`);
  }
});

test('STATUS SURFACES ARE CLASSIFIED — the ones code review missed', () => {
  // The first pass of this audit read the source and missed both status surfaces.
  // Looking at the running product found four pieces of backend state on them.
  assert.equal(classify('status', 'statusrow')?.cls, 'supporting-product-state');
  assert.equal(classify('status', 'statusbar.readiness')?.cls, 'supporting-product-state');
  assert.equal(isProductSurface('status', 'statusbar.policy'), false, 'policy is administrative');
  assert.equal(isProductSurface('status', 'statusbar.agentMode'), false, 'Agent Mode is a mechanism');
});

test('nothing is classified as a placeholder — every visible surface delivers', () => {
  assert.deepEqual(surfacesOfClass('placeholder'), [], 'a declared surface that does nothing must be removed, not shipped');
});

test('approval stays in the product, because it is a real user decision', () => {
  assert.equal(classify('command', 'reviewApprovals')?.cls, 'core-product');
  // The live-knowledge control is a genuine choice; model routing is not.
  assert.equal(isProductSurface('composer-control', 'clive'), true);
  assert.equal(isProductSurface('composer-control', 'croute'), false);
});
