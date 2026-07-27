import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decideGrounding,
  groundingAuditFields,
  mayUseApprovedIndex,
  modeFromLegacy,
  refusalMessage,
  withholdsWorkspaceTools,
  type GroundingChunk,
  type GroundingDecision,
  type GroundingDeps,
} from '../src/engine/grounding/groundingDecision.js';

/**
 * The grounding boundary must never answer an approved-only request with
 * unapproved evidence.
 *
 * Historical failure (run corr_ms1iwdhw4lbyim): an approved-index-only question
 * about code that existed solely on an unmerged branch was answered from a LEXICAL
 * retriever over the live checkout. Three `package.json` files and a
 * `PROVENANCE.md` scored highly on the word "version", cleared the seeder's 0.8
 * bar, and were injected as evidence with a "cite these" instruction. Nothing
 * disclosed that the approved index had been bypassed.
 *
 * These tests pin the policy: fail closed on approved-only, disclose otherwise,
 * and emit metadata that can never contain source text.
 */

const chunk = (path: string, score: number): GroundingChunk => ({
  path,
  startLine: 1,
  endLine: 9,
  snippet: `contents of ${path}`,
  score,
});

function deps(over: Partial<GroundingDeps> & { chunks?: GroundingChunk[] } = {}): GroundingDeps {
  const chunks = over.chunks ?? [chunk('src/a.ts', 0.9)];
  return {
    approvedIndexId: over.approvedIndexId ?? (() => 'idx_1'),
    retrieveApproved: over.retrieveApproved ?? (async () => chunks),
    indexIdentity: over.indexIdentity ?? (() => ({ version: 5, indexedBranch: 'main' })),
    minScore: over.minScore ?? 0.5,
    ...(over.refuseOnBranchDivergence !== undefined ? { refuseOnBranchDivergence: over.refuseOnBranchDivergence } : {}),
  };
}

// ── approved-only: fail closed ───────────────────────────────────────────────

test('approved-only with relevant evidence answers from the approved index', async () => {
  const d = await decideGrounding({ mode: 'approved' as const, query: 'q', currentBranch: 'main' }, deps());

  assert.equal(d.mode, 'approved-index');
  assert.equal(d.allowed, true);
  assert.equal((d as Extract<GroundingDecision, { allowed: true; mode: 'approved-index' }>).indexVersion, 5);
  assert.equal((d as Extract<GroundingDecision, { allowed: true; mode: 'approved-index' }>).chunks.length, 1);
});

test('approved-only with NO approved index refuses — never the working tree', async () => {
  const d = await decideGrounding(
    { mode: 'approved' as const, query: 'q' },
    deps({ approvedIndexId: () => undefined }),
  );

  assert.equal(d.mode, 'approved-index');
  assert.equal(d.allowed, false);
  assert.equal((d as Extract<GroundingDecision, { allowed: false }>).reason, 'no-approved-index');
});

test('approved-only with only weak chunks refuses on relevance', async () => {
  // THE HISTORICAL FAILURE: high-scoring-but-irrelevant files used to be injected.
  const noise = [chunk('services/pilot-api/PROVENANCE.md', 0.31), chunk('services/pilot-api/package.json', 0.28)];
  const d = await decideGrounding({ mode: 'approved' as const, query: 'q' }, deps({ chunks: noise, minScore: 0.5 }));

  assert.equal(d.allowed, false);
  const refused = d as Extract<GroundingDecision, { allowed: false }>;
  assert.equal(refused.reason, 'insufficient-relevance');
  assert.equal(refused.bestScore, 0.31, 'reports how close it got');
});

test('approved-only never returns a chunk below the threshold', async () => {
  const mixed = [chunk('src/real.ts', 0.82), chunk('package.json', 0.2)];
  const d = await decideGrounding({ mode: 'approved' as const, query: 'q' }, deps({ chunks: mixed, minScore: 0.5 }));

  const ok = d as Extract<GroundingDecision, { allowed: true; mode: 'approved-index' }>;
  assert.deepEqual(ok.chunks.map((c) => c.path), ['src/real.ts'], 'weak chunks are dropped, not merely ranked lower');
});

test('a retrieval failure refuses rather than falling back to the checkout', async () => {
  const d = await decideGrounding(
    { mode: 'approved' as const, query: 'q' },
    deps({ retrieveApproved: async () => { throw new Error('index exploded'); } }),
  );

  assert.equal(d.allowed, false);
  assert.equal((d as Extract<GroundingDecision, { allowed: false }>).reason, 'retrieval-failed');
});

// ── branch divergence ───────────────────────────────────────────────────────

test('branch divergence is disclosed, not silently ignored', async () => {
  const d = await decideGrounding(
    { mode: 'approved' as const, query: 'q', currentBranch: 'fix/my-branch' },
    deps({ indexIdentity: () => ({ version: 5, indexedBranch: 'phase-1/canonical-vscode-extension' }) }),
  );

  const ok = d as Extract<GroundingDecision, { allowed: true; mode: 'approved-index' }>;
  assert.equal(ok.branchDiverged, true, 'the caller must be able to say so');
  assert.equal(ok.indexedBranch, 'phase-1/canonical-vscode-extension');
  assert.equal(ok.currentBranch, 'fix/my-branch');
});

test('identical branches are not reported as diverged', async () => {
  const d = await decideGrounding({ mode: 'approved' as const, query: 'q', currentBranch: 'main' }, deps());
  assert.equal((d as Extract<GroundingDecision, { allowed: true; mode: 'approved-index' }>).branchDiverged, false);
});

test('strict mode can refuse on divergence instead of disclosing', async () => {
  const d = await decideGrounding(
    { mode: 'approved' as const, query: 'q', currentBranch: 'feature' },
    deps({ indexIdentity: () => ({ version: 5, indexedBranch: 'main' }), refuseOnBranchDivergence: true }),
  );

  assert.equal(d.allowed, false);
  assert.equal((d as Extract<GroundingDecision, { allowed: false }>).reason, 'branch-diverged');
});

// ── ordinary requests keep working, but LABELLED ─────────────────────────────

test('an ordinary request still prefers approved evidence when it is good enough', async () => {
  const d = await decideGrounding({ mode: 'auto' as const, query: 'q', currentBranch: 'main' }, deps());

  assert.equal(d.mode, 'approved-index');
  assert.equal(d.allowed, true);
});

test('an ordinary request falls back to working tree — and must disclose it', async () => {
  const d = await decideGrounding(
    { mode: 'auto' as const, query: 'q', currentBranch: 'main' },
    deps({ chunks: [] }),
  );

  assert.equal(d.mode, 'working-tree');
  assert.equal(d.allowed, true);
  assert.equal((d as Extract<GroundingDecision, { mode: 'working-tree' }>).disclosureRequired, true);
});

test('an ordinary request with no approved index uses the working tree, disclosed', async () => {
  const d = await decideGrounding(
    { mode: 'auto' as const, query: 'q' },
    deps({ approvedIndexId: () => undefined }),
  );

  assert.equal(d.mode, 'working-tree');
  assert.equal((d as Extract<GroundingDecision, { mode: 'working-tree' }>).disclosureRequired, true);
});

// ── audit metadata: complete, and free of content ────────────────────────────

test('audit fields record the whole decision for an approved answer', async () => {
  const d = await decideGrounding(
    { mode: 'approved' as const, query: 'q', currentBranch: 'feature' },
    deps({ chunks: [chunk('src/a.ts', 0.9123), chunk('src/b.ts', 0.7)] }),
  );
  const f = groundingAuditFields(d, 0.5);

  assert.equal(f.sourceMode, 'approved-index');
  assert.equal(f.requestedMode, 'approved');
  assert.equal(f.allowed, true);
  assert.equal(f.gateDecision, 'approved-evidence');
  assert.equal(f.indexVersion, 5);
  assert.equal(f.indexedBranch, 'main');
  assert.equal(f.currentBranch, 'feature');
  assert.equal(f.branchDiverged, true);
  assert.equal(f.chunkCount, 2);
  assert.deepEqual(f.chunkRefs, ['src/a.ts:1-9', 'src/b.ts:1-9']);
  assert.deepEqual(f.scores, [0.912, 0.7], 'scores rounded, not raw floats');
  assert.equal(f.minScore, 0.5);
});

test('audit fields never carry chunk text, prompts or absolute paths', async () => {
  const d = await decideGrounding(
    { mode: 'approved' as const, query: 'a very secret question about API_KEY=xyz' },
    deps({ chunks: [chunk('src/a.ts', 0.9)] }),
  );
  const serialized = JSON.stringify(groundingAuditFields(d, 0.5));

  assert.ok(!serialized.includes('contents of'), 'chunk snippets must never be audited');
  assert.ok(!serialized.includes('API_KEY'), 'the query must never be audited');
  assert.ok(!serialized.includes('/home/'), 'no absolute paths');
});

test('audit fields record a refusal with its reason', async () => {
  const d = await decideGrounding({ mode: 'approved' as const, query: 'q' }, deps({ chunks: [] }));
  const f = groundingAuditFields(d, 0.5);

  assert.equal(f.gateDecision, 'refused');
  assert.equal(f.refusalReason, 'insufficient-relevance');
  assert.equal(f.allowed, false);
});

test('audit fields mark working-tree mode as disclosed', async () => {
  const d = await decideGrounding({ mode: 'auto' as const, query: 'q' }, deps({ chunks: [] }));
  const f = groundingAuditFields(d, 0.5);

  assert.equal(f.sourceMode, 'working-tree');
  assert.equal(f.gateDecision, 'working-tree-fallback');
});

// ── refusal text ────────────────────────────────────────────────────────────

test('a relevance refusal names the indexed branch and the next action', async () => {
  const d = await decideGrounding(
    { mode: 'approved' as const, query: 'q', currentBranch: 'fix/brain-approved-retrieval-grounding' },
    deps({ chunks: [], indexIdentity: () => ({ version: 5, indexedBranch: 'phase-1/canonical-vscode-extension' }) }),
  );
  const msg = refusalMessage(d as Extract<GroundingDecision, { allowed: false }>);

  assert.match(msg, /could not find relevant evidence in the approved semantic index/);
  assert.match(msg, /phase-1\/canonical-vscode-extension/, 'says what WAS searched');
  assert.match(msg, /fix\/brain-approved-retrieval-grounding/, 'and what the checkout is');
  assert.match(msg, /sync and approve/i, 'and the next action');
});

test('every refusal reason produces a message', async () => {
  const reasons: Array<Extract<GroundingDecision, { allowed: false }>> = [
    { requested: 'approved', mode: 'approved-index', allowed: false, reason: 'no-approved-index' },
    { requested: 'approved', mode: 'approved-index', allowed: false, reason: 'insufficient-relevance' },
    { requested: 'approved', mode: 'approved-index', allowed: false, reason: 'branch-diverged', indexedBranch: 'main' },
    { requested: 'approved', mode: 'approved-index', allowed: false, reason: 'retrieval-failed' },
  ];
  for (const r of reasons) {
    const msg = refusalMessage(r);
    assert.ok(msg.length > 20, `${r.reason} must have a real message`);
    assert.ok(!/undefined/.test(msg), `${r.reason} message must not leak undefined`);
  }
});

// ── the four modes, each ENFORCED ────────────────────────────────────────────

test('workspace mode NEVER consults the approved index, even when one would qualify', async () => {
  // A perfectly good approved index that clears the floor. `auto` would use it;
  // `workspace` must not — that difference is the mode's whole reason to exist.
  let approvedRetrievals = 0;
  const d = await decideGrounding(
    { mode: 'workspace', query: 'q', currentBranch: 'feature' },
    deps({
      retrieveApproved: async () => {
        approvedRetrievals += 1;
        return [chunk('src/a.ts', 0.99)];
      },
    }),
  );

  assert.equal(approvedRetrievals, 0, 'the approved index must not even be queried');
  assert.equal(d.mode, 'working-tree');
  const wt = d as Extract<GroundingDecision, { mode: 'working-tree' }>;
  assert.equal(wt.forced, true, 'recorded as FORCED, not as a fallback');
  assert.equal(wt.disclosureRequired, true);
  assert.equal(wt.requested, 'workspace');
});

test('workspace mode still reports the indexed branch for context', async () => {
  const d = await decideGrounding(
    { mode: 'workspace', query: 'q', currentBranch: 'feature' },
    deps({ indexIdentity: () => ({ version: 5, indexedBranch: 'main' }) }),
  );
  const wt = d as Extract<GroundingDecision, { mode: 'working-tree' }>;
  assert.equal(wt.indexedBranch, 'main', 'divergence is still disclosed');
  assert.equal(wt.branchDiverged, true);
});

test('none mode gathers NOTHING and queries nothing', async () => {
  let approvedRetrievals = 0;
  let indexLookups = 0;
  const d = await decideGrounding(
    { mode: 'none', query: 'q', currentBranch: 'main' },
    deps({
      approvedIndexId: () => { indexLookups += 1; return 'idx_1'; },
      retrieveApproved: async () => { approvedRetrievals += 1; return [chunk('src/a.ts', 0.99)]; },
    }),
  );

  assert.equal(d.mode, 'none');
  assert.equal(d.allowed, true, 'the turn proceeds — it just has no repository evidence');
  assert.equal((d as Extract<GroundingDecision, { mode: 'none' }>).disclosureRequired, true);
  assert.equal(approvedRetrievals, 0, 'no approved retrieval');
  assert.equal(indexLookups, 0, 'not even an index lookup — decided before any I/O');
});

test('each mode produces its OWN outcome — none collapses into another', async () => {
  const outcomes = await Promise.all(
    (['auto', 'approved', 'workspace', 'none'] as const).map(async (mode) => {
      const d = await decideGrounding({ mode, query: 'q', currentBranch: 'main' }, deps());
      return { mode, effective: d.mode, allowed: d.allowed };
    }),
  );

  assert.deepEqual(outcomes, [
    { mode: 'auto', effective: 'approved-index', allowed: true },
    { mode: 'approved', effective: 'approved-index', allowed: true },
    { mode: 'workspace', effective: 'working-tree', allowed: true },
    { mode: 'none', effective: 'none', allowed: true },
  ]);
  // Every decision reports what was ASKED for, so a degradation is never invisible.
  for (const mode of ['auto', 'approved', 'workspace', 'none'] as const) {
    const d = await decideGrounding({ mode, query: 'q' }, deps());
    assert.equal(d.requested, mode, `${mode} must record itself as requested`);
  }
});

test('a fallback is distinguishable from a forced working-tree choice', async () => {
  const fellBack = await decideGrounding({ mode: 'auto', query: 'q' }, deps({ chunks: [] }));
  const forced = await decideGrounding({ mode: 'workspace', query: 'q' }, deps());

  assert.equal((fellBack as Extract<GroundingDecision, { mode: 'working-tree' }>).forced, false);
  assert.equal((forced as Extract<GroundingDecision, { mode: 'working-tree' }>).forced, true);
  // Same effective mode, different provenance — the audit must not conflate them.
  assert.equal(groundingAuditFields(fellBack, 0.5).gateDecision, 'working-tree-fallback');
  assert.equal(groundingAuditFields(forced, 0.5).gateDecision, 'working-tree-forced');
});

test('tool withholding is derived from the mode, not decided ad hoc', () => {
  assert.equal(withholdsWorkspaceTools('approved'), true, 'approved: only reviewed evidence');
  assert.equal(withholdsWorkspaceTools('none'), true, 'none: no repository access at all');
  assert.equal(withholdsWorkspaceTools('workspace'), false, 'workspace: the checkout IS the source');
  assert.equal(withholdsWorkspaceTools('auto'), false);
});

test('only auto and approved may touch the approved index', () => {
  assert.equal(mayUseApprovedIndex('auto'), true);
  assert.equal(mayUseApprovedIndex('approved'), true);
  assert.equal(mayUseApprovedIndex('workspace'), false);
  assert.equal(mayUseApprovedIndex('none'), false);
});

test('the legacy boolean maps to a mode and nothing else', () => {
  assert.equal(modeFromLegacy(true), 'approved');
  assert.equal(modeFromLegacy(false), 'auto');
  assert.equal(modeFromLegacy(undefined), 'auto', 'absent means today’s behaviour');
});

test('audit records BOTH requested and effective for every mode', async () => {
  for (const mode of ['auto', 'approved', 'workspace', 'none'] as const) {
    const d = await decideGrounding({ mode, query: 'q', currentBranch: 'main' }, deps());
    const f = groundingAuditFields(d, 0.53);
    assert.equal(f.requestedMode, mode, `${mode}: requested recorded`);
    assert.ok(typeof f.sourceMode === 'string', `${mode}: effective recorded`);
    assert.ok(typeof f.gateDecision === 'string', `${mode}: enforcement decision recorded`);
    const serialized = JSON.stringify(f);
    assert.ok(!serialized.includes('contents of'), `${mode}: no chunk text`);
  }
});

test('none mode audits as no-repository-evidence, with no index fields', async () => {
  const d = await decideGrounding({ mode: 'none', query: 'q' }, deps());
  const f = groundingAuditFields(d, 0.53);

  assert.equal(f.gateDecision, 'no-repository-evidence');
  assert.equal(f.sourceMode, 'none');
  assert.equal(f.indexId, undefined, 'no index was used, so none is claimed');
  assert.equal(f.chunkRefs, undefined);
});
