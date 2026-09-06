import assert from 'node:assert/strict';
import test from 'node:test';

import { IndexService, type FileSource, type Scope } from '../src/engine/rag/indexService.js';
import { FakeEmbedder } from '../src/engine/rag/embedder.js';

/**
 * WHICH APPROVED INDEX A SCOPE IS GROUNDED ON, when it has more than one.
 *
 * 🚨 THE MEASURED FAILURE. `approvedIndexFor` returned "the first approved index
 * for the workspace" — it iterated a Map and took whichever it met first, i.e.
 * load order. One scope normally holds one approved index, so this looked
 * correct for as long as that held.
 *
 * A scope acquired a second index when its upload root changed mid-session. The
 * user's file was uploaded, indexed and approved in the NEW index (4 files, 128
 * chunks); the resolver bound to the OLD one, and every grounded question came
 * back "Your indexed documents do not cover that" — a refusal indistinguishable
 * from "your file is not indexed". A migration or a redeploy onto a different
 * path puts a real user in exactly that state.
 *
 * The property under test is NOT "it picks one". It is that the choice is
 * DETERMINISTIC and RIGHT: content beats emptiness, recency beats staleness, and
 * the result never depends on insertion order. A resolver that detected
 * multiplicity and refused would be the same defect wearing a hat — a scope with
 * two approved indexes has a correct answer.
 */

const scope: Scope = { owner: 'owner-a', workspace: 'ws-a' };

/** A service with two approved indexes in ONE scope — the state that failed. */
async function serviceWithTwoIndexes(opts: {
  /** Which of the two gets real content. */
  contentIn: 'old' | 'new' | 'both' | 'neither';
}): Promise<{ service: IndexService; oldId: string; newId: string }> {
  const WITH = [{ relPath: 'docs/notes.md', content: '# notes\n\nQuarterly revenue was recorded here.\n' }];
  const byRoot = new Map<string, Array<{ relPath: string; content: string }>>();

  /*
   * A CONTROLLED CLOCK, because the first version of this test raced the real
   * one: both indexes were created inside the same millisecond, `updatedAt`
   * tied, and the "more recently updated wins" case passed or failed depending
   * on how an arbitrary id tiebreak happened to sort. A test that flips between
   * runs cannot pin anything, in either direction.
   */
  let clock = 1_000_000;
  const service = new IndexService(
    new FakeEmbedder(64),
    (record): FileSource => ({ files: async () => byRoot.get(record.root) ?? [] }),
    () => (clock += 1000),
    undefined,
    undefined,
  );

  byRoot.set('/old-root', opts.contentIn === 'old' || opts.contentIn === 'both' ? WITH : []);
  byRoot.set('/new-root', opts.contentIn === 'new' || opts.contentIn === 'both' ? WITH : []);

  const oldRec = await service.createIndex(scope, { sourceType: 'docs', root: '/old-root' });
  await service.sync(oldRec.id, scope);
  await service.setState(oldRec.id, scope, 'approved');

  // Deliberately created SECOND, so insertion order favours the old one — which
  // is precisely how the original defect expressed itself.
  const newRec = await service.createIndex(scope, { sourceType: 'docs', root: '/new-root' });
  await service.sync(newRec.id, scope);
  await service.setState(newRec.id, scope, 'approved');

  return { service, oldId: oldRec.id, newId: newRec.id };
}

test('🚨 the index holding the content is chosen, not the one loaded first', async () => {
  const { service, oldId, newId } = await serviceWithTwoIndexes({ contentIn: 'new' });
  const chosen = service.approvedIndexFor(scope);
  assert.equal(chosen, newId, 'bound to the stale index — the original defect');
  assert.notEqual(chosen, oldId);
});

test('an empty approved index never wins over one with chunks', async () => {
  // The observed failure in one line: an approved index with zero chunks cannot
  // answer anything, and preferring it refuses every valid question.
  const { service, newId } = await serviceWithTwoIndexes({ contentIn: 'new' });
  const ranked = service.approvedIndexesFor(scope);
  assert.equal(ranked.length, 2, 'both indexes must stay visible');
  assert.equal(ranked[0]!.id, newId);
  assert.ok(ranked[0]!.chunks > 0, 'the chosen index has no content');
  assert.equal(ranked[1]!.chunks, 0);
});

test('with content in BOTH, the more recently updated one wins', async () => {
  const { service, newId } = await serviceWithTwoIndexes({ contentIn: 'both' });
  assert.equal(service.approvedIndexFor(scope), newId, 'the index the user just wrote into must win');
});

test('the order is TOTAL — repeated calls never disagree', async () => {
  // The defect was load-order dependence. Determinism is the fix, so it is
  // asserted directly rather than inferred from one lucky call.
  const { service } = await serviceWithTwoIndexes({ contentIn: 'both' });
  const first = service.approvedIndexFor(scope);
  for (let i = 0; i < 20; i += 1) {
    assert.equal(service.approvedIndexFor(scope), first, `call ${i} disagreed`);
  }
  const ranked = service.approvedIndexesFor(scope).map((r) => r.id);
  for (let i = 0; i < 5; i += 1) {
    assert.deepEqual(service.approvedIndexesFor(scope).map((r) => r.id), ranked);
  }
});

test('multiplicity is REPORTED, never silently collapsed', async () => {
  // A scope holding two approved indexes is a condition worth seeing. The old
  // getter hid it completely.
  const { service } = await serviceWithTwoIndexes({ contentIn: 'new' });
  assert.equal(service.approvedIndexesFor(scope).length, 2);
});

test('two empty approved indexes still resolve deterministically', async () => {
  // Nothing can be answered either way, but the resolver must not become
  // order-dependent again in the degenerate case.
  const { service } = await serviceWithTwoIndexes({ contentIn: 'neither' });
  const chosen = service.approvedIndexFor(scope);
  assert.ok(chosen, 'must still choose one rather than returning undefined');
  for (let i = 0; i < 10; i += 1) assert.equal(service.approvedIndexFor(scope), chosen);
});

test('a scope with no approved index still returns undefined', async () => {
  // The negative half: this must not start inventing an index.
  const service = new IndexService(
    new FakeEmbedder(64),
    (): FileSource => ({ files: async () => [] }),
    undefined,
    undefined,
    undefined,
  );
  const rec = await service.createIndex(scope, { sourceType: 'docs', root: '/only-root' });
  await service.sync(rec.id, scope);
  // Synced but NOT approved.
  assert.equal(service.approvedIndexFor(scope), undefined);
  assert.deepEqual(service.approvedIndexesFor(scope), []);
});

test('another scope is never borrowed from', async () => {
  // Scope isolation is the one property that must survive any ranking change.
  const { service } = await serviceWithTwoIndexes({ contentIn: 'new' });
  const other: Scope = { owner: 'owner-b', workspace: 'ws-b' };
  assert.equal(service.approvedIndexFor(other), undefined);
  assert.deepEqual(service.approvedIndexesFor(other), []);
});
