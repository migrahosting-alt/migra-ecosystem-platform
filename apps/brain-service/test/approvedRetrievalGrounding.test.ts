import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import Fastify from 'fastify';

import { registerEngineerRoutes } from '../src/engine/engineerRoutes.js';
import { registerToolExecutionRoutes } from '../src/engine/toolRoutes.js';
import { ModelRegistry, type ModelDescriptor } from '../src/engine/modelRegistry.js';
import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';
import { AuditStore, auditStore } from '../src/engine/auditLog.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SqliteDurableStore } from '../src/engine/persistence/sqliteStore.js';
import { wireOperationalPersistence } from '../src/engine/persistence/operationalBridge.js';
import { UsageLedger } from '../src/engine/providers/budget/usageLedger.js';
import { IncidentManager, LocalAlertSink } from '../src/engine/incidents.js';
import { BudgetManager } from '../src/engine/providers/budget/budgetManager.js';
import { DEFAULT_MIN_APPROVED_SCORE, decideGrounding, groundingAuditFields } from '../src/engine/grounding/groundingDecision.js';

/**
 * An approved-only request must never be answered from the working tree.
 *
 * Historical failure (run corr_ms1iwdhw4lbyim): asked to analyse code using only
 * the approved semantic index, the engineer route seeded the loop from a LEXICAL
 * retriever over the live checkout, cited three `package.json` files and a
 * `PROVENANCE.md`, and disclosed nothing. The approved index was never consulted:
 * that route had no retrieval boundary at all, and `/api/ai/chat` — which did —
 * silently replaced approved evidence with working-tree chunks whenever approved
 * retrieval came back empty.
 */

const STUB_ENV = { localProvider: 'stub', providerBaseUrl: '', openAiApiKey: undefined } as never;
const CAPS = { chat: true, vision: false, tools: true, embedding: false, reasoning: true, coding: true, insert: false };
const A: Scope = { owner: 'local', workspace: 'default' };

const stubAdapter = {
  async complete() {
    return { content: 'ANSWER: done', modelId: 'm', providerId: 'local' };
  },
  async *stream() {
    yield { delta: 'ANSWER: done' } as never;
  },
  async isAvailable() {
    return true;
  },
} as never;

function model(id: string): ModelDescriptor {
  return { id, provider: 'local', capabilities: CAPS, tier: 'balanced' };
}

function frames(body: string): Array<{ event: string; data: Record<string, unknown> }> {
  const out: Array<{ event: string; data: Record<string, unknown> }> = [];
  for (const block of body.split('\n\n')) {
    const ev = /event: (.+)/.exec(block);
    const da = /data: (.+)/.exec(block);
    if (ev && da) {
      try {
        out.push({ event: ev[1]!, data: JSON.parse(da[1]!) as Record<string, unknown> });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

const noSource = (): FileSource => ({ files: async () => [] });

/** An index service holding one APPROVED index over the given files. */
async function approvedIndex(files: Array<{ relPath: string; content: string }>): Promise<{ svc: IndexService; id: string }> {
  const svc = new IndexService(new FakeEmbedder(64), () => ({ files: async () => files }), undefined, undefined, undefined);
  const rec = await svc.createIndex(A, { sourceType: 'workspace', root: '/repo' });
  await svc.sync(rec.id, A);
  await svc.setState(rec.id, A, 'approved');
  return { svc, id: rec.id };
}

interface Harness {
  app: ReturnType<typeof Fastify>;
}

function appWith(svc: IndexService | undefined, indexedBranch?: string): Harness {
  const app = Fastify({ logger: false });
  const toolDeps = registerToolExecutionRoutes(app);
  registerEngineerRoutes(
    app,
    STUB_ENV,
    new ModelRegistry({ sources: [], staticModels: [model('qwen2.5-coder:14b')] }),
    toolDeps,
    () => stubAdapter,
    undefined,
    undefined,
    svc,
    indexedBranch ? () => indexedBranch : undefined,
  );
  return { app };
}

let seq = 0;
/** Drive the real route with a KNOWN correlation id, so the audit record for this
 * exact run can be read back out of the shared store. */
async function ask(h: Harness, payload: Record<string, unknown>): Promise<{ body: string; statusCode: number; correlationId: string }> {
  const correlationId = `test-grounding-${process.pid}-${(seq += 1)}`;
  const res = await h.app.inject({
    method: 'POST',
    url: '/api/ai/engineer',
    headers: { 'x-correlation-id': correlationId },
    payload: { rootPath: mkdtempSync(tmpdir() + '/grounding-'), task: 'explain the exclusion engine', ...payload },
  });
  return { body: res.body, statusCode: res.statusCode, correlationId };
}

const decisionFor = (correlationId: string) =>
  auditStore.byCorrelation(correlationId).find((r) => r.type === 'retrieval.decided');

// ── 1 + 2: approved-only with no relevant evidence refuses, tools withheld ────

test('approved-only request with no relevant approved evidence REFUSES', async (t) => {
  // The approved index holds content unrelated to the question — the shape of the
  // historical failure, where lexical noise stood in for real evidence.
  const { svc } = await approvedIndex([{ relPath: 'docs/unrelated.md', content: 'billing invoices and dunning schedules\n' }]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  const res = await ask(h, { requireApproved: true, task: 'how does schema v6 approved_version isolation work' });
  const evs = frames(res.body);

  const refusal = evs.find((e) => e.event === 'refusal');
  assert.ok(refusal, 'must emit an explicit refusal');
  assert.equal(refusal!.data.code, 'INSUFFICIENT_APPROVED_EVIDENCE');
  assert.equal(refusal!.data.sourceMode, 'approved-index');
  assert.match(String(refusal!.data.message), /approved semantic index/i);
  assert.ok(!evs.some((e) => e.event === 'tool'), 'no tool may run for a refused turn');
});

test('approved-only request never receives working-tree tools', async (t) => {
  const { svc } = await approvedIndex([{ relPath: 'src/exclusions.ts', content: 'exclusion engine gitignore negation last match wins\n' }]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  const res = await ask(h, { requireApproved: true, task: 'exclusion engine gitignore negation last match wins' });
  const evs = frames(res.body);

  // The loop is announced with its catalog; approved-only keeps only plan.update.
  const toolFrames = evs.filter((e) => e.event === 'tool');
  assert.equal(toolFrames.length, 0, 'a grounded approved-only answer needs no file tools');
  assert.ok(!res.body.includes('"id":"fs.'), 'no filesystem capability offered');
});

// ── 3: cannot cite unrelated chunks ─────────────────────────────────────────

test('approved-only answers are seeded ONLY with chunks above the relevance floor', async (t) => {
  const { svc } = await approvedIndex([
    { relPath: 'src/exclusions.ts', content: 'exclusion engine gitignore negation last match wins ancestor rule\n' },
    { relPath: 'package.json', content: '{ "version": "0.1.0", "name": "thing" }\n' },
  ]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  const res = await ask(h, { requireApproved: true, task: 'exclusion engine gitignore negation ancestor rule' });
  const decided = decisionFor(res.correlationId);

  assert.ok(decided, 'a grounding decision is always audited');
  if (decided!.fields.gateDecision === 'approved-evidence') {
    const refs = decided!.fields.chunkRefs as string[];
    assert.ok(refs.length > 0);
    assert.ok(!refs.some((r) => r.startsWith('package.json')), 'irrelevant chunks must not become evidence');
  } else {
    assert.equal(decided!.fields.gateDecision, 'refused', 'either grounded on the real file or refused — never package.json');
  }
  assert.equal(res.statusCode, 200);
});

// ── 4: branch divergence disclosed ──────────────────────────────────────────

test('branch divergence is disclosed in the audit decision', async (t) => {
  const { svc } = await approvedIndex([{ relPath: 'src/exclusions.ts', content: 'exclusion engine gitignore negation last match wins ancestor rule\n' }]);
  const h = appWith(svc, 'phase-1/canonical-vscode-extension');
  t.after(() => h.app.close());

  const res = await ask(h, { requireApproved: true, task: 'exclusion engine gitignore negation ancestor rule', currentBranch: 'fix/some-feature' });
  const decided = decisionFor(res.correlationId);

  assert.ok(decided);
  assert.equal(decided!.fields.indexedBranch, 'phase-1/canonical-vscode-extension');
  assert.equal(decided!.fields.currentBranch, 'fix/some-feature');
  assert.equal(decided!.fields.branchDiverged, true);
});

// ── 5: working-tree mode is explicit ────────────────────────────────────────

test('an ordinary request records working-tree mode explicitly', async (t) => {
  const h = appWith(undefined); // no index at all
  t.after(() => h.app.close());

  const res = await ask(h, { task: 'do something ordinary' });
  const decided = decisionFor(res.correlationId);

  // With no index service there is no decision to audit; with one, the mode is
  // named. Either way the run must NOT claim approved grounding.
  if (decided) {
    assert.equal(decided.fields.sourceMode, 'working-tree');
    assert.equal(decided.fields.gateDecision, 'working-tree-fallback');
  }
});

test('an ordinary request with an approved index but no match discloses working-tree', async (t) => {
  const { svc } = await approvedIndex([{ relPath: 'docs/unrelated.md', content: 'billing invoices and dunning\n' }]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  const res = await ask(h, { requireApproved: false, task: 'how does kubernetes autoscaling work here' });
  const decided = decisionFor(res.correlationId);

  assert.ok(decided);
  assert.equal(decided!.fields.sourceMode, 'working-tree');
  assert.equal(decided!.fields.requestedMode, 'auto');
  assert.equal(decided!.fields.gateDecision, 'working-tree-fallback');
});

// ── 6 + 7: audit metadata present, content absent ───────────────────────────

test('retrieval metadata is emitted and carries no prompt or source text', async (t) => {
  const secretish = 'API_KEY=super-secret-do-not-audit';
  const { svc } = await approvedIndex([{ relPath: 'src/exclusions.ts', content: `exclusion engine negation ${secretish}\n` }]);
  const h = appWith(svc, 'main');
  t.after(() => h.app.close());

  const res = await ask(h, { requireApproved: true, task: 'exclusion engine negation ancestor rule' });
  const decided = decisionFor(res.correlationId);

  assert.ok(decided, 'the decision must reach the audit stream');
  const serialized = JSON.stringify(decided);
  assert.ok(!serialized.includes(secretish), 'chunk/source text must never be audited');
  assert.ok(!serialized.includes('exclusion engine negation ancestor rule'), 'the prompt must never be audited');
  assert.ok(!serialized.includes('/tmp/'), 'no absolute paths');
  for (const key of ['sourceMode', 'requestedMode', 'allowed', 'minScore', 'gateDecision']) {
    assert.ok(key in (decided!.fields as Record<string, unknown>), `must record ${key}`);
  }
});

// ── 8: one shared decision path ─────────────────────────────────────────────

test('chat and engineer share ONE grounding decision implementation', () => {
  const chat = readSource('src/engine/aiRoutes.ts');
  const engineer = readSource('src/engine/engineerRoutes.ts');

  for (const [name, src] of [['aiRoutes', chat], ['engineerRoutes', engineer]] as const) {
    assert.match(src, /decideGrounding\(/, `${name} must use the shared boundary`);
    assert.match(src, /groundingAuditFields\(/, `${name} must audit its decision`);
    assert.match(src, /from '\.\/grounding\/groundingDecision\.js'/, `${name} must import the one module`);
  }
  // No second copy of the policy: refusal reasons live in the module only.
  assert.ok(!/'insufficient-relevance'/.test(chat), 'chat must not re-implement the gate');
  assert.ok(!/'insufficient-relevance'/.test(engineer), 'engineer must not re-implement the gate');
});

test('the chat path can no longer silently substitute working-tree chunks', () => {
  const chat = readSource('src/engine/aiRoutes.ts');
  // The fallback still exists for ordinary turns, but must be guarded by the flag.
  const idx = chat.indexOf('if (!retrievedChunks?.length && body.workspaceRoot)');
  assert.ok(idx > 0, 'the lexical fallback is still present for ordinary turns');
  const before = chat.slice(Math.max(0, idx - 900), idx);
  // Gated on the MODE now: `approved` refuses earlier, `none` gathers nothing.
  assert.match(before, /requestedMode === 'approved' \|\| requestedMode === 'none'/, 'approved/none must return before the fallback');
});

/** Read a source file so the two paths can be proven to share ONE gate. Reading the
 * source is deliberate: this asserts an architectural invariant that no runtime
 * assertion can — that the policy is not re-implemented in a second place. */
function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), 'utf8');
}

// ── THE HISTORICAL CASE, end to end ──────────────────────────────────────────

test('HISTORICAL: the exact corr_ms1iwdhw4lbyim request is now refused with disclosure', async (t) => {
  // Reproduce the real shape: the approved index is the CANONICAL branch's
  // generation; the checkout is the feature branch that introduced schema v6. The
  // approved generation therefore cannot support the question.
  const { svc } = await approvedIndex([
    { relPath: 'apps/brain-service/src/engine/rag/exclusions.ts', content: 'gitignore negation last match wins ancestor directory rule traversal\n' },
    { relPath: 'apps/vscode-extension/src/panel/shell/shellProvider.ts', content: 'command center shell provider webview tabs composer\n' },
    // The lexical decoys that were cited in the failure. They exist, but they do
    // not support a question about approved-version isolation.
    { relPath: 'services/pilot-api/PROVENANCE.md', content: 'provenance and version history of the pilot api package\n' },
    { relPath: 'services/pilot-api/package.json', content: '{ "name": "pilot-api", "version": "0.1.0" }\n' },
    { relPath: 'packages/tooling/package.json', content: '{ "name": "tooling", "version": "0.1.0" }\n' },
  ]);
  const h = appWith(svc, 'phase-1/canonical-vscode-extension');
  t.after(() => h.app.close());

  const res = await ask(h, {
    requireApproved: true,
    currentBranch: 'fix/brain-approved-retrieval-grounding',
    task: 'Using only the approved semantic index, identify the files and symbols that implement schema-v6 approved-version isolation.',
  });
  const evs = frames(res.body);
  const decided = decisionFor(res.correlationId);

  // 1. approved-only mode was active
  assert.equal(decided!.fields.requestedMode, 'approved', 'approved-only mode must be recorded as ACTIVE');
  assert.equal(decided!.fields.sourceMode, 'approved-index');

  // 2. branch divergence disclosed
  assert.equal(decided!.fields.indexedBranch, 'phase-1/canonical-vscode-extension');
  assert.equal(decided!.fields.currentBranch, 'fix/brain-approved-retrieval-grounding');

  // 3. the loop never started
  assert.ok(!evs.some((e) => e.event === 'loop' || e.event === 'step'), 'the engineer loop must not run');

  // 4. no working-tree tool executed
  assert.equal(evs.filter((e) => e.event === 'tool').length, 0, 'zero tool invocations');

  // 5. no unrelated citation was emitted
  const body = res.body;
  for (const decoy of ['PROVENANCE.md', 'pilot-api/package.json', 'packages/tooling/package.json']) {
    assert.ok(!body.includes(decoy), `must not cite the decoy ${decoy}`);
  }

  // 6. the refusal is explicit and names both branches
  const refusal = evs.find((e) => e.event === 'refusal');
  assert.ok(refusal, 'must refuse');
  assert.equal(refusal!.data.code, 'INSUFFICIENT_APPROVED_EVIDENCE');
  const message = String(refusal!.data.message);
  assert.match(message, /approved semantic index/i);
  assert.match(message, /phase-1\/canonical-vscode-extension/);
  assert.match(message, /fix\/brain-approved-retrieval-grounding/);

  // 7. retrieval.decided persisted, metadata only
  assert.equal(decided!.fields.gateDecision, 'refused');
  assert.equal(decided!.fields.refusalReason, 'insufficient-relevance');
  const serialized = JSON.stringify(decided);
  assert.ok(!serialized.includes('Using only the approved semantic index'), 'the prompt must not be audited');
  assert.ok(!serialized.includes('provenance and version history'), 'chunk text must not be audited');
});

// ── the DURABLE record, not just the in-memory one ───────────────────────────

test('the retrieval decision survives to SQLite as metadata only', async (t) => {
  // The assertions above read the IN-MEMORY audit store. The operational bridge and
  // the value redactor sit between that and the durable row, so leakage has to be
  // proven where the data actually rests: in op_audit_events.
  const dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'migraai-grounding-')), 'state.db');
  const durable = new SqliteDurableStore(dbPath);
  t.after(() => durable.close());

  // The REAL bridge, with the real store set — the redactor and the writer path are
  // what this test exists to exercise, so none of it is stubbed.
  const clock = () => 1_700_000_000_000;
  const store = new AuditStore(clock);
  await wireOperationalPersistence(
    durable,
    {
      auditStore: store,
      usageLedger: new UsageLedger(clock, () => 'u1'),
      incidentManager: new IncidentManager(new LocalAlertSink().sink, clock, () => 'i1'),
      budgetManager: new BudgetManager(false, [], clock, () => 'b1'),
    },
    { now: clock, recentLimit: 100 },
  );

  // A decision shaped exactly like the historical refusal, including a secret-like
  // string and an absolute path, to prove neither reaches the durable row.
  const prompt = 'Using only the approved semantic index, identify the files and symbols…';
  const decision = await decideGrounding(
    { mode: 'approved' as const, query: prompt, currentBranch: 'fix/brain-approved-retrieval-grounding' },
    {
      approvedIndexId: () => 'idx_live',
      retrieveApproved: async () => [
        { path: 'services/pilot-api/PROVENANCE.md', startLine: 1, endLine: 4, snippet: 'API_KEY=super-secret in /home/bonex/secret.txt', score: 0.466 },
      ],
      indexIdentity: () => ({ version: 5, indexedBranch: 'phase-1/canonical-vscode-extension' }),
      minScore: DEFAULT_MIN_APPROVED_SCORE,
    },
  );
  assert.equal(decision.allowed, false, 'the 0.466 chunk is below the 0.53 floor');

  store.append({
    correlationId: 'corr_durable_proof',
    type: 'retrieval.decided',
    component: 'engineer',
    fields: groundingAuditFields(decision, DEFAULT_MIN_APPROVED_SCORE),
  });

  // Read the PERSISTED row back out of SQLite.
  const rows = (await durable.recentAuditEvents(50)).filter((e) => e.type === 'retrieval.decided');
  assert.equal(rows.length, 1, 'the decision must be durably persisted');
  const row = rows[0]!;
  const raw = JSON.stringify(row); // the exact bytes that rest in SQLite
  const fields = JSON.parse(row.fieldsJson) as Record<string, unknown>;

  // Metadata IS present.
  assert.equal(fields.sourceMode, 'approved-index');
  assert.equal(fields.requestedMode, 'approved');
  assert.equal(fields.gateDecision, 'refused');
  assert.equal(fields.refusalReason, 'insufficient-relevance');
  assert.equal(fields.indexVersion, 5);
  assert.equal(fields.indexedBranch, 'phase-1/canonical-vscode-extension');
  assert.equal(fields.currentBranch, 'fix/brain-approved-retrieval-grounding');
  assert.equal(fields.minScore, DEFAULT_MIN_APPROVED_SCORE);
  assert.equal(fields.bestScore, 0.466, 'the near-miss score is recorded against the floor');

  // Content is NOT.
  assert.ok(!raw.includes(prompt), 'the prompt must never be persisted');
  assert.ok(!raw.includes('API_KEY'), 'chunk text must never be persisted');
  assert.ok(!raw.includes('super-secret'), 'nor anything inside it');
  assert.ok(!raw.includes('/home/bonex'), 'nor an absolute path');
  assert.ok(!raw.includes('snippet'), 'no snippet field at all');
});

// ── the new modes, enforced through the REAL route ───────────────────────────

test('workspace mode does not consult the approved index and says so', async (t) => {
  const { svc } = await approvedIndex([
    { relPath: 'src/exclusions.ts', content: 'exclusion engine gitignore negation ancestor rule\n' },
  ]);
  const h = appWith(svc, 'phase-1/canonical-vscode-extension');
  t.after(() => h.app.close());

  const res = await ask(h, {
    groundingMode: 'workspace',
    currentBranch: 'fix/some-branch',
    task: 'exclusion engine gitignore negation ancestor rule',
  });
  const decided = decisionFor(res.correlationId);

  assert.ok(decided, 'the decision is audited');
  assert.equal(decided!.fields.requestedMode, 'workspace');
  assert.equal(decided!.fields.sourceMode, 'working-tree');
  assert.equal(decided!.fields.gateDecision, 'working-tree-forced', 'forced, never reported as a fallback');
  assert.equal(decided!.fields.forced, true);
  assert.equal(decided!.fields.chunkRefs, undefined, 'no approved chunks were taken');
  // Divergence is still disclosed even though the index was not used for evidence.
  assert.equal(decided!.fields.indexedBranch, 'phase-1/canonical-vscode-extension');
  assert.equal(decided!.fields.branchDiverged, true);
});

test('none mode gathers no evidence, keeps no tools, and is audited as such', async (t) => {
  const { svc } = await approvedIndex([
    { relPath: 'src/exclusions.ts', content: 'exclusion engine gitignore negation ancestor rule\n' },
  ]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  const res = await ask(h, { groundingMode: 'none', task: 'exclusion engine gitignore negation ancestor rule' });
  const evs = frames(res.body);
  const decided = decisionFor(res.correlationId);

  assert.equal(decided!.fields.requestedMode, 'none');
  assert.equal(decided!.fields.sourceMode, 'none');
  assert.equal(decided!.fields.gateDecision, 'no-repository-evidence');
  assert.equal(decided!.fields.chunkRefs, undefined, 'nothing retrieved');
  assert.equal(decided!.fields.indexId, undefined, 'no index claimed');
  // Tools are withheld exactly as in approved-only mode.
  assert.equal(evs.filter((e) => e.event === 'tool').length, 0, 'no tool may run');
  assert.ok(!res.body.includes('"id":"fs.'), 'no filesystem capability offered');
  // The grounding frame tells the host which mode to render.
  const g = evs.find((e) => e.event === 'grounding');
  assert.equal(g!.data.sourceMode, 'none');
  assert.equal(g!.data.requestedMode, 'none');
});

test('the grounding frame always carries requested AND effective mode', async (t) => {
  const { svc } = await approvedIndex([{ relPath: 'docs/x.md', content: 'billing invoices dunning\n' }]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  // `auto` against an index that cannot answer ⇒ a FALLBACK, which must be visible
  // as a fallback rather than as a working-tree choice.
  const res = await ask(h, { groundingMode: 'auto', task: 'how does kubernetes autoscaling work' });
  const g = frames(res.body).find((e) => e.event === 'grounding');

  assert.equal(g!.data.requestedMode, 'auto');
  assert.equal(g!.data.sourceMode, 'working-tree');
  assert.equal(g!.data.forced, false, 'a fallback is not a forced choice');
  assert.equal(decisionFor(res.correlationId)!.fields.gateDecision, 'working-tree-fallback');
});

test('the legacy requireApproved boolean still maps to approved mode', async (t) => {
  const { svc } = await approvedIndex([{ relPath: 'docs/x.md', content: 'billing invoices dunning\n' }]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  const res = await ask(h, { requireApproved: true, task: 'how does schema v6 isolation work' });
  const decided = decisionFor(res.correlationId);

  assert.equal(decided!.fields.requestedMode, 'approved', 'the legacy flag maps to the mode');
  assert.equal(decided!.fields.gateDecision, 'refused', 'and still fails closed');
});

test('an explicit mode beats the legacy boolean when both are sent', async (t) => {
  const { svc } = await approvedIndex([{ relPath: 'src/a.ts', content: 'exclusion engine negation ancestor\n' }]);
  const h = appWith(svc);
  t.after(() => h.app.close());

  // Contradictory input: the explicit mode must win, and be the one recorded.
  const res = await ask(h, { requireApproved: true, groundingMode: 'workspace', task: 'exclusion engine negation ancestor' });
  const decided = decisionFor(res.correlationId);

  assert.equal(decided!.fields.requestedMode, 'workspace');
  assert.equal(decided!.fields.sourceMode, 'working-tree');
});
