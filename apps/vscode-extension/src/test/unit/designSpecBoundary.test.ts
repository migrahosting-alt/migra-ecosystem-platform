// The design specification must arrive at the Brain as its OWN field.
//
// It used to be concatenated onto the user's message before sending, which left
// the Brain unable to tell a request that CAME WITH its requirement ("build this
// mockup", spec attached) from one that lacked it ("build me a website"). It
// answered the first by asking the user to supply what they had already supplied.
//
// A type is not evidence that a value crossed the boundary, so this asserts the
// SERIALIZED body of the real request rather than the shape of the object.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MigraAiClient } from '../../services/migraAiClient.js';

const SPEC = '[design specification] A hero, a two-column feature row, and a footer.';

/** Capture the body of the single POST the client makes, then end the stream. */
async function capture(req: Record<string, unknown>): Promise<Record<string, unknown>> {
  const original = globalThis.fetch;
  let seen = '';
  globalThis.fetch = (async (_url: unknown, init: { body?: string }) => {
    seen = String(init?.body ?? '');
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      body: (async function* () { yield new TextEncoder().encode('event: done\ndata: {}\n\n'); })(),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  try {
    const client = new MigraAiClient({ baseUrl: () => 'http://127.0.0.1:1', timeoutMs: () => 5000, log: () => {} });
    for await (const _ of client.engineerStream(req as never)) { /* drain */ }
  } catch { /* transport shape is not what this test is about */ }
  finally { globalThis.fetch = original; }
  return seen ? (JSON.parse(seen) as Record<string, unknown>) : {};
}

test('designSpec is sent as its own field, not spliced into the task', async () => {
  const body = await capture({ rootPath: '/ws', task: 'build this page exactly as it is.', designSpec: SPEC });
  assert.equal(body.designSpec, SPEC, 'the specification must cross the wire intact');
  assert.equal(body.task, 'build this page exactly as it is.', 'the task must stay the user’s own words');
  assert.ok(!String(body.task).includes(SPEC), 'the specification must NOT be concatenated onto the task');
});

test('a turn with no attached design sends no designSpec at all', async () => {
  const body = await capture({ rootPath: '/ws', task: 'build me a website' });
  assert.equal('designSpec' in body, false, 'absent means absent — never an empty string');
});
