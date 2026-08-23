/**
 * A DELETE with `content-type: application/json` and no body must perform the
 * delete, not answer 500.
 *
 * This is not a hypothetical HTTP nicety. The candidate gate sent exactly that
 * request — the normal thing for a client that sets one content-type header for
 * every call — and `DELETE /api/ai/conversations/:id` answered
 * `500 Internal server error` with FST_ERR_CTP_EMPTY_JSON_BODY. From the
 * client's side a 500 on a delete is indistinguishable from a delete that
 * failed, so the user is told their conversation might still be there.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import Fastify from 'fastify';
import { installJsonBodyParser } from '../src/http/jsonBodyParser.js';

async function appWithRoutes() {
  const app = Fastify();
  installJsonBodyParser(app);
  app.delete('/thing/:id', async (request) => ({ deleted: (request.params as { id: string }).id, body: request.body ?? null }));
  app.post('/thing', async (request) => ({ body: request.body ?? null }));
  await app.ready();
  return app;
}

test('DELETE with a JSON content-type and NO body reaches the handler', async () => {
  const app = await appWithRoutes();
  const res = await app.inject({
    method: 'DELETE', url: '/thing/abc', headers: { 'content-type': 'application/json' },
  });
  assert.equal(res.statusCode, 200, 'an empty body must not be a server error');
  assert.deepEqual(res.json(), { deleted: 'abc', body: null });
  await app.close();
});

test('a whitespace-only body is also treated as empty', async () => {
  const app = await appWithRoutes();
  const res = await app.inject({
    method: 'POST', url: '/thing', headers: { 'content-type': 'application/json' }, payload: '   \n ',
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { body: null });
  await app.close();
});

test('a real JSON body still parses', async () => {
  const app = await appWithRoutes();
  const res = await app.inject({
    method: 'POST', url: '/thing', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ a: 1 }),
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { body: { a: 1 } });
  await app.close();
});

test('a MALFORMED body is a 400, not a 500 and not silently accepted', async () => {
  // The permissive path must not swallow genuinely broken input — that would
  // trade one wrong answer for another.
  const app = await appWithRoutes();
  const res = await app.inject({
    method: 'POST', url: '/thing', headers: { 'content-type': 'application/json' }, payload: '{"a": ',
  });
  assert.equal(res.statusCode, 400, 'a bad body is the client\'s error, not the server\'s');
  await app.close();
});
