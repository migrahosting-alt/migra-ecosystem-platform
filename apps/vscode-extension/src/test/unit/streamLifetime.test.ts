// Long streams: keepalives keep them alive, and an unfinished stream is never
// reported as a finished one.
//
// Both behaviours were defects the benchmark produced. A local model can be silent
// for minutes during prefill, and the engineer stream previously fell out of its
// loop and returned NORMALLY when the connection died mid-answer — so a truncated
// result was indistinguishable from a complete one.

import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { MigraAiClient } from '../../services/migraAiClient.js';
import { PilotError } from '@migrapilot/pilot-client';

let server: Server;
let baseUrl = '';
/** Set per test: how the /api/ai/engineer stream should behave. */
let mode: 'keepalive-then-done' | 'die-midway' | 'keepalive-only' = 'keepalive-then-done';

function frame(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

before(async () => {
  server = createServer(async (req, res) => {
    if ((req.url ?? '').startsWith('/api/ai/engineer')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (mode === 'keepalive-then-done') {
        // Long silence, proven alive by keepalives, then a real answer.
        frame(res, 'keepalive', { elapsedMs: 15000 });
        frame(res, 'keepalive', { elapsedMs: 30000 });
        frame(res, 'token', { text: 'hello' });
        frame(res, 'done', { stepsUsed: 1 });
        res.end();
        return;
      }
      if (mode === 'die-midway') {
        frame(res, 'token', { text: 'partial' });
        res.destroy(); // the connection dies with no `done`
        return;
      }
      frame(res, 'keepalive', { elapsedMs: 15000 });
      res.end(); // ends without ever answering
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || !address) throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(() => server.close());

const client = (): MigraAiClient =>
  new MigraAiClient({ baseUrl: () => baseUrl, timeoutMs: () => 5_000, log: () => {} });

async function drain(gen: AsyncGenerator<{ event: string; data: unknown }>): Promise<string[]> {
  const events: string[] = [];
  for await (const e of gen) events.push(e.event);
  return events;
}

test('KEEPALIVES prove life without polluting the answer', async () => {
  mode = 'keepalive-then-done';
  const events = await drain(client().engineerStream({ rootPath: '/w', task: 'x' }));
  assert.deepEqual(events, ['token'], 'keepalive frames are consumed, never yielded as content');
});

test('A STREAM THAT DIES MID-ANSWER IS NOT A COMPLETED ONE', async () => {
  mode = 'die-midway';
  await assert.rejects(
    () => drain(client().engineerStream({ rootPath: '/w', task: 'x' })),
    (error: Error) => {
      assert.ok(error instanceof PilotError, `expected a PilotError, got ${error.name}`);
      // NETWORK would be acceptable for a destroyed socket; what must never happen
      // is the generator returning normally, which is what it used to do.
      assert.ok(['STREAM_INTERRUPTED', 'NETWORK'].includes(error.code), `unexpected code ${error.code}`);
      return true;
    },
  );
});

test('a stream that ends cleanly WITHOUT a done frame is STREAM_INTERRUPTED', async () => {
  mode = 'keepalive-only';
  await assert.rejects(
    () => drain(client().engineerStream({ rootPath: '/w', task: 'x' })),
    (error: Error) => {
      assert.equal((error as PilotError).code, 'STREAM_INTERRUPTED');
      assert.match(error.message, /ended before the run completed/);
      return true;
    },
  );
});

test('STREAM_INTERRUPTED is distinct from cancellation and from a generic failure', () => {
  const interrupted = new PilotError('STREAM_INTERRUPTED', 'x');
  assert.notEqual(interrupted.code, 'CANCELLED');
  assert.notEqual(interrupted.code, 'NETWORK');
  assert.notEqual(interrupted.code, 'SERVER_ERROR');
});
