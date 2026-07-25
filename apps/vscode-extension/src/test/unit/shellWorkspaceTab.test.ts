import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { toPanelModel, type WorkspacePanelModel } from '../../panel/workspaceViewModel.js';
import {
  WORKSPACE_DENY_LIST,
  WORKSPACE_INTENTS,
  emptyWorkspaceTab,
  isWorkspaceIntent,
  loadingWorkspaceTab,
  toWorkspaceTab,
} from '../../panel/shell/workspaceTabModel.js';
import { buildShellState, type ShellStateInput } from '../../panel/shell/shellState.js';
import { SHELL_TABS, isShellTab } from '../../panel/shell/navigationModel.js';
import { knownIcons } from '../../panel/shell/icons.js';

const NOW = 1_700_000_000_000;

/** A realistic engine WorkspaceView, mapped through the RATIFIED mapper so the
 * tab is tested against the same model the standalone panel renders. */
function engineView(overrides: Record<string, unknown> = {}) {
  return {
    workspace: {
      id: 'ws_7f3a91',
      name: 'MigraTeck-Ecosystem',
      root: '/home/bonex/workspace/active/MigraTeck-Ecosystem/dev',
      gitRepo: 'https://user:supersecret@github.com/migrahosting-alt/repo.git',
      gitBranch: 'phase-1/canonical-vscode-extension',
      memoryMode: 'session',
      lastSyncAt: NOW - 600_000,
    },
    health: 'needs-approval',
    index: {
      version: 41,
      state: 'evaluated',
      files: 1284,
      chunks: 9317,
      embeddingModel: 'nomic-embed-text',
      lastSyncAt: NOW - 600_000,
    },
    memory: { mode: 'session', activeConversations: 3 },
    agents: ['inspector', 'engineer'],
    models: { general: ['a'], coding: ['b'], reasoning: [], vision: [], embedding: ['nomic-embed-text'] },
    versions: { engineVersion: '0.1.0', protocolVersion: 1, schemaVersion: 5 },
    ...overrides,
  } as never;
}

function model(overrides: Record<string, unknown> = {}): WorkspacePanelModel {
  return toPanelModel(engineView(overrides), { now: NOW });
}

// ── The tab is a re-dressing of the ratified mapper ──────────────────────────

test('the Workspace tab renders every section the standalone panel showed', () => {
  const tab = toWorkspaceTab(model());
  assert.deepEqual(
    tab.panels.map((panel) => panel.title),
    ['Workspace', 'Semantic Index', 'Memory', 'Agents', 'Models', 'Engine'],
  );
  // Nothing is dropped from any section.
  const source = model();
  for (const [index, section] of source.sections.entries()) {
    assert.equal(tab.panels[index]?.rows.length, section.rows.length, `${section.title} lost rows`);
  }
});

test('the tab reuses the mapper output verbatim — labels, values and tones', () => {
  const source = model();
  const tab = toWorkspaceTab(source);
  const semanticIndex = tab.panels.find((panel) => panel.title === 'Semantic Index');
  const rows = new Map(semanticIndex?.rows.map((row) => [row.label, [row.value, row.tone]]));
  assert.deepEqual(rows.get('State'), ['Evaluated — needs approval', 'warn']);
  assert.deepEqual(rows.get('Files'), ['1284', undefined]);
  assert.deepEqual(rows.get('Chunks'), ['9317', undefined]);
  assert.deepEqual(rows.get('Embedding model'), ['nomic-embed-text', undefined]);
  assert.deepEqual(rows.get('Pending approval'), ['yes', 'warn']);
});

// ── Branch semantics: two different facts, never conflated ───────────────────

test('the engine branch is labelled INDEXED, never plain "Branch"', () => {
  const tab = toWorkspaceTab(model());
  const workspace = tab.panels.find((panel) => panel.title === 'Workspace')!;
  const labels = workspace.rows.map((row) => row.label);
  assert.ok(labels.includes('Indexed branch'), 'the engine branch is the branch at last sync');
  assert.ok(!labels.includes('Branch'), 'a bare "Branch" label conflates two different facts');
  assert.equal(
    workspace.rows.find((row) => row.label === 'Indexed branch')?.value,
    'phase-1/canonical-vscode-extension',
  );
});

test('a diverged checkout shows BOTH branches and flags the stale index', () => {
  // The engine indexed one branch; the working tree is on another.
  const tab = toWorkspaceTab(model(), { currentBranch: 'fix/git-tools-report-real-errors' });
  const workspace = tab.panels.find((panel) => panel.title === 'Workspace')!;
  const rows = new Map(workspace.rows.map((row) => [row.label, [row.value, row.tone]]));

  // Neither value is overwritten — both are preserved and named.
  assert.deepEqual(rows.get('Indexed branch'), ['phase-1/canonical-vscode-extension', 'warn']);
  assert.deepEqual(rows.get('Current branch'), ['fix/git-tools-report-real-errors', 'info']);
  assert.deepEqual(rows.get('Index freshness'), [
    'Indexed on a different branch — sync to reindex the current one',
    'warn',
  ]);
});

test('matching branches are not flagged as stale', () => {
  const tab = toWorkspaceTab(model(), { currentBranch: 'phase-1/canonical-vscode-extension' });
  const workspace = tab.panels.find((panel) => panel.title === 'Workspace')!;
  const rows = new Map(workspace.rows.map((row) => [row.label, [row.value, row.tone]]));
  assert.deepEqual(rows.get('Indexed branch'), ['phase-1/canonical-vscode-extension', undefined]);
  assert.deepEqual(rows.get('Current branch'), ['phase-1/canonical-vscode-extension', 'muted']);
  assert.equal(rows.has('Index freshness'), false, 'no divergence, no warning');
});

test('without live Git the indexed branch still stands alone, unflagged', () => {
  const tab = toWorkspaceTab(model(), {});
  const workspace = tab.panels.find((panel) => panel.title === 'Workspace')!;
  const labels = workspace.rows.map((row) => row.label);
  assert.ok(labels.includes('Indexed branch'));
  assert.ok(!labels.includes('Current branch'), 'never invent a current branch we could not read');
  assert.ok(!labels.includes('Index freshness'), 'divergence is unknowable without the live branch');
});

test('the shell threads the live Git branch into the Workspace tab', () => {
  const state = buildShellState({
    now: NOW,
    brainEndpoint: 'http://127.0.0.1:3988',
    agentModeActive: false,
    voiceSupported: false,
    workspaceModel: model(),
    git: { repository: 'repo', branch: 'fix/git-tools-report-real-errors', clean: true, changedFileCount: 0 },
  });
  const workspace = state.workspace.panels.find((panel) => panel.title === 'Workspace')!;
  const rows = new Map(workspace.rows.map((row) => [row.label, row.value]));
  assert.equal(rows.get('Current branch'), 'fix/git-tools-report-real-errors');
  assert.equal(rows.get('Indexed branch'), 'phase-1/canonical-vscode-extension');
});

// ── Sanitation ───────────────────────────────────────────────────────────────

test('the tab never carries the workspace id or the index version', () => {
  const tab = toWorkspaceTab(model());
  const serialized = JSON.stringify(tab);
  assert.doesNotMatch(serialized, /ws_7f3a91/, 'the workspace id must stay host-side');
  assert.doesNotMatch(serialized, /"indexVersion"/, 'the index version must stay host-side');
  assert.doesNotMatch(serialized, /\b41\b/, 'the raw index version must not leak as a value');
  for (const denied of WORKSPACE_DENY_LIST) {
    assert.ok(!Object.prototype.hasOwnProperty.call(tab, denied), `tab must not have a "${denied}" field`);
  }
});

test('credentials embedded in a git remote never reach the tab', () => {
  const tab = toWorkspaceTab(model());
  assert.doesNotMatch(JSON.stringify(tab), /supersecret/, 'the ratified mapper strips remote credentials');
});

test('the absolute workspace root is reduced to a leaf segment', () => {
  const tab = toWorkspaceTab(model());
  const workspace = tab.panels.find((panel) => panel.title === 'Workspace');
  const root = workspace?.rows.find((row) => row.label === 'Root');
  assert.equal(root?.value, 'dev');
  assert.doesNotMatch(JSON.stringify(tab), /home\/bonex/, 'no absolute path in the posted tab');
});

// ── Index approval — the second approval boundary ────────────────────────────

test('an unapproved index raises a GOVERNED approval card', () => {
  const tab = toWorkspaceTab(model());
  assert.equal(tab.approval.state, 'required');
  assert.equal(tab.approval.heading, 'INDEX APPROVAL REQUIRED');
  assert.equal(tab.approval.badge.tone, 'governed', 'approval-required is orange, per the palette contract');
  assert.deepEqual(tab.approval.actions.map((action) => action.id), ['approve', 'diagnostics']);
  // The note must state the version-binding guarantee.
  assert.match(tab.approval.note, /refuses the approval|changed since/i);
});

test('an approved index shows a quiet non-governed card with no approve action', () => {
  const tab = toWorkspaceTab(model({ health: 'ready', index: { version: 41, state: 'approved', files: 10, chunks: 20, embeddingModel: 'm', lastSyncAt: NOW } }));
  assert.equal(tab.approval.state, 'clear');
  assert.equal(tab.approval.badge.tone, 'ok');
  assert.ok(!tab.approval.actions.some((action) => action.id === 'approve'), 'nothing left to approve');
});

test('an unindexed workspace offers no approval at all', () => {
  const tab = toWorkspaceTab(model({ health: 'needs-sync', index: { version: 0, state: undefined, files: 0, chunks: 0, lastSyncAt: undefined } }));
  assert.equal(tab.approval.state, 'not-indexed');
  assert.equal(tab.approval.badge.tone, 'muted');
  assert.equal(tab.approval.actions.length, 0);
  assert.match(tab.approval.note, /never approved automatically/i);
});

test('an indexing workspace cannot be approved mid-flight', () => {
  const tab = toWorkspaceTab(model({ health: 'indexing', index: { version: 41, state: 'experimental', files: 5, chunks: 9, lastSyncAt: NOW } }));
  assert.equal(tab.approval.state, 'indexing');
  assert.equal(tab.approval.actions.length, 0);
});

// ── Lifecycle action availability ────────────────────────────────────────────

test('lifecycle actions mirror the mapper enablement, with reasons when disabled', () => {
  const ready = toWorkspaceTab(model());
  assert.deepEqual(
    ready.actions.map((action) => action.id),
    ['sync', 'rebuild', 'changeMemory', 'diagnostics', 'refreshWorkspace', 'delete'],
  );
  assert.ok(ready.actions.every((action) => action.disabled !== true), 'all enabled when not indexing');

  const indexing = toWorkspaceTab(model({ health: 'indexing' }));
  const sync = indexing.actions.find((action) => action.id === 'sync');
  const rebuild = indexing.actions.find((action) => action.id === 'rebuild');
  assert.equal(sync?.disabled, true);
  assert.equal(rebuild?.disabled, true);
  assert.match(sync?.disabledReason ?? '', /already indexing/i);
});

test('delete is always styled as destructive', () => {
  const tab = toWorkspaceTab(model());
  assert.equal(tab.actions.find((action) => action.id === 'delete')?.kind, 'danger');
});

// ── Empty / loading / disconnected ───────────────────────────────────────────

test('no open workspace offers Open, and never fabricates index numbers', () => {
  const tab = emptyWorkspaceTab();
  assert.equal(tab.state, 'empty');
  assert.deepEqual(tab.actions.map((action) => action.id), ['open']);
  assert.equal(tab.approval.state, 'not-indexed');
  assert.equal(tab.panels.length, 0, 'no sections invented without engine state');
});

test('an unreachable engine is disconnected, not "no workspace"', () => {
  const tab = emptyWorkspaceTab('The MigraAI engine is unreachable.', true);
  assert.equal(tab.state, 'disconnected');
  assert.match(tab.message ?? '', /unreachable/);
});

test('loading is distinct from empty and offers no actions', () => {
  const tab = loadingWorkspaceTab();
  assert.equal(tab.state, 'loading');
  assert.equal(tab.actions.length, 0, 'no action can be taken before state is known');
});

// ── Intent allow-list ────────────────────────────────────────────────────────

test('only the eight workspace intents are accepted', () => {
  assert.deepEqual(
    [...WORKSPACE_INTENTS],
    ['open', 'sync', 'rebuild', 'approve', 'changeMemory', 'diagnostics', 'delete', 'refreshWorkspace'],
  );
  for (const intent of WORKSPACE_INTENTS) assert.equal(isWorkspaceIntent(intent), true);
  for (const bogus of ['execute', 'resume', 'approveAgent', '', undefined, null, 42]) {
    assert.equal(isWorkspaceIntent(bogus), false, `${String(bogus)} must be refused`);
  }
});

test('every id the tab can emit is on the intent allow-list', () => {
  const tab = toWorkspaceTab(model());
  const emitted = [...tab.actions, ...tab.approval.actions, ...emptyWorkspaceTab().actions].map((action) => action.id);
  for (const id of emitted) {
    assert.equal(isWorkspaceIntent(id), true, `${id} is emitted but not on the allow-list`);
  }
});

// ── Construction-order regression ────────────────────────────────────────────

test('the workspace controller is injected LAZILY, not captured at construction', () => {
  // The shell is constructed before `workspaceController` is assigned during
  // activation. Capturing the instance captured `undefined`, so every workspace
  // read failed as a misleading "engine unreachable". The dep must therefore be
  // a function, resolved on use.
  const source = readFileSync(path.resolve(__dirname, '../../panel/shell/shellProvider.js'), 'utf8');
  assert.match(source, /this\.deps\.workspaceController\(\)/, 'the controller must be resolved by calling the accessor');
  assert.doesNotMatch(
    source,
    /this\.deps\.workspaceController(?!\()/,
    'the controller instance must never be read directly — construction order would break it',
  );
});

// ── Shell integration ────────────────────────────────────────────────────────

test('Workspace is the fifth tab and resolves as a real tab id', () => {
  assert.deepEqual(
    SHELL_TABS.map((tab) => tab.label),
    ['MigraPilot Chat', 'Agent Workspace', 'Run Diff', 'Audit Trail', 'Workspace'],
  );
  assert.equal(isShellTab('workspace'), true);
  assert.ok(knownIcons().includes('database'), 'the Workspace tab icon must exist');
});

function baseInput(overrides: Partial<ShellStateInput> = {}): ShellStateInput {
  return {
    now: NOW,
    brainEndpoint: 'http://127.0.0.1:3988',
    agentModeActive: false,
    voiceSupported: false,
    ...overrides,
  };
}

test('the shell state resolves the Workspace tab independently of every other panel', () => {
  assert.equal(buildShellState(baseInput()).workspace.state, 'empty');
  assert.equal(buildShellState(baseInput({ workspaceLoading: true })).workspace.state, 'loading');
  assert.equal(buildShellState(baseInput({ workspaceError: 'engine unreachable' })).workspace.state, 'disconnected');

  const ready = buildShellState(baseInput({ workspaceModel: model() }));
  assert.equal(ready.workspace.state, 'ready');
  assert.equal(ready.workspace.name, 'MigraTeck-Ecosystem');
  assert.equal(ready.workspace.approval.state, 'required');
  // A Brain outage must not blank the Workspace tab.
  const degradedBrain = buildShellState(baseInput({ brainError: 'unreachable', workspaceModel: model() }));
  assert.equal(degradedBrain.workspace.state, 'ready');
});

test('a fully-populated shell state still leaks no workspace internals', () => {
  const serialized = JSON.stringify(buildShellState(baseInput({ workspaceModel: model() })));
  assert.doesNotMatch(serialized, /ws_7f3a91/);
  assert.doesNotMatch(serialized, /supersecret/);
  assert.doesNotMatch(serialized, /home\/bonex/);
  assert.doesNotMatch(serialized, /"indexVersion"/);
});
