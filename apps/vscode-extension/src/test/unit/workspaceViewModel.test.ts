import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  toPanelModel,
  statusFor,
  sanitizeGitRepo,
  resolveWorkspaceRoot,
  deleteScopeFor,
} from '../../panel/workspaceViewModel.js';
import type { WorkspaceView, AgentDescriptor } from '../../services/migraAiClient.js';

function view(overrides: Partial<Omit<WorkspaceView, 'workspace' | 'index'>> & { workspace?: Partial<WorkspaceView['workspace']>; index?: Partial<WorkspaceView['index']> } = {}): WorkspaceView {
  const base: WorkspaceView = {
    workspace: { id: 'ws_secret123', name: 'app', root: '/repo/app', gitRepo: 'git@example.com:migra/app.git', gitBranch: 'main', memoryMode: 'durable', indexId: 'idx_secret9', lastSyncAt: undefined, createdAt: 1, updatedAt: 2 },
    health: 'needs-sync',
    index: { id: 'idx_secret9', version: 0, state: 'experimental', files: 0, chunks: 0, embeddingModel: 'nomic-embed-text', lastSyncAt: undefined, pendingSync: true },
    memory: { mode: 'durable', activeConversations: 2 },
    agents: ['workspace.explain', 'workspace.refactor'],
    models: { coding: ['qwen3-coder:30b'], reasoning: ['deepseek-r1:14b'], general: ['qwen3:14b'], vision: [], embedding: ['nomic-embed-text'] },
    versions: { engineVersion: '1.0.0-alpha.1', protocolVersion: 1, schemaVersion: 1, registryVersion: 1, ragVersion: 1, memoryVersion: 1, qualificationVersion: 1 },
  };
  return { ...base, ...overrides, workspace: { ...base.workspace, ...overrides.workspace }, index: { ...base.index, ...overrides.index } };
}

test('status language maps each engine health to operator wording', () => {
  assert.deepEqual(statusFor('ready'), { label: 'Ready', tone: 'ok' });
  assert.deepEqual(statusFor('needs-approval'), { label: 'Needs approval', tone: 'warn' });
  assert.deepEqual(statusFor('indexing'), { label: 'Syncing', tone: 'info' });
  assert.deepEqual(statusFor('degraded'), { label: 'Degraded', tone: 'error' });
  assert.deepEqual(statusFor('needs-sync'), { label: 'Not indexed', tone: 'warn' });
});

test('view-model maps sections and keeps internal ids out of the rendered rows', () => {
  const m = toPanelModel(view({ health: 'needs-approval', index: { version: 3, state: 'evaluated', files: 5, chunks: 42, embeddingModel: 'nomic-embed-text', lastSyncAt: 1000, pendingSync: false, id: 'idx_secret9' }, workspace: { lastSyncAt: 1000 } }), { now: 1000 });
  assert.equal(m.name, 'app');
  assert.deepEqual(m.status, { label: 'Needs approval', tone: 'warn' });
  // Internal ids ride on the model for dispatch but must not appear in any row.
  assert.equal(m.workspaceId, 'ws_secret123');
  assert.equal(m.indexVersion, 3);
  const rendered = JSON.stringify(m.sections);
  assert.ok(!rendered.includes('ws_secret123'), 'workspace id not rendered');
  assert.ok(!rendered.includes('idx_secret9'), 'index id not rendered');
  // Semantic Index section reflects the engine state.
  const idxSection = m.sections.find((s) => s.title === 'Semantic Index')!;
  assert.equal(idxSection.rows.find((r) => r.label === 'Chunks')!.value, '42');
  assert.equal(idxSection.rows.find((r) => r.label === 'Pending approval')!.value, 'yes');
});

test('git remote credentials are stripped before rendering', () => {
  assert.equal(sanitizeGitRepo('https://user:ghp_tokenABC@github.com/migra/app.git'), 'https://github.com/migra/app.git');
  assert.equal(sanitizeGitRepo('git@example.com:migra/app.git'), 'git@example.com:migra/app.git');
  assert.equal(sanitizeGitRepo(undefined), undefined);
  const m = toPanelModel(view({ workspace: { gitRepo: 'https://bob:secretpat@gitlab.com/x/y.git' } }));
  const repoRow = m.sections.find((s) => s.title === 'Workspace')!.rows.find((r) => r.label === 'Git repo')!;
  assert.equal(repoRow.value, 'https://gitlab.com/x/y.git');
  assert.ok(!JSON.stringify(m).includes('secretpat'), 'no credential leaks anywhere in the model');
});

test('agents split read-only vs mutating when descriptors are provided', () => {
  const descriptors: AgentDescriptor[] = [
    { kind: 'agent', id: 'workspace.explain', version: '1', displayName: 'Explain', purpose: '', operationClasses: [], requiredModelCapabilities: [], requiredToolCapabilities: [], readOnly: true, approvalRequired: false, resumable: false, cancellable: true, maxSteps: 1, maxRuntimeMs: 1, available: true },
    { kind: 'agent', id: 'workspace.refactor', version: '1', displayName: 'Refactor', purpose: '', operationClasses: [], requiredModelCapabilities: [], requiredToolCapabilities: [], readOnly: false, approvalRequired: true, resumable: true, cancellable: true, maxSteps: 1, maxRuntimeMs: 1, available: true },
  ];
  const m = toPanelModel(view(), { agents: descriptors });
  const agents = m.sections.find((s) => s.title === 'Agents')!;
  assert.equal(agents.rows.find((r) => r.label === 'Read-only')!.value, 'workspace.explain');
  assert.equal(agents.rows.find((r) => r.label === 'Mutating')!.value, 'workspace.refactor');
});

test('approve action is offered ONLY when an indexed version needs approval', () => {
  assert.equal(toPanelModel(view({ health: 'needs-sync', index: { version: 0, state: 'experimental', files: 0, chunks: 0, pendingSync: true } })).actions.approve, false, 'nothing indexed → no approve');
  assert.equal(toPanelModel(view({ health: 'needs-approval', index: { version: 2, state: 'evaluated', files: 3, chunks: 20, pendingSync: false } })).actions.approve, true, 'indexed, unapproved → approve');
  assert.equal(toPanelModel(view({ health: 'ready', index: { version: 2, state: 'approved', files: 3, chunks: 20, pendingSync: false } })).actions.approve, false, 'already approved → no approve');
  assert.equal(toPanelModel(view({ health: 'indexing', index: { version: 2, state: 'evaluated', files: 3, chunks: 20, pendingSync: false } })).actions.approve, false, 'syncing → no approve');
  // Sync/rebuild are disabled while indexing so a second run cannot race.
  assert.equal(toPanelModel(view({ health: 'indexing' })).actions.sync, false);
  assert.equal(toPanelModel(view({ health: 'indexing' })).actions.rebuild, false);
});

test('approve binds to the CURRENT index version so a stale approval is impossible', () => {
  const m = toPanelModel(view({ health: 'needs-approval', index: { version: 7, state: 'evaluated', files: 1, chunks: 3, pendingSync: false } }));
  assert.equal(m.indexVersion, 7, 'the version the operator sees is the version they approve');
});

test('multi-root resolution: none / single / explicit choice', () => {
  assert.deepEqual(resolveWorkspaceRoot([]), { kind: 'none' });
  assert.deepEqual(resolveWorkspaceRoot([{ name: 'app', fsPath: '/repo/app' }]), { kind: 'root', root: '/repo/app' });
  const many = resolveWorkspaceRoot([{ name: 'app', fsPath: '/repo/app' }, { name: 'lib', fsPath: '/repo/lib' }]);
  assert.equal(many.kind, 'choose');
  assert.equal((many as { options: unknown[] }).options.length, 2, 'never auto-picks a subfolder — requires selection');
});

test('delete confirmation spells out what is removed vs kept', () => {
  const scope = deleteScopeFor('app');
  assert.ok(scope.removes.some((r) => /index/i.test(r)), 'index removal disclosed');
  assert.ok(scope.removes.some((r) => /registration/i.test(r)), 'registration removal disclosed');
  assert.ok(scope.keeps.some((k) => /conversation/i.test(k)), 'conversation memory explicitly kept');
  assert.ok(scope.keeps.some((k) => /durable/i.test(k)), 'durable memory explicitly kept');
  assert.equal(scope.confirmLabel, 'Delete workspace "app"');
});
