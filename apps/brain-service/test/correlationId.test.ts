/**
 * The id a request is recorded under.
 *
 * It arrives in a header and lands in the DURABLE audit store, so what this
 * accepts is what a caller can write into records the service is meant to trust.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';

import { engineCorrelationId } from '../src/engine/toolRoutes.js';

async function idFor(headers: Record<string, string>): Promise<string> {
  const app = Fastify();
  app.get('/probe', async (request) => ({ id: engineCorrelationId(request) }));
  const res = await app.inject({ method: 'GET', url: '/probe', headers });
  await app.close();
  return (res.json() as { id: string }).id;
}

test('a well-formed id from the consumer is used as-is, which is the whole point', async () => {
  const supplied = 'req_0123456789abcdef0123';
  assert.equal(await idFor({ 'x-request-id': supplied }), supplied);
  // A plain UUID is the other shape that legitimately arrives.
  const uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
  assert.equal(await idFor({ 'x-request-id': uuid }), uuid);
});

test('a hostile or malformed id is replaced, and the replacement is usable', async () => {
  const rejected = [
    'req_abc\nAUDIT forged entry',
    'x'.repeat(500),
    'has spaces in it',
    '../../etc/passwd',
    'semi;colon',
    '',
  ];
  for (const value of rejected) {
    const id = await idFor({ 'x-request-id': value });
    assert.notEqual(id, value, `${JSON.stringify(value)} must not be recorded verbatim`);
    assert.ok(!id.includes('\n'));
    assert.match(id, /^[A-Za-z0-9_-]{1,128}$/);
  }
});

test('a short id is a short id, not a threat — it is passed through', () => {
  /*
   * A minimum length here once broke a caller for no security gain. What is
   * dangerous about this value is its charset and its length, not its brevity.
   */
  return idFor({ 'x-request-id': 'req-abc' }).then((id) => assert.equal(id, 'req-abc'));
});

test('no header at all still yields an id, because every request needs a name', async () => {
  const id = await idFor({});
  assert.match(id, /^[A-Za-z0-9_-]{1,128}$/);
  assert.notEqual(id, await idFor({}));
});
