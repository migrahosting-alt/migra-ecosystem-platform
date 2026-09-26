/**
 * MigraAI Engine — RAG embedding service.
 *
 * Injectable so production uses `nomic-embed-text` via the engine's OpenAI-compat
 * endpoint while tests use a deterministic fake. A content-hash cache means an
 * unchanged chunk is never re-embedded (incremental re-indexing is cheap).
 */

import { createHash } from 'node:crypto';

export interface Embedder {
  readonly model: string;
  readonly version: string;
  /** Embed a batch; result[i] corresponds to texts[i]. Throws on provider failure
   * (the caller keeps the prior index rather than corrupting it). */
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Largest number of texts sent in one embeddings request.
 *
 * Not a correctness requirement — a bound on per-request payload and latency, so
 * one enormous file cannot produce a single multi-minute request whose failure
 * discards the whole batch. `MigraTeck/prisma/schema.prisma` chunks into 375.
 */
const MAX_EMBED_BATCH = 64;

/**
 * Retry budget for TRANSIENT provider failures.
 *
 * A full-repository sync makes one embeddings request per file (~2,200 here) and
 * consistently died around 75 seconds in with `400` and, from inside Ollama:
 *
 *   Post "http://127.0.0.1:57467/tokenize": dial tcp 127.0.0.1:57467:
 *   connectex: Only one usage of each socket address ... is normally permitted
 *
 * That is the provider exhausting ephemeral ports to its OWN model runner —
 * sockets piling up in TIME_WAIT under a burst of sequential requests. It is not
 * our payload: replaying the identical batch immediately afterwards SUCCEEDS, and
 * a 3-second pause is enough for the provider to recover. It is also not batch
 * size or chunk length; those were ruled out by measurement.
 *
 * Without a retry, one such blip fails the entire sync — `IndexService.sync()`
 * discards the staging index, marks it `degraded`, and the workspace reports
 * `files: 0, chunks: 0` forever. A few backed-off attempts turn a whole-run
 * failure into a brief pause.
 */
const EMBED_ATTEMPTS = 5;

/**
 * How long ONE embeddings request may take before it is abandoned.
 *
 * 🚨 THERE WAS NO TIMEOUT HERE AT ALL, AND A SYNC HUNG FOR MINUTES IN SILENCE.
 *
 * Measured on staging 2026-09-26: `POST /api/ai/indexes/<id>/sync` logged
 * `incoming request` at 15:16:31 and NEVER logged a completion — no response, no
 * error, nothing, while the consumer's caller gave up and the user saw a 504.
 * Every sync that did finish took between sub-millisecond and 469 ms, so this was
 * a stall, not slowness.
 *
 * The provider is not local: `MIGRAPILOT_PROVIDER_URL` points at an Ollama on a
 * TAILNET PEER. A peer that sleeps, roams or loses its route does not refuse a
 * connection — it accepts and goes quiet, which is the one failure a bare `fetch`
 * will wait out. Undici's own default is ~300 s per attempt; across
 * {@link EMBED_ATTEMPTS} that is twenty-five minutes of work nobody is waiting
 * for any more, holding a staging index in `syncing` the whole time.
 *
 * 30 s is ~70x the slowest healthy call measured against that peer (0.41 s), so
 * it cannot fire on a merely loaded provider — only on one that has stopped
 * answering.
 */
const EMBED_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Total time one batch may spend across ALL of its attempts.
 *
 * A per-request timeout alone is not a bound: five timed-out attempts plus their
 * backoff still add up to two and a half minutes, and the retry budget above was
 * sized for a provider that recovers in ~3 seconds, not for one that is gone.
 * When a batch has spent this long the provider is not blipping, and further
 * attempts only delay an answer the caller needs now.
 */
const EMBED_BATCH_DEADLINE_MS = 75_000;

/** Provider failures worth retrying: the connection or the runner, not the request. */
function isTransient(status: number, detail: string): boolean {
  if (status === 429 || status >= 500) return true;
  // Ollama reports runner/socket trouble as 400 with a transport message inside.
  return /dial tcp|connectex|connection|socket|EOF|timeout|timed out|refused|reset/i.test(detail);
}

export class OllamaEmbedder implements Embedder {
  constructor(
    private readonly baseUrl: string,
    readonly model = 'nomic-embed-text:latest',
    readonly version = 'v1',
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly maxBatch = MAX_EMBED_BATCH,
    /** Injectable so tests exercise the retry path without real delays. */
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly attempts = EMBED_ATTEMPTS,
    private readonly requestTimeoutMs = EMBED_REQUEST_TIMEOUT_MS,
    private readonly batchDeadlineMs = EMBED_BATCH_DEADLINE_MS,
    /** Injectable so the deadline can be tested without waiting for it. */
    private readonly now: () => number = () => Date.now(),
  ) {}

  /** Splits into bounded requests; `result[i]` still corresponds to `texts[i]`. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length <= this.maxBatch) return this.embedWithRetry(texts);
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += this.maxBatch) {
      out.push(...(await this.embedWithRetry(texts.slice(i, i + this.maxBatch))));
    }
    return out;
  }

  /**
   * One batch, retried through transient provider failures with backoff.
   *
   * A permanent failure (a real bad request, a missing model) is thrown on the
   * FIRST attempt — retrying it would only stretch a doomed sync out by seconds
   * per file. Only {@link isTransient} failures are given another chance.
   */
  private async embedWithRetry(texts: string[]): Promise<number[][]> {
    let last: Error | undefined;
    const deadline = this.now() + this.batchDeadlineMs;
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      try {
        /*
         * CLAMPED TO WHAT IS LEFT, or the deadline is not the bound it claims.
         *
         * Checked only BETWEEN attempts, a 75 s deadline still permits a final
         * 30 s attempt that starts at 61 s — a 92 s worst case under a constant
         * that says 75. An attempt is given the smaller of its own timeout and
         * the remaining budget, so the number in the constant is the number an
         * operator actually gets.
         */
        const remaining = deadline - this.now();
        return await this.embedBatch(texts, Math.max(1, Math.min(this.requestTimeoutMs, remaining)));
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
        // A thrown fetch (connection refused/reset) is transient by nature; an
        // HTTP failure is only retried when the provider says so.
        const retryable = !(last instanceof EmbedderHttpError) || isTransient(last.status, last.message);
        if (!retryable || attempt === this.attempts - 1) throw last;
        /*
         * Stop on the DEADLINE, and say that is why.
         *
         * Reported as its own error rather than re-throwing the last transport
         * message, because "provider stopped answering for 75 seconds" and "one
         * request was reset" call for different operator responses, and the
         * retry budget was sized for the second.
         */
        if (this.now() >= deadline) {
          throw new Error(
            `embedder gave up after ${attempt + 1} attempts in ${this.batchDeadlineMs}ms; last: ${last.message}`,
          );
        }
        await this.sleep(500 * 2 ** attempt); // 0.5s, 1s, 2s, 4s
      }
    }
    throw last ?? new Error('embedder failed');
  }

  private async embedBatch(texts: string[], timeoutMs = this.requestTimeoutMs): Promise<number[][]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
        body: JSON.stringify({ model: this.model, input: texts }),
        // The bound that was missing. A provider that accepts the connection and
        // then says nothing is abandoned here instead of waiting out undici's
        // ~300 s default — see EMBED_REQUEST_TIMEOUT_MS.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      /*
       * Name the timeout, rather than letting a bare `DOMException:
       * TimeoutError` reach `stats.lastError`.
       *
       * It also makes the retry decision deliberate: the word `timeout` is what
       * {@link isTransient} looks for, so a stalled provider is retried because
       * this says so, not because an unrecognised error happened to fall through
       * to the retryable branch.
       */
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error(`embedder timed out after ${timeoutMs}ms with no response`);
      }
      throw error;
    }
    if (!res.ok) throw new EmbedderHttpError(res.status, `embedder HTTP ${res.status}${await providerDetail(res)}`);
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const out = (data.data ?? []).map((d) => d.embedding);
    if (out.length !== texts.length) throw new Error('embedder returned wrong count');
    return out;
  }
}

/** Carries the status so the retry decision does not have to parse a message. */
class EmbedderHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'EmbedderHttpError';
  }
}

/**
 * The provider's own error text, appended to the thrown message.
 *
 * `embedder HTTP 400` alone cost a full diagnosis cycle — the status says nothing
 * about which limit was hit. ONLY the provider's `error.message` field is taken:
 * the raw body can echo the submitted text, and this message reaches operator
 * diagnostics, so indexed source must never ride along.
 */
async function providerDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } | string };
    const msg = typeof body.error === 'string' ? body.error : body.error?.message;
    return msg ? ` — ${msg.slice(0, 160)}` : '';
  } catch {
    return '';
  }
}

/** Durable-cache hook, keyed by (model, version, contentHash) so an embedding
 * from one model/version is never reused for another. */
export interface EmbeddingCacheStore {
  getEmbedding(model: string, version: string, contentHash: string): Promise<number[] | undefined>;
  putEmbedding(model: string, version: string, contentHash: string, vector: number[]): Promise<void>;
}

/** Wraps an embedder with an in-memory content-hash cache, optionally backed by a
 * durable store so unchanged content is not re-embedded across restarts. */
export class CachedEmbedder implements Embedder {
  readonly model: string;
  readonly version: string;
  private readonly cache = new Map<string, number[]>();

  constructor(private readonly inner: Embedder, private readonly max = 20000, private readonly persistence?: EmbeddingCacheStore) {
    this.model = inner.model;
    this.version = inner.version;
  }

  cacheSize(): number {
    return this.cache.size;
  }

  /**
   * Embed a batch, serving what the caches already know.
   *
   * Results are collected into a LOCAL array, never re-read from the cache at the
   * end. Reading back through the cache silently returned `undefined` once the
   * index outgrew {@link max}: a text whose vector was a cache HIT early in the
   * batch could be evicted by the misses put later in the SAME call, and the
   * `cache.get(k)!` assertion turned that hole into an `undefined` vector that
   * flowed into a chunk and blew up downstream as "Cannot read properties of
   * undefined (reading 'length')" — after ten minutes of embedding, discarding the
   * whole index. This repository chunks into ~36,000 pieces against a 20,000-entry
   * cache, so it was unreachable only while indexing was broken outright.
   */
  async embed(texts: string[]): Promise<number[][]> {
    const keys = texts.map((t) => hashText(t));
    const out = new Array<number[] | undefined>(texts.length);
    /** Key → every position awaiting it, so a repeated text is embedded once. */
    const wanted = new Map<string, number[]>();

    for (let i = 0; i < texts.length; i += 1) {
      const key = keys[i]!;
      // Durable cache: (model, version, hash) — never cross model/version.
      // Awaited: the durable store's embedding accessors became Promise-returning.
      // Un-awaited, a Promise object is truthy and would have been stored and
      // returned AS an embedding vector, corrupting the index.
      const hit = this.cache.get(key) ?? (await this.persistence?.getEmbedding(this.model, this.version, key));
      if (hit) {
        this.put(key, hit);
        out[i] = hit;
        continue;
      }
      const positions = wanted.get(key);
      if (positions) positions.push(i);
      else wanted.set(key, [i]);
    }

    if (wanted.size) {
      const missKeys = [...wanted.keys()];
      const fresh = await this.inner.embed(missKeys.map((k) => texts[wanted.get(k)![0]!]!));
      // Durable writes are collected and awaited together: concurrent rather than
      // serialized, but still observed — an unobserved rejection here would lose
      // cache entries silently and surface as an unhandled rejection.
      const persisted: Promise<void>[] = [];
      for (let j = 0; j < missKeys.length; j += 1) {
        const key = missKeys[j]!;
        const vector = fresh[j]!;
        for (const i of wanted.get(key)!) out[i] = vector;
        this.put(key, vector);
        const write = this.persistence?.putEmbedding(this.model, this.version, key, vector);
        if (write) persisted.push(write);
      }
      await Promise.all(persisted);
    }

    // Fail loudly rather than let a hole reach an indexed chunk.
    const hole = out.findIndex((v) => v === undefined);
    if (hole !== -1) throw new Error(`embedder produced no vector for input ${hole}`);
    return out as number[][];
  }

  private put(key: string, vec: number[]): void {
    this.cache.set(key, vec);
    if (this.cache.size > this.max) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
  }
}

/** Deterministic embedder for tests — a small char/token-frequency vector. No
 * network; identical text → identical vector (so cache + similarity are testable). */
export class FakeEmbedder implements Embedder {
  readonly model = 'fake-embed';
  readonly version = 'v0';
  constructor(private readonly dims = 64) {}
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array(this.dims).fill(0);
      const toks = t.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
      for (const tok of toks) {
        let h = 0;
        for (let i = 0; i < tok.length; i += 1) h = (h * 31 + tok.charCodeAt(i)) >>> 0;
        v[h % this.dims] += 1;
      }
      return v;
    });
  }
}

export function hashText(t: string): string {
  return createHash('sha1').update(t).digest('hex').slice(0, 16);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i += 1) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
