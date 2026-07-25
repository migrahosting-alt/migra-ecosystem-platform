import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentModeCommandRunView } from '@migrapilot/protocol';
import { buildShellState, type ShellStateInput } from '../../panel/shell/shellState.js';
import { ActivityRecorder, toBrainHealthPanel, toContextFilesPanel, toRecentActivityPanel, toWorkspaceContextPanel } from '../../panel/shell/contextPanelModel.js';
import { SHELL_TABS, isShellTab, toToolsStatusList } from '../../panel/shell/navigationModel.js';
import { WELCOME_ACTIONS, HEADER_ACTIONS } from '../../panel/shell/welcomeModel.js';
import { knownIcons } from '../../panel/shell/icons.js';
import { display, formatDuration, relativeAge, shortenId, UNAVAILABLE } from '../../panel/shell/types.js';

const NOW = 1_700_000_000_000;
const ENDPOINT = 'http://127.0.0.1:3988';

function baseInput(overrides: Partial<ShellStateInput> = {}): ShellStateInput {
  return {
    now: NOW,
    brainEndpoint: ENDPOINT,
    agentModeActive: false,
    voiceSupported: true,
    ...overrides,
  };
}

const HEALTHY = {
  status: 'ok',
  version: '0.1.0',
  uptimeSec: 900,
  readiness: { process: 'running', inferenceProviders: 'available', persistence: 'ready', schemaVersion: 5, migrationState: 'current' },
  operational: { status: 'healthy', reachable: true, schemaCurrent: true, schemaVersion: 5, integrity: 'ok', retentionWorker: 'running' },
};

// ── Honest formatting primitives ─────────────────────────────────────────────

test('missing values render as an em dash, never as a reassuring default', () => {
  assert.equal(display(undefined), UNAVAILABLE);
  assert.equal(display(null), UNAVAILABLE);
  assert.equal(display('   '), UNAVAILABLE);
  assert.equal(display(0), '0');
  assert.equal(relativeAge(undefined, NOW), UNAVAILABLE);
  assert.equal(formatDuration(undefined), UNAVAILABLE);
  assert.equal(formatDuration(-1), UNAVAILABLE);
  assert.equal(shortenId(undefined), UNAVAILABLE);
});

test('relative age and duration formatting are readable', () => {
  assert.equal(relativeAge(NOW - 10_000, NOW), 'just now');
  assert.equal(relativeAge(NOW - 300_000, NOW), '5m ago');
  assert.equal(relativeAge(NOW - 7_200_000, NOW), '2h ago');
  assert.equal(relativeAge(NOW - 86_400_000, NOW), 'yesterday');
  assert.equal(formatDuration(900), '15m 00s');
  assert.equal(formatDuration(90_000), '1d 01h 00m');
});

test('run ids shorten for headers but keep both ends for correlation', () => {
  const id = 'agentcmd_8d704cc4-e182-456b-91bc-5ef1a0318d66';
  const short = shortenId(id);
  assert.ok(short.length < id.length);
  assert.ok(short.startsWith('agentcmd_8d7'));
  assert.ok(short.endsWith('318d66'));
  assert.equal(shortenId('short-id'), 'short-id');
});

// ── Brain health ─────────────────────────────────────────────────────────────

test('a healthy brain reports canonical readiness fields', () => {
  const panel = toBrainHealthPanel(ENDPOINT, HEALTHY);
  assert.equal(panel.state, 'ready');
  assert.deepEqual({ text: panel.badge.text, tone: panel.badge.tone }, { text: 'Healthy', tone: 'ok' });
  const rows = new Map(panel.rows.map((row) => [row.label, row.value]));
  assert.equal(rows.get('Endpoint'), ENDPOINT);
  assert.equal(rows.get('Version'), '0.1.0');
  assert.equal(rows.get('Uptime'), '15m 00s');
  assert.equal(rows.get('Schema version'), '5');
  assert.equal(rows.get('Integrity'), 'ok');
  assert.equal(rows.get('Retention worker'), 'running');
  assert.equal(rows.get('Persistence'), 'ready');
});

test('a disconnected brain shows a bounded placeholder with a safe retry', () => {
  const panel = toBrainHealthPanel(ENDPOINT, undefined, 'The Brain service is unreachable.');
  assert.equal(panel.state, 'disconnected');
  assert.equal(panel.badge.tone, 'error');
  assert.equal(panel.placeholder?.state, 'disconnected');
  assert.equal(panel.placeholder?.retryCommand, 'repairConnection');
  // Never fabricates a version/uptime it could not read.
  assert.equal(panel.rows.length, 1);
});

test('brain health with no snapshot yet is "loading", not "healthy"', () => {
  const panel = toBrainHealthPanel(ENDPOINT, undefined);
  assert.equal(panel.state, 'loading');
  assert.equal(panel.badge.tone, 'muted');
});

test('a degraded brain is amber and reports the degraded axes verbatim', () => {
  const panel = toBrainHealthPanel(ENDPOINT, {
    ...HEALTHY,
    status: 'degraded',
    readiness: { ...HEALTHY.readiness, persistence: 'unavailable' },
    operational: { ...HEALTHY.operational, integrity: 'malformed page at row 4', retentionWorker: 'stopped', schemaCurrent: false },
  });
  assert.equal(panel.state, 'degraded');
  assert.equal(panel.badge.tone, 'warn');
  const rows = new Map(panel.rows.map((row) => [row.label, [row.value, row.tone]]));
  assert.deepEqual(rows.get('Integrity'), ['malformed page at row 4', 'error']);
  assert.deepEqual(rows.get('Retention worker'), ['stopped', 'warn']);
  assert.deepEqual(rows.get('Persistence'), ['unavailable', 'warn']);
});

// ── Workspace context ────────────────────────────────────────────────────────

test('workspace context reports clean, dirty and unavailable honestly', () => {
  const clean = toWorkspaceContextPanel({ repository: 'MigraTeck-Ecosystem', branch: 'phase-1/canonical-vscode-extension', clean: true, changedFileCount: 0, ahead: 0, behind: 0 });
  assert.equal(clean.state, 'ready');
  const cleanRows = new Map(clean.rows.map((row) => [row.label, [row.value, row.tone]]));
  assert.deepEqual(cleanRows.get('Status'), ['Clean', 'ok']);
  assert.deepEqual(cleanRows.get('Ahead / Behind'), ['0 / 0', 'muted']);

  const dirty = toWorkspaceContextPanel({ repository: 'repo', branch: 'main', clean: false, changedFileCount: 7, ahead: 2, behind: 1 });
  const dirtyRows = new Map(dirty.rows.map((row) => [row.label, [row.value, row.tone]]));
  assert.deepEqual(dirtyRows.get('Status'), ['7 changed', 'warn']);
  assert.deepEqual(dirtyRows.get('Ahead / Behind'), ['2 / 1', 'info']);

  const unavailable = toWorkspaceContextPanel({ repository: 'repo', unavailableReason: 'This folder is not a Git repository.' });
  assert.equal(unavailable.state, 'disconnected');
  assert.equal(unavailable.rows.length, 0);

  assert.equal(toWorkspaceContextPanel(undefined).state, 'loading');
});

// ── Agent context: activation is STATUS ONLY ─────────────────────────────────

test('agent context requires activation and never exposes capability material', () => {
  const state = buildShellState(baseInput({ activation: { valid: false } }));
  assert.equal(state.context.agent.state, 'activation-required');
  assert.equal(state.context.agent.placeholder?.retryCommand, 'pairAgentMode');
  const rows = new Map(state.context.agent.rows.map((row) => [row.label, row.value]));
  assert.equal(rows.get('Activation'), 'Required');
});

test('a valid activation shows only "Valid" plus non-secret status', () => {
  const state = buildShellState(
    baseInput({
      agentModeActive: true,
      policy: 'Local First',
      activation: { valid: true, workspaceLabel: 'dev', allowedRecipes: ['git.status', 'git.diff'], expiresAt: NOW + 600_000 },
    }),
  );
  const panel = state.context.agent;
  assert.equal(panel.state, 'ready');
  const rows = new Map(panel.rows.map((row) => [row.label, row.value]));
  assert.equal(rows.get('Activation'), 'Valid');
  assert.equal(rows.get('Workspace'), 'dev');
  assert.equal(rows.get('Policy'), 'Local First');
  assert.equal(rows.get('Approval TTL'), '10m 00s');
  assert.equal(rows.get('Allowed recipes'), 'git.status, git.diff');
  // The whole state must be free of anything capability-shaped.
  const serialized = JSON.stringify(state);
  assert.doesNotMatch(serialized, /activationCapability/i);
  assert.doesNotMatch(serialized, /bootstrapSecret/i);
  assert.doesNotMatch(serialized, /fingerprint/i);
});

// ── Agent workspace gating ───────────────────────────────────────────────────

test('the agent workspace is blocked until activation, then until explicit entry', () => {
  const unactivated = buildShellState(baseInput({ activation: { valid: false } }));
  assert.equal(unactivated.agent.blocked?.state, 'activation-required');
  assert.equal(unactivated.agent.recipes.length, 0, 'no recipes offered without activation');

  const activatedButNotEntered = buildShellState(
    baseInput({ activation: { valid: true, allowedRecipes: ['git.status'] }, agentModeActive: false }),
  );
  assert.equal(activatedButNotEntered.agent.blocked?.state, 'unauthorized');
  assert.match(activatedButNotEntered.agent.blocked?.message ?? '', /Enter Agent Mode explicitly/);

  const entered = buildShellState(
    baseInput({ activation: { valid: true, allowedRecipes: ['git.status', 'git.diff'] }, agentModeActive: true }),
  );
  assert.equal(entered.agent.blocked, undefined);
  assert.deepEqual(entered.agent.recipes.map((recipe) => recipe.id), ['git.status', 'git.diff']);
});

// ── Navigation counts ────────────────────────────────────────────────────────

test('agent mode counts are blank (not zero) when history is unreadable', () => {
  const state = buildShellState(baseInput({ historyError: { kind: 'activation', message: 'Activation required.' } }));
  const nav = state.nav.agentMode;
  assert.equal(nav.pendingApprovals, undefined, 'unknown must not render as 0');
  assert.equal(nav.activeRuns, undefined);
  assert.equal(nav.runHistory, undefined);
  assert.match(nav.countsNote ?? '', /Activation required/);
});

test('agent mode counts are derived from canonical durable + runtime state', () => {
  const activeRun = {
    runId: 'run-live',
    requestId: 'req-live',
    state: 'AWAITING_APPROVAL',
    createdAt: NOW,
    updatedAt: NOW,
  } as AgentModeCommandRunView;
  const state = buildShellState(
    baseInput({
      activeRun,
      history: {
        runs: [
          { runId: 'run-1', state: 'COMPLETED' },
          { runId: 'run-2', state: 'EXECUTING' },
          { runId: 'run-3', state: 'AWAITING_APPROVAL' },
        ],
        query: { sort: 'updatedAt.desc', limit: 25 },
        retention: { terminalRetentionMs: 604_800_000, retentionBatchSize: 50, tombstoneCount: 0, governance: 'READ_ONLY' },
      } as never,
    }),
  );
  const nav = state.nav.agentMode;
  // 1 pending in history + the live run not yet in history = 2.
  assert.equal(nav.pendingApprovals, 2);
  // 1 executing in history + the live AWAITING_APPROVAL run = 2.
  assert.equal(nav.activeRuns, 2);
  assert.equal(nav.runHistory, 3);
});

// ── Tools & services ─────────────────────────────────────────────────────────

test('tool statuses never fabricate Online / Ready / Healthy', () => {
  const unknown = toToolsStatusList({});
  assert.deepEqual(
    unknown.map((row) => [row.id, row.value, row.tone]),
    [
      ['brain', 'Unknown', 'muted'],
      ['models', 'Unknown', 'muted'],
      ['git', 'Unknown', 'muted'],
      ['policy', 'Unknown', 'muted'],
      ['audit', 'Unknown', 'muted'],
    ],
  );

  const live = toToolsStatusList({ brainStatus: 'ok', modelCount: 4, gitAvailable: true, policy: 'Local First', auditStatus: 'healthy' });
  assert.deepEqual(
    live.map((row) => [row.value, row.tone]),
    [
      ['Online', 'ok'],
      ['4 ready', 'ok'],
      ['Connected', 'ok'],
      ['Local First', 'info'],
      ['Healthy', 'ok'],
    ],
  );

  const degraded = toToolsStatusList({ brainStatus: 'degraded', modelCount: 0, gitAvailable: false, auditStatus: 'disabled' });
  assert.deepEqual(
    degraded.map((row) => [row.value, row.tone]),
    [
      ['Degraded', 'warn'],
      ['None approved', 'warn'],
      ['Not a repository', 'muted'],
      ['Unknown', 'muted'],
      ['Disabled', 'warn'],
    ],
  );
});

// ── Status summary ───────────────────────────────────────────────────────────

test('the status row reflects connection, schema, policy and Agent Mode', () => {
  const connected = buildShellState(
    baseInput({
      brainHealth: HEALTHY,
      git: { repository: 'repo', branch: 'phase-1/canonical-vscode-extension', clean: true, changedFileCount: 0 },
      policy: 'Local First',
      agentModeActive: true,
    }),
  );
  const items = new Map(connected.status.items.map((item) => [item.label, [item.value, item.tone]]));
  assert.deepEqual(items.get('Branch'), ['phase-1/canonical-vscode-extension', 'info']);
  assert.deepEqual(items.get('MigraPilot'), ['Connected', 'ok']);
  assert.deepEqual(items.get('Brain'), ['Healthy', 'ok']);
  assert.deepEqual(items.get('Schema'), ['v5', undefined]);
  assert.deepEqual(items.get('Policy'), ['Local First', 'info']);
  assert.deepEqual(items.get('Agent Mode'), ['Governed', 'governed']);

  const offline = buildShellState(baseInput({ brainError: 'unreachable' }));
  const offlineItems = new Map(offline.status.items.map((item) => [item.label, [item.value, item.tone]]));
  assert.deepEqual(offlineItems.get('MigraPilot'), ['Disconnected', 'error']);
  assert.deepEqual(offlineItems.get('Brain'), ['Unknown', 'muted']);
  assert.equal(offline.composer.connected, false, 'the composer must be blocked while disconnected');
});

// ── Run diff ─────────────────────────────────────────────────────────────────

test('the run diff surface distinguishes loading, empty, error and ready', () => {
  assert.equal(buildShellState(baseInput()).diff.state, 'loading');
  assert.equal(buildShellState(baseInput({ workingChanges: [] })).diff.state, 'empty');
  assert.equal(buildShellState(baseInput({ workingChangesError: 'no git' })).diff.state, 'disconnected');

  const ready = buildShellState(
    baseInput({
      workingChanges: [
        { path: 'src/a.ts', status: 'M', added: 10, removed: 2, binary: false, staged: true },
        { path: 'src/b.ts', status: 'A', added: 5, removed: 0, binary: false, staged: false },
      ],
    }),
  ).diff;
  assert.equal(ready.state, 'ready');
  const rows = new Map(ready.rows.map((row) => [row.label, row.value]));
  assert.equal(rows.get('Files changed'), '2');
  assert.equal(rows.get('Additions'), '+15');
  assert.equal(rows.get('Deletions'), '-2');
  assert.equal(rows.get('Staged'), '1');
});

// ── Context files & activity ─────────────────────────────────────────────────

test('context files report why each file is present, and empty state offers Add', () => {
  const empty = toContextFilesPanel([]);
  assert.equal(empty.state, 'empty');
  assert.deepEqual(empty.actions?.map((action) => action.id), ['addContext']);

  const filled = toContextFilesPanel([
    { path: 'src/server.ts', kind: 'active-editor', reason: 'open in the active editor' },
    { path: 'notes.md', kind: 'attachment' },
  ]);
  assert.equal(filled.state, 'ready');
  assert.deepEqual(filled.rows.map((row) => [row.label, row.value]), [
    ['src/server.ts', 'open in the active editor'],
    ['notes.md', 'attached'],
  ]);
});

test('the activity feed is bounded, newest-first, and empty until something happens', () => {
  assert.equal(toRecentActivityPanel([], NOW).state, 'empty');

  const recorder = new ActivityRecorder(3);
  recorder.record('first', 'info', NOW - 3000);
  recorder.record('second', 'ok', NOW - 2000);
  recorder.record('third', 'warn', NOW - 1000);
  recorder.record('fourth', 'error', NOW);
  const entries = recorder.list();
  assert.equal(entries.length, 3, 'bounded to the limit');
  assert.deepEqual(entries.map((entry) => entry.text), ['fourth', 'third', 'second']);

  const panel = toRecentActivityPanel(entries, NOW);
  assert.equal(panel.state, 'ready');
  assert.equal(panel.rows[0]?.label, 'fourth');
  assert.equal(panel.rows[0]?.value, 'just now');
});

// ── Tabs, welcome actions, icons ─────────────────────────────────────────────

test('the tab set matches the approved mockup exactly and validates', () => {
  assert.deepEqual(SHELL_TABS.map((tab) => tab.label), ['MigraPilot Chat', 'Agent Workspace', 'Run Diff', 'Audit Trail']);
  assert.equal(isShellTab('chat'), true);
  assert.equal(isShellTab('audit'), true);
  assert.equal(isShellTab('nope'), false);
  assert.equal(isShellTab(undefined), false);
});

test('the six welcome cards match the mockup and every one has a real effect', () => {
  assert.deepEqual(WELCOME_ACTIONS.map((action) => action.title), [
    'Build or Fix Code',
    'Inspect & Analyze',
    'Run Agent Task',
    'Diagnose System',
    'Review Changes',
    'Run History',
  ]);
  for (const action of WELCOME_ACTIONS) {
    assert.ok(action.effect.kind === 'command' || action.effect.kind === 'prompt' || action.effect.kind === 'tab');
    if (action.effect.kind === 'tab') assert.equal(isShellTab(action.effect.tab), true, `${action.id} targets a real tab`);
    if (action.effect.kind === 'prompt') assert.ok(action.effect.prompt.length > 10);
  }
});

test('every icon referenced by a model exists in the icon set', () => {
  const available = new Set(knownIcons());
  for (const action of WELCOME_ACTIONS) assert.ok(available.has(action.icon), `missing icon ${action.icon}`);
  for (const action of HEADER_ACTIONS) assert.ok(available.has(action.icon), `missing icon ${action.icon}`);
  for (const tab of SHELL_TABS) assert.ok(available.has(tab.icon), `missing icon ${tab.icon}`);
});

// ── Whole-state sanitation sweep ─────────────────────────────────────────────

test('a fully-populated shell state contains no secret-bearing field names', () => {
  const state = buildShellState(
    baseInput({
      brainHealth: HEALTHY,
      git: { repository: 'repo', branch: 'main', clean: false, changedFileCount: 3, ahead: 1, behind: 0, latestCommitShort: 'b557cf4', latestCommitSubject: 'Merge PR #99' },
      workspaceName: 'dev',
      policy: 'Local First',
      agentModeActive: true,
      activation: { valid: true, workspaceLabel: 'dev', allowedRecipes: ['git.status'], expiresAt: NOW + 60_000 },
      conversations: [
        { id: 'c1', ownerScope: 'local', workspaceScope: 'dev', title: 'Evidence Export Sanitation', memoryMode: 'durable', createdAt: NOW - 5000, updatedAt: NOW - 1000 },
      ],
      activeConversationId: 'c1',
      modelCount: 3,
      workingChanges: [{ path: 'src/a.ts', status: 'M', added: 1, removed: 1, binary: false, staged: false }],
      contextFiles: [{ path: 'src/a.ts', kind: 'active-editor' }],
      activity: [{ at: NOW, text: 'Brain lifecycle: started', tone: 'ok' }],
    }),
  );
  const serialized = JSON.stringify(state);
  for (const forbidden of ['activationCapability', 'bootstrapSecret', 'fingerprint', 'snapshotId', 'workspaceMaterialFingerprint', 'Authorization', 'x-migrapilot-agent-capability']) {
    assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'), `state must not mention ${forbidden}`);
  }
  // Sanity: the state IS populated, so the sweep above is meaningful.
  assert.equal(state.nav.conversations.state, 'ready');
  assert.equal(state.context.brain.state, 'ready');
  assert.equal(state.composer.connected, true);
});
