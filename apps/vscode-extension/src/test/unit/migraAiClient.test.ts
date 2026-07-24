import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { MigraAiClient, type AiChatRequest } from '../../services/migraAiClient.js';
import { PilotError } from '@migrapilot/pilot-client';

/** A tiny stand-in for the engine `/api/ai/*` surface. Behavior is switched by
 * the request path so one server exercises every client branch. */
let server: Server;
let baseUrl = '';
let lastChatBody: Record<string, unknown> | undefined;

function sse(res: ServerResponse, frames: Array<{ event: string; data: unknown }>): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const f of frames) res.write(`event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`);
  res.end();
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

before(async () => {
  server = createServer(async (req, res) => {
    const url = req.url ?? '';
    if (url === '/api/ai/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: 1, providers: ['local'], models: [{ id: 'm1', provider: 'local', tier: 'fast', capabilities: { chat: true } }] }));
      return;
    }
    if (url === '/api/ai/chat') {
      lastChatBody = await readBody(req);
      const requestId = String(req.headers['x-request-id'] ?? '');
      if (lastChatBody.markerError) {
        sse(res, [{ event: 'error', data: { code: 'NO_MODEL', message: 'x' } }]);
        return;
      }
      if (lastChatBody.markerDrip) {
        // Emit tokens spaced UNDER the client timeout, with a TOTAL duration OVER
        // it — a legitimately long-but-active stream. A correct inactivity timeout
        // resets on each token and lets this complete; a total-duration timeout
        // would spuriously abort it as "didn't respond in time".
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`event: route\ndata: ${JSON.stringify({ model: 'm1', provider: 'local', tier: 'fast', reason: 'r', failedOver: [] })}\n\n`);
        let i = 0;
        const tick = (): void => {
          if (i < 6) {
            res.write(`event: token\ndata: ${JSON.stringify({ text: 't' + i })}\n\n`);
            i += 1;
            const timer = setTimeout(tick, 60);
            req.on('close', () => clearTimeout(timer));
          } else {
            res.write(`event: done\ndata: ${JSON.stringify({ model: 'm1' })}\n\n`);
            res.end();
          }
        };
        const t0 = setTimeout(tick, 60);
        req.on('close', () => clearTimeout(t0));
        return;
      }
      if (lastChatBody.markerSlow) {
        // Emit route + one token, then stall — lets a test abort mid-stream.
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`event: route\ndata: ${JSON.stringify({ model: 'm1', provider: 'local', tier: 'fast', reason: 'r', failedOver: [] })}\n\n`);
        res.write(`event: token\ndata: ${JSON.stringify({ text: 'partial' })}\n\n`);
        const timer = setTimeout(() => {
          res.write(`event: done\ndata: ${JSON.stringify({ model: 'm1' })}\n\n`);
          res.end();
        }, 2000);
        req.on('close', () => clearTimeout(timer));
        return;
      }
      if (lastChatBody.markerFailover) {
        sse(res, [
          { event: 'route', data: { model: 'llava', provider: 'local', tier: 'fast', reason: 'failover → llava', failedOver: ['broken-vision'] } },
          { event: 'token', data: { text: 'Blue' } },
          { event: 'done', data: { model: 'llava', provider: 'local', tier: 'fast', usage: { inputTokens: 5, outputTokens: 1 }, failedOver: ['broken-vision'] } },
        ]);
        return;
      }
      sse(res, [
        { event: 'route', data: { requestId, model: 'm1', provider: 'local', tier: 'fast', reason: 'selected m1', failedOver: [] } },
        { event: 'token', data: { text: 'Hello' } },
        { event: 'token', data: { text: ' world' } },
        { event: 'done', data: { requestId, model: 'm1', provider: 'local', tier: 'fast', usage: { inputTokens: 3, outputTokens: 2 }, failedOver: [] } },
      ]);
      return;
    }
    if (url.startsWith('/api/ai/tools')) {
      if (req.method === 'GET') {
        if (url === '/api/ai/tools' || url.startsWith('/api/ai/tools?')) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ count: 1, tools: [{ id: 'git.status', kind: 'tool', readOnly: true, available: true }] }));
          return;
        }
        if (url === '/api/ai/tools/git.status') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: 'git.status', kind: 'tool', readOnly: true, available: true }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'UNKNOWN_TOOL' }));
        return;
      }
      // POST /api/ai/tools
      const body = await readBody(req);
      const requestId = (req.headers['x-request-id'] as string) ?? 'none';
      if (body.tool === 'unknown.tool') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'UNKNOWN_TOOL', requestId }));
        return;
      }
      if (body.tool === 'terminal.exec') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'CAPABILITY_DENIED', requestId }));
        return;
      }
      if (body.tool === 'bad.input') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          code: 'INVALID_INPUT',
          error: 'Agent input failed schema validation.',
          issues: [{ path: 'rootPath', message: 'Required' }, { path: 'path', message: 'Required' }],
          requestId,
        }));
        return;
      }
      if (body.tool === 'explode.tool') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'TOOL_FAILED', requestId }));
        return;
      }
      if (body.approvalId === 'used') {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, code: 'INVALID_STATE', requestId }));
        return;
      }
      if (body.tool === 'edit.apply' && !body.approvalId) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, status: 'approval_required', tool: 'edit.apply', approvalId: 'appr-1', preview: { files: [] }, expiresAt: 1, requestId }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, status: 'ok', tool: body.tool, result: { branch: 'main' }, requestId }));
      return;
    }
    // Any other path → 404 (engine facade absent / incompatible).
    res.writeHead(404).end('not found');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function client(base = baseUrl): MigraAiClient {
  return new MigraAiClient({ baseUrl: () => base, timeoutMs: () => 5000, log: () => {} });
}

async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

test('getModels returns the catalog', async () => {
  const res = await client().getModels();
  assert.equal(res.count, 1);
  assert.equal(res.models[0]?.id, 'm1');
});

test('chatStream yields route → tokens → done in order', async () => {
  const requestId = 'extension-foundation-1';
  const events = (await collect(client().chatStream({ prompt: 'hi' }, undefined, requestId))) as Array<{ type: string; requestId?: string }>;
  assert.deepEqual(events.map((e) => e.type), ['route', 'token', 'token', 'done']);
  assert.equal(events[0]?.requestId, requestId);
  assert.equal(events.at(-1)?.requestId, requestId);
  const route = events[0] as { type: 'route'; routing: { model: string; reason: string; failedOver: string[] } };
  assert.equal(route.routing.model, 'm1');
});

test('failover metadata is surfaced on route + done', async () => {
  const events = (await collect(client().chatStream({ prompt: 'color?', markerFailover: true } as unknown as AiChatRequest))) as Array<Record<string, unknown>>;
  const route = events.find((e) => e.type === 'route') as { routing: { model: string; failedOver: string[] } };
  assert.equal(route.routing.model, 'llava');
  assert.deepEqual(route.routing.failedOver, ['broken-vision']);
  const done = events.find((e) => e.type === 'done') as { failedOver: string[] };
  assert.deepEqual(done.failedOver, ['broken-vision']);
});

test('an engine error frame throws a mapped PilotError (NO_MODEL → CAPABILITY_MISSING)', async () => {
  await assert.rejects(
    () => collect(client().chatStream({ prompt: 'x', markerError: true } as unknown as AiChatRequest)),
    (err: unknown) => err instanceof PilotError && err.code === 'CAPABILITY_MISSING',
  );
});

test('missing /api/ai facade (404) throws CAPABILITY_MISSING — never a legacy fallback', async () => {
  const bad = new MigraAiClient({ baseUrl: () => `${baseUrl}/wrong-prefix`, timeoutMs: () => 5000, log: () => {} });
  await assert.rejects(
    () => collect(bad.chatStream({ prompt: 'x' })),
    (err: unknown) => err instanceof PilotError && err.code === 'CAPABILITY_MISSING',
  );
});

test('listTools + getTool return capability metadata', async () => {
  const cat = await client().listTools();
  assert.equal(cat.count, 1);
  assert.equal(cat.tools[0]?.id, 'git.status');
  const one = await client().getTool('git.status');
  assert.equal(one.id, 'git.status');
});

test('executeTool read-only returns a typed result via runReadOnlyTool', async () => {
  const result = await client().runReadOnlyTool<{ branch: string }>('git.status', { rootPath: '/x' });
  assert.equal(result.branch, 'main');
});

test('executeTool mutating returns approval_required with an approvalId', async () => {
  const res = await client().executeTool({ tool: 'edit.apply', input: { rootPath: '/x', changes: [] } });
  assert.equal(res.status, 'approval_required');
  assert.equal((res as { approvalId: string }).approvalId, 'appr-1');
});

test('unknown tool → CAPABILITY_MISSING; denied → CAPABILITY_MISSING; replay → INVALID_STATE', async () => {
  await assert.rejects(
    () => client().executeTool({ tool: 'unknown.tool', input: {} }),
    (e: unknown) => e instanceof PilotError && e.code === 'CAPABILITY_MISSING',
  );
  await assert.rejects(
    () => client().executeTool({ tool: 'terminal.exec', input: {} }),
    (e: unknown) => e instanceof PilotError && e.code === 'CAPABILITY_MISSING',
  );
  await assert.rejects(
    () => client().executeTool({ tool: 'edit.apply', input: {}, approvalId: 'used' }),
    (e: unknown) => e instanceof PilotError && e.code === 'INVALID_STATE',
  );
});

test('schema validation failure → INVALID_INPUT with the engine issues, never a generic SERVER_ERROR', async () => {
  await assert.rejects(
    () => client().executeTool({ tool: 'bad.input', input: {} }),
    (e: unknown) =>
      e instanceof PilotError &&
      e.code === 'INVALID_INPUT' &&
      /Agent input failed schema validation/.test(e.message) &&
      /rootPath: Required; path: Required/.test(e.message),
  );
});

test('unexpected tool failure stays SERVER_ERROR (TOOL_FAILED is not a validation error)', async () => {
  await assert.rejects(
    () => client().executeTool({ tool: 'explode.tool', input: {} }),
    (e: unknown) => e instanceof PilotError && e.code === 'SERVER_ERROR',
  );
});

test('a long-but-active stream completes: the timeout is inactivity-based, not total-duration', async () => {
  // Client timeout 150ms; the server drips 6 tokens ~60ms apart (total ~420ms).
  // Each token must reset the deadline, so the stream finishes with `done` and
  // NEVER surfaces a spurious TIMEOUT ("didn't respond in time").
  const c = new MigraAiClient({ baseUrl: () => baseUrl, timeoutMs: () => 150, log: () => {} });
  const events = (await collect(c.chatStream({ prompt: 'hi', markerDrip: true } as unknown as AiChatRequest))) as Array<{ type: string }>;
  const types = events.map((e) => e.type);
  assert.equal(types[0], 'route');
  assert.equal(types.filter((t) => t === 'token').length, 6, 'all 6 dripped tokens arrive');
  assert.equal(types[types.length - 1], 'done', 'stream completes, no TIMEOUT');
});

test('a genuinely idle stream still times out (inactivity detection intact)', async () => {
  // Client timeout 150ms; markerSlow emits route+token then stalls 2000ms. With no
  // further activity past the deadline, the inactivity timer must still fire TIMEOUT.
  const c = new MigraAiClient({ baseUrl: () => baseUrl, timeoutMs: () => 150, log: () => {} });
  await assert.rejects(
    async () => { for await (const _ of c.chatStream({ prompt: 'hi', markerSlow: true } as unknown as AiChatRequest)) { /* drain */ } },
    (err: unknown) => err instanceof PilotError && err.code === 'TIMEOUT',
  );
});

test('aborting the signal cancels the stream with CANCELLED (no false completion)', async () => {
  const controller = new AbortController();
  const gen = client().chatStream({ prompt: 'hi', markerSlow: true } as unknown as AiChatRequest, controller.signal);
  const first = await gen.next(); // route
  assert.equal((first.value as { type: string }).type, 'route');
  controller.abort();
  await assert.rejects(
    async () => {
      for await (const _ of gen) {
        /* drain until abort surfaces */
      }
    },
    (err: unknown) => err instanceof PilotError && err.code === 'CANCELLED',
  );
});
