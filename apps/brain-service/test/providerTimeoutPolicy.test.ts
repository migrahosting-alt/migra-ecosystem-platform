import assert from 'node:assert/strict';
import test from 'node:test';

import {
  OpenAiCompatProvider,
  ProviderAbortedError,
  ProviderTimeoutError,
  classifyProviderFailure,
} from '../src/providers/openAiCompatProvider.js';
import type { ChatTurnRequest } from '@migrapilot/shared-types';

/**
 * A slow-but-alive stream must never be killed.
 *
 * The provider armed ONE `setTimeout(abort, 60_000)` before the fetch and never
 * reset it, so an entire generation had to finish inside 60 seconds. A grounded
 * turn on a local 14B model blew past that *after* retrieval, gating, provenance
 * and audit had already succeeded — the expensive work was paid for and thrown
 * away — and it surfaced as a bare `AbortError`, indistinguishable from the user
 * pressing Stop. Reproduced with `requireApproved` both true and false, while the
 * provider answered a 5-token completion in 1.9s.
 *
 * Tokens arriving are proof of liveness, so during a stream the deadline that
 * matters is the GAP between them, not the total.
 */

const req = (chunks = 0): ChatTurnRequest => ({
  feature: 'chat',
  modelProfile: 'default',
  systemPromptId: 'x',
  userPrompt: 'explain the grounding rules',
  context: chunks
    ? {
        retrievedChunks: Array.from({ length: chunks }, (_, i) => ({
          path: `src/file${i}.ts`,
          startLine: 1,
          endLine: 40,
          // Substantial excerpts: a big grounded context is exactly what makes a
          // local generation long enough to trip a total deadline.
          snippet: `// chunk ${i}\n`.repeat(80),
          score: 0.6,
          source: 'embedding' as const,
        })),
      }
    : {},
  outputMode: 'markdown',
});

/** An SSE body that emits `count` deltas with `gapMs` between them. */
function sseStream(count: number, gapMs: number, opts: { headerDelayMs?: number; stallAfter?: number } = {}): typeof fetch {
  return (async (_url: string, init?: { signal?: AbortSignal }) => {
    const signal = init?.signal;
    if (opts.headerDelayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, opts.headerDelayMs);
        signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
      });
    }
    const body = {
      async *[Symbol.asyncIterator]() {
        const enc = new TextEncoder();
        for (let i = 0; i < count; i += 1) {
          if (opts.stallAfter !== undefined && i === opts.stallAfter) {
            // Go silent forever — only the idle clock can end this.
            await new Promise((_resolve, reject) => {
              signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
            });
          }
          await new Promise((resolve, reject) => {
            const t = setTimeout(resolve, gapMs);
            signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('aborted', 'AbortError')); }, { once: true });
          });
          yield enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: `t${i} ` } }] })}\n`);
        }
        yield enc.encode('data: [DONE]\n');
      },
    };
    return { ok: true, status: 200, body } as unknown as Response;
  }) as unknown as typeof fetch;
}

function provider(opts: { connectMs?: number; idleMs?: number; absoluteMs?: number }, fetchImpl: typeof fetch): OpenAiCompatProvider {
  const p = new OpenAiCompatProvider({
    profile: 'default',
    baseUrl: 'http://127.0.0.1:11434/v1',
    model: 'qwen2.5-coder:14b',
    ...(opts.connectMs !== undefined ? { connectTimeoutMs: opts.connectMs } : {}),
    ...(opts.idleMs !== undefined ? { idleTimeoutMs: opts.idleMs } : {}),
    ...(opts.absoluteMs !== undefined ? { absoluteTimeoutMs: opts.absoluteMs } : {}),
  });
  // Inject the transport without widening the public constructor.
  (globalThis as { fetch: typeof fetch }).fetch = fetchImpl;
  return p;
}

const realFetch = globalThis.fetch;
test.afterEach(() => {
  (globalThis as { fetch: typeof fetch }).fetch = realFetch;
});

async function drain(gen: AsyncGenerator<{ delta?: string }>): Promise<string> {
  let out = '';
  for await (const f of gen) if (f.delta) out += f.delta;
  return out;
}

// ── THE DEFECT ──────────────────────────────────────────────────────────────

test('a long stream survives past any single total deadline while tokens flow', async () => {
  // 12 chunks × 30ms = 360ms of streaming against a 100ms idle budget. Under the
  // old single total timer this died; with a per-chunk reset it completes.
  const p = provider({ connectMs: 100, idleMs: 100 }, sseStream(12, 30));

  const text = await drain(p.stream(req(6)));

  assert.equal(text.trim().split(/\s+/).length, 12, 'every token arrived');
  assert.match(text, /^t0 /, 'and in order');
});

test('the connect deadline does NOT linger as a total-request deadline', async () => {
  // Headers take 60ms of an 80ms connect budget, then the stream runs 300ms —
  // far past connect. Leaving that timer armed was the defect.
  const p = provider({ connectMs: 80, idleMs: 200 }, sseStream(10, 30, { headerDelayMs: 60 }));

  const text = await drain(p.stream(req(6)));
  assert.equal(text.trim().split(/\s+/).length, 10, 'streaming is not bounded by the connect budget');
});

test('a grounded context does not shorten the effective budget', async () => {
  // Same timing, a much larger grounded context: the policy is time-based, so a
  // bigger prompt must not make the turn more likely to be killed.
  const p = provider({ connectMs: 100, idleMs: 100 }, sseStream(10, 30));
  assert.equal((await drain(p.stream(req(40)))).trim().split(/\s+/).length, 10);
});

// ── each deadline fires, and says which one ─────────────────────────────────

test('a provider that never returns headers fails with a CONNECT timeout', async () => {
  const p = provider({ connectMs: 40, idleMs: 5_000 }, sseStream(3, 10, { headerDelayMs: 10_000 }));

  await assert.rejects(
    () => drain(p.stream(req())),
    (err: Error) => {
      assert.ok(err instanceof ProviderTimeoutError, `expected ProviderTimeoutError, got ${err.name}`);
      assert.equal((err as ProviderTimeoutError).phase, 'connect');
      assert.match(err.message, /connect timeout/);
      return true;
    },
  );
});

test('a stream that goes silent fails with an IDLE timeout, naming the gap', async () => {
  const p = provider({ connectMs: 500, idleMs: 60 }, sseStream(10, 10, { stallAfter: 3 }));

  await assert.rejects(
    () => drain(p.stream(req(6))),
    (err: Error) => {
      assert.ok(err instanceof ProviderTimeoutError);
      assert.equal((err as ProviderTimeoutError).phase, 'idle');
      assert.equal((err as ProviderTimeoutError).limitMs, 60);
      assert.match(err.message, /no output for 60ms/);
      return true;
    },
  );
});

test('the absolute ceiling is a real guard and is OFF by default', async () => {
  const bounded = provider({ connectMs: 500, idleMs: 500, absoluteMs: 90 }, sseStream(50, 20));
  await assert.rejects(
    () => drain(bounded.stream(req())),
    (err: Error) => {
      assert.equal((err as ProviderTimeoutError).phase, 'absolute');
      return true;
    },
  );

  const unbounded = new OpenAiCompatProvider({ profile: 'default', baseUrl: 'http://x/v1', model: 'm' });
  assert.equal(unbounded.timeoutPolicy().absoluteMs, 0, 'no ceiling unless one is configured');
});

// ── user abort is never reported as a timeout ───────────────────────────────

test('a caller abort is reported as an ABORT, not a timeout', async () => {
  const p = provider({ connectMs: 5_000, idleMs: 5_000 }, sseStream(50, 20));
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 60);

  await assert.rejects(
    () => drain(p.stream(req(6), ac.signal)),
    (err: Error) => {
      assert.ok(err instanceof ProviderAbortedError, `expected ProviderAbortedError, got ${err.name}: ${err.message}`);
      assert.match(err.message, /aborted by the caller/);
      return true;
    },
  );
});

test('a genuine provider failure is not disguised as a timeout', async () => {
  const failing = (async () => ({ ok: false, status: 500, text: async () => 'model exploded' }) as unknown as Response) as unknown as typeof fetch;
  const p = provider({ connectMs: 500, idleMs: 500 }, failing);

  await assert.rejects(
    () => drain(p.stream(req())),
    (err: Error) => {
      assert.ok(!(err instanceof ProviderTimeoutError), 'an HTTP 500 is not a timeout');
      assert.ok(!(err instanceof ProviderAbortedError), 'nor an abort');
      assert.match(err.message, /HTTP 500/);
      assert.match(err.message, /model exploded/, 'the provider reason survives');
      return true;
    },
  );
});

// ── the policy is configurable, and the old option no longer bounds totals ───

test('the legacy requestTimeoutMs seeds CONNECT only, never the total', async () => {
  const p = new OpenAiCompatProvider({ profile: 'default', baseUrl: 'http://x/v1', model: 'm', requestTimeoutMs: 15_000 });
  const policy = p.timeoutPolicy();

  assert.equal(policy.connectMs, 15_000, 'the legacy value still bounds startup');
  assert.equal(policy.idleMs, 120_000, 'but idle is independent of it');
  assert.equal(policy.absoluteMs, 0, 'and it imposes no total ceiling');
});

test('explicit options win over the legacy value', () => {
  const p = new OpenAiCompatProvider({
    profile: 'default', baseUrl: 'http://x/v1', model: 'm',
    requestTimeoutMs: 60_000, connectTimeoutMs: 10_000, idleTimeoutMs: 45_000, absoluteTimeoutMs: 600_000,
  });
  assert.deepEqual(p.timeoutPolicy(), { connectMs: 10_000, idleMs: 45_000, absoluteMs: 600_000 });
});

test('defaults are liveness-based, not total-based', () => {
  const policy = new OpenAiCompatProvider({ profile: 'default', baseUrl: 'http://x/v1', model: 'm' }).timeoutPolicy();
  assert.equal(policy.connectMs, 60_000);
  assert.equal(policy.idleMs, 120_000);
  assert.equal(policy.absoluteMs, 0);
  assert.ok(policy.idleMs > 0, 'there is always SOME liveness guard');
});

// ── the audit/error distinction the operator actually sees ───────────────────

test('every failure class maps to a distinct code, cause and limit', () => {
  const cases: Array<[unknown, string, string, number | undefined]> = [
    [new ProviderTimeoutError('connect', 60_000, 60_001, 'http://x'), 'PROVIDER_CONNECT_TIMEOUT', 'connect-timeout', 60_000],
    [new ProviderTimeoutError('idle', 120_000, 300_000, 'http://x'), 'PROVIDER_IDLE_TIMEOUT', 'idle-timeout', 120_000],
    [new ProviderTimeoutError('absolute', 900_000, 900_001, 'http://x'), 'PROVIDER_ABSOLUTE_TIMEOUT', 'absolute-timeout', 900_000],
    [new ProviderAbortedError(1_234), 'USER_ABORTED', 'user-abort', undefined],
    [new Error('Model provider returned HTTP 500'), 'ENGINE_FAILURE', 'provider-error', undefined],
  ];

  for (const [err, code, cause, limitMs] of cases) {
    const f = classifyProviderFailure(err);
    assert.equal(f.code, code, `code for ${(err as Error).name}`);
    assert.equal(f.cause, cause, `cause for ${(err as Error).name}`);
    assert.equal(f.limitMs, limitMs, `limit for ${(err as Error).name}`);
  }

  // The four classes must be mutually distinguishable — collapsing them into one
  // ENGINE_FAILURE is what hid the total-deadline defect.
  const codes = cases.map(([e]) => classifyProviderFailure(e).code);
  assert.equal(new Set(codes).size, codes.length, 'no two classes share a code');
});

test('a bare AbortError is treated as a cancellation, not an engine fault', () => {
  const bare = new DOMException('This operation was aborted', 'AbortError');
  assert.equal(classifyProviderFailure(bare).cause, 'user-abort');
});

test('the failure classification carries no provider text', () => {
  const f = classifyProviderFailure(new ProviderTimeoutError('idle', 120_000, 300_000, 'http://127.0.0.1:11434/v1'));
  const serialized = JSON.stringify(f);
  assert.ok(!serialized.includes('127.0.0.1'), 'no host/URL in the audit payload');
  assert.deepEqual(Object.keys(f).sort(), ['cause', 'code', 'limitMs'], 'metadata only');
});
