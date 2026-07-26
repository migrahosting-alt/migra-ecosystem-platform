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
import { auditStore } from '../src/engine/auditLog.js';

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
  const rec = svc.createIndex(A, { sourceType: 'workspace', root: '/repo' });
  await svc.sync(rec.id, A);
  svc.setState(rec.id, A, 'approved');
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
    assert.equal(decided.fields.gateDecision, 'working-tree-disclosed');
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
  assert.equal(decided!.fields.requireApproved, false);
  assert.equal(decided!.fields.gateDecision, 'working-tree-disclosed');
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
  for (const key of ['sourceMode', 'requireApproved', 'allowed', 'minScore', 'gateDecision']) {
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
  const before = chat.slice(Math.max(0, idx - 700), idx);
  assert.match(before, /if \(body\.requireApproved\) return finishChatRequest/, 'an approved-only turn must return before the fallback');
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
  assert.equal(decided!.fields.requireApproved, true, 'approved-only mode must be recorded as ACTIVE');
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
