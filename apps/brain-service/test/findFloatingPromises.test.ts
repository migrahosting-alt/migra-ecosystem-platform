/**
 * The acceptance instrument's OWN acceptance.
 *
 * `findFloatingPromises` is what tells us whether the sync→async migration is
 * finished, so its two failure modes both matter and they are not symmetric:
 *
 *   FALSE NEGATIVE — a dropped durable write goes unreported. This is how the
 *     migration shipped bugs that `tsc` could not see; a suppression rule that
 *     is too broad reintroduces exactly that.
 *   FALSE POSITIVE — noise. 94 of 196 hits were Fastify reply chaining, and a
 *     reader who filters that by hand every time eventually filters a real one.
 *
 * So the suppression rule is pinned from BOTH sides here: the framework patterns
 * must be classified, and a persistence write must still be reported even when
 * it is spelled to look like one. © MigraTeck LLC.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findFloatingPromisesInSource } from './support/findFloatingPromises.js';

/** A stand-in for the real surfaces: a chainable thenable reply, and a store. */
const PRELUDE = `
interface Reply extends PromiseLike<void> {
  code(n: number): Reply;
  status(n: number): Reply;
  header(k: string, v: string): Reply;
  type(t: string): Reply;
  send(body?: unknown): Reply;
  hijack(): Reply;
}
declare const reply: Reply;
declare const res: Reply;
declare const store: { setIndexState(id: string, s: string): Promise<void>; close(): void };
declare function plain(): void;
`;

const scan = (body: string) => findFloatingPromisesInSource(PRELUDE + body);
const categories = (body: string) => scan(body).map((r) => r.category);

test('a dropped durable write is reported as OPEN', () => {
  const hits = scan(`store.setIndexState('i', 'degraded');`);
  assert.equal(hits.length, 1, 'the write must be seen');
  assert.equal(hits[0]!.category, 'open', 'and must count against the closure criterion');
  assert.match(hits[0]!.text, /setIndexState/);
});

test('an awaited write is not reported at all', async () => {
  assert.deepEqual(scan(`async function f() { await store.setIndexState('i', 'x'); }`), []);
});

test('a non-thenable call is not reported', () => {
  assert.deepEqual(scan(`plain(); store.close();`), []);
});

test('Fastify reply chaining is classified as framework, never as open', () => {
  assert.deepEqual(categories(`
    reply.code(400);
    reply.status(500);
    reply.header('x', 'y');
    reply.type('application/json');
    reply.send({ ok: true });
    reply.hijack();
    res.code(404);
  `), ['framework', 'framework', 'framework', 'framework', 'framework', 'framework', 'framework']);
});

test('a chained reply call resolves through to the leftmost receiver', () => {
  assert.deepEqual(categories(`reply.code(400).send({ ok: false });`), ['framework']);
});

/**
 * The rule must key on the RECEIVER, not merely the method name. A store that
 * happens to expose `send` is not a Fastify reply, and suppressing it would be
 * precisely the false negative this instrument exists to prevent.
 */
test('the framework rule does NOT suppress a same-named method on another receiver', () => {
  const hits = scan(`
    declare const queue: { send(m: string): Promise<void> };
    queue.send('m');
  `);
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.category, 'open', 'a non-reply `send` is still a dropped promise');
});

test('an unknown method on a reply is still reported', () => {
  const hits = scan(`
    declare const reply2: { flushHeaders(): Promise<void> };
    reply2.flushHeaders();
  `);
  assert.equal(hits[0]?.category, 'open');
});

// ── the three-category closure criterion ─────────────────────────────────────

test('a floating-ok annotation categorizes a hit and carries its reason', () => {
  const hits = scan(`
    // floating-ok: detached — swallowed by contract; surfaced through health
    store.setIndexState('i', 'x');
  `);
  assert.equal(hits.length, 1, 'still reported — categorized is not hidden');
  assert.equal(hits[0]!.category, 'detached');
  assert.equal(hits[0]!.reason, 'swallowed by contract; surfaced through health');
});

test('a trailing annotation on the same line also counts', () => {
  const hits = scan(`store.setIndexState('i', 'x'); // floating-ok: accepted — awaited by the caller`);
  assert.equal(hits[0]!.category, 'accepted');
  assert.equal(hits[0]!.reason, 'awaited by the caller');
});

test('an annotation without a reason still categorizes', () => {
  assert.equal(scan(`
    // floating-ok: detached
    store.setIndexState('i', 'x');
  `)[0]!.category, 'detached');
});

test('an unrelated comment does NOT categorize', () => {
  assert.equal(scan(`
    // this is fine, honestly
    store.setIndexState('i', 'x');
  `)[0]!.category, 'open');
});

test('an annotation overrides the automatic framework classification', () => {
  // Keeps the human's word authoritative over the heuristic, in both directions.
  assert.equal(scan(`
    // floating-ok: accepted — deliberately recorded as an async dependency
    reply.code(400);
  `)[0]!.category, 'accepted');
});
