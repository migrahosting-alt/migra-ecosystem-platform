import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { engineVersion, ENGINE_VERSION, PROTOCOL_VERSION } from '../src/engine/version.js';
import { WorkspaceManager, type WorkspaceView } from '../src/engine/workspaceManager.js';
import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';
import { ConversationStore } from '../src/engine/memory/conversationStore.js';
import { AgentRegistry } from '../src/engine/agentRegistry.js';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';

const A: Scope = { owner: 'local', workspace: '/ws/A' };
const B: Scope = { owner: 'local', workspace: '/ws/B' };

function memSource(files: Map<string, string>): FileSource {
  return { files: async () => [...files].map(([relPath, content]) => ({ relPath, content })) };
}
const APPROVED_MODELS = async (): Promise<WorkspaceView['models']> => ({
  coding: ['qwen3-coder:30b'], reasoning: ['deepseek-r1:14b'], general: ['qwen3:14b'], vision: ['llava:latest'], embedding: ['nomic-embed-text:latest'],
});
function mkManager(opts: { persistence?: SqliteDurableStore; files?: Map<string, string> } = {}) {
  const files = opts.files ?? new Map([['src/x.ts', 'export function x() { auth login }']]);
  const idx = new IndexService(new FakeEmbedder(), () => memSource(files), undefined, undefined, opts.persistence);
  const conv = new ConversationStore();
  const mgr = new WorkspaceManager({
    indexService: idx, conversations: conv, agents: new AgentRegistry(), approvedModelsByTier: APPROVED_MODELS,
    version: engineVersion, schemaVersion: () => opts.persistence?.health().schemaVersion ?? 0,
    persistence: opts.persistence, gitInfo: async () => ({ repo: 'git@example.com:migra/app.git', branch: 'main' }),
  });
  return { mgr, idx, conv, files };
}

test('engine version contract shape', () => {
  const v = engineVersion(5);
  assert.equal(v.engineVersion, ENGINE_VERSION);
  assert.equal(v.protocolVersion, PROTOCOL_VERSION);
  assert.equal(v.schemaVersion, 5);
  for (const k of ['registryVersion', 'ragVersion', 'memoryVersion', 'qualificationVersion']) assert.equal(typeof (v as unknown as Record<string, unknown>)[k], 'number');
});

test('open workspace: creates an index, detects git, is idempotent per scope', async () => {
  const { mgr } = mkManager();
  const w1 = await mgr.openWorkspace(A, { root: '/repo/app' });
  assert.ok(w1.indexId, 'an index is created');
  assert.equal(w1.gitBranch, 'main');
  assert.equal(w1.gitRepo, 'git@example.com:migra/app.git');
  assert.equal(w1.name, 'app');
  const w2 = await mgr.openWorkspace(A, { root: '/repo/app' });
  assert.equal(w2.id, w1.id, 'opening the same scope reuses the workspace (idempotent)');
  assert.equal(mgr.list(A).length, 1);
});

test('workspace isolation: B cannot see A', async () => {
  const { mgr } = mkManager();
  const w = await mgr.openWorkspace(A, { root: '/repo/app' });
  assert.equal(mgr.get(w.id, B), undefined);
  assert.equal(await mgr.view(w.id, B), undefined);
  assert.equal(mgr.list(B).length, 0);
});

test('aggregated view: index/memory/agents/models/versions + health transitions', async () => {
  const { mgr, conv } = mkManager();
  const w = await mgr.openWorkspace(A, { root: '/repo/app', memoryMode: 'durable' });
  conv.createConversation(A, { memoryMode: 'durable' });
  let view = (await mgr.view(w.id, A))!;
  assert.equal(view.health, 'needs-sync', 'no sync yet');
  assert.equal(view.index.pendingSync, true);
  assert.equal(view.memory.mode, 'durable');
  assert.equal(view.memory.activeConversations, 1);
  assert.ok(view.agents.includes('workspace.explain'));
  assert.deepEqual(view.models.coding, ['qwen3-coder:30b']);
  assert.equal(view.versions.engineVersion, ENGINE_VERSION);

  await mgr.sync(w.id, A);
  view = (await mgr.view(w.id, A))!;
  assert.ok(view.index.chunks >= 1, 'synced chunks present');
  assert.equal(view.index.pendingSync, false, 'not pending after sync (content indexed)');
  assert.equal(view.health, 'needs-approval', 'synced but not yet approved for production RAG');
});

test('sync then rebuild resets the index to a fresh (experimental) one', async () => {
  const { mgr, idx } = mkManager();
  const w = await mgr.openWorkspace(A, { root: '/repo/app' });
  await mgr.sync(w.id, A);
  const beforeIndexId = mgr.get(w.id, A)!.indexId;
  idx.setState(beforeIndexId!, A, 'approved');
  const res = await mgr.rebuild(w.id, A);
  assert.ok(res.ok);
  const afterIndexId = mgr.get(w.id, A)!.indexId;
  assert.notEqual(afterIndexId, beforeIndexId, 'rebuild creates a new index');
  assert.notEqual(idx.status(afterIndexId!, A)!.state, 'approved', 'rebuilt index is not auto-approved');
});

test('approveIndex binds to the exact current index version (stale refused)', async () => {
  const { mgr, idx } = mkManager();
  const w = await mgr.openWorkspace(A, { root: '/repo/app' });

  // Cannot approve before anything is indexed.
  const empty = await mgr.approveIndex(w.id, A, 0);
  assert.equal(empty.ok, false);
  assert.equal((empty as { code: string }).code, 'NOT_INDEXED');

  await mgr.sync(w.id, A);
  const version = idx.status(mgr.get(w.id, A)!.indexId!, A)!.version;
  assert.equal(version, 1, 'first sync produces version 1');

  // Approving a stale (older) version is refused.
  const stale = await mgr.approveIndex(w.id, A, version - 1);
  assert.equal(stale.ok, false);
  assert.equal((stale as { code: string }).code, 'STALE_VERSION');
  assert.notEqual(idx.status(mgr.get(w.id, A)!.indexId!, A)!.state, 'approved', 'stale approval did not promote');

  // Approving the exact current version succeeds → ready.
  const ok = await mgr.approveIndex(w.id, A, version);
  assert.equal(ok.ok, true);
  assert.equal((ok as { view: WorkspaceView }).view.health, 'ready');
  assert.equal(idx.status(mgr.get(w.id, A)!.indexId!, A)!.state, 'approved');
});

test('a sync after approval bumps the version, forcing re-approval of the new version', async () => {
  const { mgr, idx, files } = mkManager();
  const w = await mgr.openWorkspace(A, { root: '/repo/app' });
  await mgr.sync(w.id, A);
  const v1 = idx.status(mgr.get(w.id, A)!.indexId!, A)!.version;
  await mgr.approveIndex(w.id, A, v1);

  // Content changes → a fresh sync bumps the version and demotes the approval.
  files.set('src/y.ts', 'export function y() { return 2 }');
  const synced = await mgr.sync(w.id, A);
  assert.equal(synced.ok, true);
  assert.equal((synced as { view: WorkspaceView }).view.health, 'needs-approval', 'sync demoted the previously-approved index');
  const v2 = idx.status(mgr.get(w.id, A)!.indexId!, A)!.version;
  assert.ok(v2 > v1, 'sync bumped the version');

  // The old version can no longer be approved — the caller must observe v2.
  const stale = await mgr.approveIndex(w.id, A, v1);
  assert.equal(stale.ok, false);
  assert.equal((stale as { code: string }).code, 'STALE_VERSION');
});

test('workspace survives restart (durable) with its git + index binding', () => {
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-ws-')), 'state.db');
  const store1 = new SqliteDurableStore(dbPath);
  const { mgr: mgr1 } = mkManager({ persistence: store1 });
  // openWorkspace is async; run synchronously via a resolved promise chain.
  return (async () => {
    const w = await mgr1.openWorkspace(A, { root: '/repo/app', memoryMode: 'durable' });
    store1.close();

    const store2 = new SqliteDurableStore(dbPath);
    const { mgr: mgr2 } = mkManager({ persistence: store2 });
    mgr2.hydrate();
    const restored = mgr2.get(w.id, A);
    assert.ok(restored, 'workspace survives restart');
    assert.equal(restored!.gitBranch, 'main');
    assert.equal(restored!.memoryMode, 'durable');
    assert.equal(restored!.indexId, w.indexId, 'index binding preserved');
    assert.equal(mgr2.get(w.id, B), undefined, 'isolation holds after restart');
    store2.close();
  })();
});
