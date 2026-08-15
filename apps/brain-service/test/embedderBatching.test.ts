import assert from 'node:assert/strict';
import test from 'node:test';

import { CachedEmbedder, FakeEmbedder, OllamaEmbedder, hashText } from '../src/engine/rag/embedder.js';

/**
 * A full-repository sync must survive a TRANSIENT provider failure.
 *
 * Every full sync failed ~75 seconds in with `embedder HTTP 400` carrying, from
 * inside Ollama, `dial tcp 127.0.0.1:57467: connectex: Only one usage of each
 * socket address ... is normally permitted` — the provider exhausting ephemeral
 * ports to its own model runner under a burst of ~2,200 sequential requests.
 * Replaying the identical batch immediately afterwards SUCCEEDED, which is what
 * proves the payload innocent: not batch size, not chunk length, not content.
 * One blip discarded the entire staging index and left the workspace reporting
 * `files: 0, chunks: 0`.
 *
 * These tests pin: retry-with-backoff on transient failures, NO retry on genuine
 * bad requests, the bounded batch split, result ordering across batches, and the
 * error text — `embedder HTTP 400` with no detail cost a whole diagnosis cycle.
 */

interface Call {
  count: number;
  texts: string[];
}

/** No real backoff in tests — the delays are the production concern, not the contract. */
const noSleep = async (): Promise<void> => {};

/** `new OllamaEmbedder(...)` with the argument tail these tests always want. */
function embedderWith(fetchImpl: typeof fetch, maxBatch = 64, attempts = 5): OllamaEmbedder {
  return new OllamaEmbedder('http://x/v1', 'm', 'v1', undefined, fetchImpl, maxBatch, noSleep, attempts);
}

/** Records each request and returns one deterministic vector per input. */
function stubProvider(calls: Call[], opts: { failAbove?: number } = {}): typeof fetch {
  return (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    calls.push({ count: body.input.length, texts: body.input });
    if (opts.failAbove !== undefined && body.input.length > opts.failAbove) {
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { message: 'Post "http://127.0.0.1:57467/tokenize": dial tcp: no connection' } }),
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: body.input.map((t) => ({ embedding: [t.length] })) }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

test('a batch within the cap is sent as a single request', async () => {
  const calls: Call[] = [];
  const embedder = embedderWith(stubProvider(calls));

  const out = await embedder.embed(['a', 'bb', 'ccc']);

  assert.equal(calls.length, 1, 'no unnecessary splitting');
  assert.deepEqual(out, [[1], [2], [3]]);
});

test('an oversized batch is split into bounded requests', async () => {
  const calls: Call[] = [];
  const embedder = embedderWith(stubProvider(calls));

  const texts = Array.from({ length: 130 }, (_, i) => 'x'.repeat(i + 1));
  const out = await embedder.embed(texts);

  assert.deepEqual(calls.map((c) => c.count), [64, 64, 2], 'split at the cap, remainder last');
  assert.ok(calls.every((c) => c.count <= 64), 'no request ever exceeds the cap');
  assert.equal(out.length, 130, 'every input gets a vector');
});

test('split results stay aligned with their inputs', async () => {
  const calls: Call[] = [];
  const embedder = embedderWith(stubProvider(calls), 8);

  // Vector value == input length, so misordering across batches is detectable.
  const texts = Array.from({ length: 37 }, (_, i) => 'x'.repeat(i + 1));
  const out = await embedder.embed(texts);

  assert.deepEqual(out, texts.map((t) => [t.length]), 'result[i] corresponds to texts[i]');
});

test("the repository's largest file embeds in bounded requests", async () => {
  const calls: Call[] = [];
  const embedder = embedderWith(stubProvider(calls));

  // 375 = chunks produced by MigraTeck/prisma/schema.prisma, the largest here.
  const out = await embedder.embed(Array.from({ length: 375 }, (_, i) => `chunk ${i}`));

  assert.equal(out.length, 375, 'the whole file embeds');
  assert.ok(calls.every((c) => c.count <= 64), 'in bounded requests');
});

test('a provider failure surfaces the provider’s own reason', async () => {
  const calls: Call[] = [];
  const embedder = embedderWith(stubProvider(calls, { failAbove: 0 }));

  await assert.rejects(
    () => embedder.embed(['a']),
    (err: Error) => {
      assert.match(err.message, /embedder HTTP 400/, 'status is kept');
      assert.match(err.message, /tokenize/, 'and the provider reason is appended');
      return true;
    },
  );
});

test('an error body never carries submitted text into diagnostics', async () => {
  const secretish = 'API_KEY=super-secret-value-in-a-chunk';
  const provider = (async () =>
    ({
      ok: false,
      status: 400,
      // A provider that echoes the input back. Only `error.message` may be read.
      json: async () => ({ error: { message: 'batch too large' }, input: [secretish] }),
    }) as unknown as Response) as unknown as typeof fetch;
  const embedder = embedderWith(provider);

  await assert.rejects(
    () => embedder.embed([secretish]),
    (err: Error) => {
      assert.ok(!err.message.includes('super-secret'), 'submitted text must not appear in the error');
      assert.match(err.message, /batch too large/);
      return true;
    },
  );
});

test('a short provider count is still rejected', async () => {
  const provider = (async () =>
    ({ ok: true, status: 200, json: async () => ({ data: [{ embedding: [1] }] }) }) as unknown as Response) as unknown as typeof fetch;
  const embedder = embedderWith(provider);

  await assert.rejects(() => embedder.embed(['a', 'b']), /wrong count/);
});

// ── transient-failure survival (the defect that failed every real sync) ──────

test('a transient provider failure is retried and the sync survives', async () => {
  let attempts = 0;
  const provider = (async (_url: string, init?: { body?: string }) => {
    attempts += 1;
    if (attempts < 3) {
      return {
        ok: false,
        status: 400,
        // The exact shape Ollama returns when it runs out of sockets to its runner.
        json: async () => ({
          error: {
            message:
              'do embedding request: Post "http://127.0.0.1:57467/tokenize": dial tcp 127.0.0.1:57467: connectex: Only one usage of each socket address is normally permitted',
          },
        }),
      } as unknown as Response;
    }
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return { ok: true, status: 200, json: async () => ({ data: body.input.map((t) => ({ embedding: [t.length] })) }) } as unknown as Response;
  }) as unknown as typeof fetch;

  const out = await embedderWith(provider).embed(['abc']);

  assert.equal(attempts, 3, 'retried until the provider recovered');
  assert.deepEqual(out, [[3]], 'and returned the real vectors');
});

test('a connection-level throw is retried too', async () => {
  let attempts = 0;
  const provider = (async (_url: string, init?: { body?: string }) => {
    attempts += 1;
    if (attempts === 1) throw new TypeError('fetch failed');
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return { ok: true, status: 200, json: async () => ({ data: body.input.map(() => ({ embedding: [1] })) }) } as unknown as Response;
  }) as unknown as typeof fetch;

  assert.deepEqual(await embedderWith(provider).embed(['a']), [[1]]);
  assert.equal(attempts, 2);
});

test('a genuine bad request is NOT retried', async () => {
  let attempts = 0;
  const provider = (async () => {
    attempts += 1;
    return { ok: false, status: 400, json: async () => ({ error: { message: 'model "nope" not found' } }) } as unknown as Response;
  }) as unknown as typeof fetch;

  await assert.rejects(() => embedderWith(provider).embed(['a']), /not found/);
  assert.equal(attempts, 1, 'a permanent failure must fail fast, not stretch the sync out');
});

test('a persistently failing provider gives up and reports why', async () => {
  let attempts = 0;
  const provider = (async () => {
    attempts += 1;
    return { ok: false, status: 503, json: async () => ({ error: { message: 'runner unavailable' } }) } as unknown as Response;
  }) as unknown as typeof fetch;

  await assert.rejects(() => embedderWith(provider, 64, 4).embed(['a']), /embedder HTTP 503 — runner unavailable/);
  assert.equal(attempts, 4, 'bounded attempts — never an unbounded retry loop');
});

test('each split batch retries independently', async () => {
  // Batch 2 of 3 blips once; batches 1 and 3 must not be re-sent.
  const seen: number[] = [];
  let batch = 0;
  const provider = (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    seen.push(body.input.length);
    batch += 1;
    if (batch === 2) {
      return { ok: false, status: 400, json: async () => ({ error: { message: 'dial tcp: connection reset' } }) } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({ data: body.input.map((t) => ({ embedding: [t.length] })) }) } as unknown as Response;
  }) as unknown as typeof fetch;

  const texts = Array.from({ length: 10 }, (_, i) => 'x'.repeat(i + 1));
  const out = await embedderWith(provider, 4).embed(texts);

  assert.deepEqual(out, texts.map((t) => [t.length]), 'ordering survives a mid-run retry');
  assert.deepEqual(seen, [4, 4, 4, 2], 'only the failed batch was re-sent');
});

// ── cache must never hand back a hole (the 10-minute failure) ────────────────

/** Counts inner calls so dedupe and cache reuse are observable. */
class CountingEmbedder extends FakeEmbedder {
  embedded = 0;
  override async embed(texts: string[]): Promise<number[][]> {
    this.embedded += texts.length;
    return super.embed(texts);
  }
}

test('every position gets a vector even when the cache evicts mid-batch', async () => {
  const inner = new CountingEmbedder(8);
  // max=2 forces eviction inside a single call — what a 20,000-entry cache does
  // once the repository chunks into ~36,000 pieces.
  const cached = new CachedEmbedder(inner, 2);

  await cached.embed(['alpha']); // 'alpha' is now a cache HIT
  const texts = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
  const out = await cached.embed(texts);

  assert.equal(out.length, texts.length);
  out.forEach((v, i) => {
    assert.ok(Array.isArray(v), `position ${i} must have a vector, got ${String(v)}`);
    assert.ok(v.length > 0, `position ${i} vector must not be empty`);
  });
  // The evicted hit must still be CORRECT, not merely present.
  const [direct] = await new FakeEmbedder(8).embed(['alpha']);
  assert.deepEqual(out[0], direct, 'an evicted cache hit is still the right vector');
});

test('a repeated text is embedded once but fills every position', async () => {
  const inner = new CountingEmbedder(8);
  const cached = new CachedEmbedder(inner, 100);

  const out = await cached.embed(['same', 'other', 'same', 'same']);

  assert.equal(inner.embedded, 2, 'duplicates are collapsed into one inner call');
  assert.deepEqual(out[0], out[2], 'all positions of a repeat share the vector');
  assert.deepEqual(out[0], out[3]);
  assert.notDeepEqual(out[0], out[1]);
});

test('a cache smaller than the batch still returns a full result', async () => {
  const cached = new CachedEmbedder(new CountingEmbedder(8), 1);
  const texts = Array.from({ length: 40 }, (_, i) => `chunk ${i}`);

  const out = await cached.embed(texts);

  assert.equal(out.length, 40);
  assert.equal(out.filter((v) => !Array.isArray(v)).length, 0, 'no undefined vectors reach the caller');
});

test('a durable-cache hit is served without re-embedding', async () => {
  const inner = new CountingEmbedder(8);
  const [vector] = await new FakeEmbedder(8).embed(['persisted']);
  const store = {
    getEmbedding: async (_m: string, _v: string, hash: string) => (hash === hashText('persisted') ? vector : undefined),
    putEmbedding: async () => {},
  };
  const cached = new CachedEmbedder(inner, 100, store);

  const out = await cached.embed(['persisted', 'fresh']);

  assert.equal(inner.embedded, 1, 'only the uncached text is embedded');
  assert.deepEqual(out[0], vector);
});

test('a truncated inner result is rejected, never persisted as a hole', async () => {
  const shortInner = {
    model: 'x',
    version: 'v1',
    // Claims success but omits a vector — must not become an undefined chunk vector.
    embed: async (texts: string[]) => texts.slice(1).map(() => [1]),
  };
  const cached = new CachedEmbedder(shortInner, 100);

  await assert.rejects(() => cached.embed(['a', 'b']), /no vector for input/);
});
