import assert from 'node:assert/strict';
import test from 'node:test';

import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';
import {
  executeDocumentSearch,
  normalizeDocumentSearch,
  preflightDocumentSearch,
  type DocumentSearchInput,
} from '../src/engine/tools/documentSearchTool.js';
import {
  routeToolInvocation,
  type CapabilityState,
  type RouterResolvers,
} from '../src/engine/tools/toolRouter.js';
import { toolManifest } from '../src/engine/tools/toolManifest.js';

/**
 * THE FIRST TOOL, END TO END — the acceptance matrix for the framework itself.
 *
 * Document search is read-only, so it proves the whole path without mutation
 * semantics contaminating the result. It runs through the retrieval path the
 * product already depends on (`IndexService.retrieve` with `requireApproved`,
 * resolved by `approvedIndexFor`), which makes this an integration test of the
 * stale-index fix as well.
 *
 * The distinction the matrix exists to protect: "no documents matched" is a
 * SUCCESS. Collapsing it into failure teaches users to distrust a working
 * feature; collapsing failure into it hides an outage.
 */

const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };
const TOOL = 'documents.search';

const DOC = [{ relPath: 'docs/notes.md', content: '# Notes\n\nThe quarterly revenue for the North region was 474,000.\n' }];

/** A service with ONE approved index holding the document. */
async function oneApprovedIndex(files = DOC): Promise<IndexService> {
  const svc = new IndexService(
    new FakeEmbedder(64),
    () => ({ files: async () => files }) as FileSource,
    undefined,
    undefined,
    undefined,
  );
  const rec = await svc.createIndex(scope, { sourceType: 'docs', root: '/root' });
  await svc.sync(rec.id, scope);
  await svc.setState(rec.id, scope, 'approved');
  return svc;
}

function resolvers(over: Partial<RouterResolvers<DocumentSearchInput>> & { capability?: CapabilityState } = {}) {
  const calls: string[] = [];
  const defaults: RouterResolvers<DocumentSearchInput> = {
    capabilityState: () => over.capability ?? 'available',
    connectionState: () => ({ state: 'not_required' }),
    authorization: () => ({ authorized: true, basis: 'workspace-role' }),
    normalize: normalizeDocumentSearch,
    preflight: preflightDocumentSearch,
    consent: () => {
      throw new Error('consent must never be sought for a read-only tool');
    },
  };
  const merged = { ...defaults, ...over } as RouterResolvers<DocumentSearchInput>;
  const rec = <A extends unknown[], R>(n: string, f: (...a: A) => R) => (...a: A): R => { calls.push(n); return f(...a); };
  return {
    calls,
    r: {
      capabilityState: rec('capability', merged.capabilityState),
      connectionState: rec('connection', merged.connectionState),
      authorization: rec('authorization', merged.authorization),
      normalize: rec('normalize', merged.normalize),
      preflight: rec('preflight', merged.preflight),
      consent: rec('consent', merged.consent),
    } as RouterResolvers<DocumentSearchInput>,
  };
}

const run = async (
  svc: Pick<IndexService, 'approvedIndexFor' | 'retrieve'>,
  query: string,
  over?: Parameters<typeof resolvers>[0],
) => {
  const { calls, r } = resolvers(over);
  const routed = await routeToolInvocation({ toolId: TOOL, input: { query } }, r);
  const result = await executeDocumentSearch(routed, { indexService: svc, scope, mkInvocationId: () => 'inv-1' });
  return { calls, routed, result };
};

// ── the matrix ─────────────────────────────────────────────────────────────

test('capability unknown → refused_policy', async () => {
  const svc = await oneApprovedIndex();
  const { result } = await run(svc, 'revenue', { capability: 'unknown' });
  assert.equal(result.outcome, 'refused_policy');
  assert.equal(result.hits.length, 0);
});

test('registered but grant missing → refused_policy', async () => {
  const svc = await oneApprovedIndex();
  const { result, routed } = await run(svc, 'revenue', { capability: 'ungranted' });
  assert.equal(routed.decision.blockedAt, 'registry:no-grant');
  assert.equal(result.outcome, 'refused_policy');
});

test('runtime unavailable → refused_policy, and says so honestly', async () => {
  const svc = await oneApprovedIndex();
  const { result, routed } = await run(svc, 'revenue', { capability: 'backend_unavailable' });
  assert.equal(routed.decision.blockedAt, 'registry:backend-unavailable');
  assert.equal(result.outcome, 'refused_policy');
  assert.match(result.message!, /temporarily unavailable/i);
});

test('unauthorized user → refused_policy', async () => {
  const svc = await oneApprovedIndex();
  const { result, routed } = await run(svc, 'revenue', {
    authorization: () => ({ authorized: false, basis: 'not-a-member' }),
  });
  assert.equal(routed.decision.blockedAt, 'authorization:denied');
  assert.equal(result.outcome, 'refused_policy');
});

test('preflight not run → preflight_failed', async () => {
  const svc = await oneApprovedIndex();
  const { result } = await run(svc, 'revenue', { preflight: () => ({ state: 'not_run' }) });
  assert.equal(result.outcome, 'preflight_failed');
});

test('preflight failed → preflight_failed, with the actionable reason', async () => {
  const svc = await oneApprovedIndex();
  const { result } = await run(svc, '   ');
  assert.equal(result.outcome, 'preflight_failed');
  assert.equal(result.message, 'Type something to search for.');
});

test('connection is reported as not_required, never as a Connect prompt', async () => {
  const svc = await oneApprovedIndex();
  const { routed } = await run(svc, 'revenue');
  assert.equal(routed.connectionState.state, 'not_required');
  assert.equal(routed.decision.action, undefined);
});

test('successful search returns typed hits', async () => {
  const svc = await oneApprovedIndex();
  const { result } = await run(svc, 'quarterly revenue North region');
  assert.equal(result.outcome, 'success_with_results');
  assert.ok(result.hits.length > 0);
  assert.equal(result.hits[0]!.file, 'docs/notes.md');
  assert.ok(typeof result.hits[0]!.excerpt === 'string' && result.hits[0]!.excerpt.length > 0);
  assert.equal(typeof result.hits[0]!.score, 'number');
  assert.equal(result.message, undefined, 'a success needs no error sentence');
});

test('🚨 no results is a SUCCESS, not a transport failure', async () => {
  // An empty library is an empty answer, not an outage.
  const empty = new IndexService(
    new FakeEmbedder(64),
    () => ({ files: async () => [] }) as FileSource,
    undefined, undefined, undefined,
  );
  const rec = await empty.createIndex(scope, { sourceType: 'docs', root: '/empty' });
  await empty.sync(rec.id, scope);
  await empty.setState(rec.id, scope, 'approved');

  const { result } = await run(empty, 'nothing here matches this');
  assert.equal(result.outcome, 'success_no_results');
  assert.equal(result.hits.length, 0);
  assert.notEqual(result.outcome, 'backend_failed');
});

test('no approved index at all is also success_no_results', async () => {
  const none = { approvedIndexFor: () => undefined, retrieve: async () => { throw new Error('must not be called'); } };
  const { result } = await run(none as never, 'revenue');
  assert.equal(result.outcome, 'success_no_results');
  assert.match(result.message!, /no approved documents/i);
});

test('🚨 two approved indexes: it searches the one holding the file', async () => {
  /*
   * The stale-index defect, exercised through the real tool path. Before the
   * resolver fix this bound to whichever index loaded first — the empty one —
   * and every search came back with nothing while the document sat indexed and
   * approved in the other.
   */
  let clock = 1_000_000;
  const byRoot = new Map<string, typeof DOC>([['/old', []], ['/new', DOC]]);
  const svc = new IndexService(
    new FakeEmbedder(64),
    (r) => ({ files: async () => byRoot.get(r.root) ?? [] }) as FileSource,
    () => (clock += 1000),
    undefined,
    undefined,
  );
  const oldRec = await svc.createIndex(scope, { sourceType: 'docs', root: '/old' });
  await svc.sync(oldRec.id, scope);
  await svc.setState(oldRec.id, scope, 'approved');
  const newRec = await svc.createIndex(scope, { sourceType: 'docs', root: '/new' });
  await svc.sync(newRec.id, scope);
  await svc.setState(newRec.id, scope, 'approved');

  assert.equal(svc.approvedIndexFor(scope), newRec.id, 'resolver picked the stale index');
  const { result } = await run(svc, 'quarterly revenue North region');
  assert.equal(result.outcome, 'success_with_results');
  assert.equal(result.hits[0]!.file, 'docs/notes.md');
});

test('backend failure → backend_failed, with an actionable message', async () => {
  const broken = {
    approvedIndexFor: () => 'idx_1',
    retrieve: async () => { throw new Error('connection reset'); },
  };
  const { result } = await run(broken as never, 'revenue');
  assert.equal(result.outcome, 'backend_failed');
  assert.match(result.message!, /try again/i);
  // The operator's error text must not reach the user.
  assert.ok(!/connection reset/.test(result.message!), result.message);
});

test('a backend refusal is a failure, not an empty result', async () => {
  const refusing = {
    approvedIndexFor: () => 'idx_1',
    retrieve: async () => ({ ok: false as const, code: 'NOT_APPROVED', error: 'Index is not approved.' }),
  };
  const { result } = await run(refusing as never, 'revenue');
  assert.equal(result.outcome, 'backend_failed');
  assert.ok(!/NOT_APPROVED/.test(result.message!), 'leaked an operator code');
});

test('provenance is attached on every attempted invocation', async () => {
  const svc = await oneApprovedIndex();
  for (const [query, over] of [
    ['quarterly revenue North region', undefined],
    ['   ', undefined],
    ['revenue', { capability: 'ungranted' as CapabilityState }],
  ] as const) {
    const { result, routed } = await run(svc, query, over);
    const p = result.provenance;
    assert.equal(p.decisionId, routed.decisionId);
    assert.equal(p.invocationId, 'inv-1');
    assert.equal(p.tool, TOOL);
    assert.equal(p.capability, 'Document search');
    assert.equal(p.backend, 'approved-index');
    assert.ok(p.startedAt && p.completedAt);
    assert.equal(p.outcome, result.outcome);
    assert.ok(Array.isArray(p.evidenceRefs));
  }
});

test('provenance carries evidence only for a real success', async () => {
  const svc = await oneApprovedIndex();
  const ok = await run(svc, 'quarterly revenue North region');
  assert.ok(ok.result.provenance.evidenceRefs.length > 0);
  const refused = await run(svc, 'revenue', { capability: 'ungranted' });
  assert.deepEqual(refused.result.provenance.evidenceRefs, []);
});

test('🚨 no consent resolver is called anywhere in the read-only path', async () => {
  // The resolver throws if reached, so this asserts twice over.
  const svc = await oneApprovedIndex();
  for (const over of [
    undefined,
    { capability: 'ungranted' as CapabilityState },
    { authorization: () => ({ authorized: false, basis: 'no' }) },
  ]) {
    const { calls, result } = await run(svc, 'revenue', over);
    assert.ok(!calls.includes('consent'), `consent was sought: ${JSON.stringify(calls)}`);
    assert.ok(!('consentId' in result.provenance), 'a consent id appeared on a read-only path');
  }
});

test('🚨 mutability comes from the manifest, not from the caller', async () => {
  /*
   * The bypass this closes: a caller declaring itself read-only to skip consent.
   * The request type has no such field, and the manifest is the only source.
   */
  assert.equal(toolManifest(TOOL)!.mutating, false);
  assert.equal(toolManifest('test.mutating')!.mutating, true);

  const { r } = resolvers();
  const routed = await routeToolInvocation({ toolId: TOOL, input: { query: 'x' } }, r);
  assert.equal(routed.decision.requiresConsent, false);

  // And an undeclared tool is refused rather than defaulted to read-only.
  const unknown = await routeToolInvocation({ toolId: 'not.declared', input: { query: 'x' } }, r);
  assert.equal(unknown.decision.executable, false);
  assert.equal(unknown.decision.blockedAt, 'registry:unknown');
});

test('normalization clamps the limit and the hash binds the clamped form', async () => {
  assert.deepEqual(normalizeDocumentSearch({ query: '  a   b ', limit: 999 }), { query: 'a b', limit: 25 });
  assert.deepEqual(normalizeDocumentSearch({ query: 'x', limit: 0 }), { query: 'x', limit: 1 });
  const svc = await oneApprovedIndex();
  const { routed } = await run(svc, '  quarterly   revenue  ');
  assert.equal(routed.normalizedInput!.query, 'quarterly revenue');
  assert.ok(routed.inputHash!.startsWith('sha256:'));
});
