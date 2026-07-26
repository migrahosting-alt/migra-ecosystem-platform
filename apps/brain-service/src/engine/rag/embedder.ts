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
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      try {
        return await this.embedBatch(texts);
      } catch (error) {
        last = error instanceof Error ? error : new Error(String(error));
        // A thrown fetch (connection refused/reset) is transient by nature; an
        // HTTP failure is only retried when the provider says so.
        const retryable = !(last instanceof EmbedderHttpError) || isTransient(last.status, last.message);
        if (!retryable || attempt === this.attempts - 1) throw last;
        await this.sleep(500 * 2 ** attempt); // 0.5s, 1s, 2s, 4s
      }
    }
    throw last ?? new Error('embedder failed');
  }

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
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
  getEmbedding(model: string, version: string, contentHash: string): number[] | undefined;
  putEmbedding(model: string, version: string, contentHash: string, vector: number[]): void;
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
      const hit = this.cache.get(key) ?? this.persistence?.getEmbedding(this.model, this.version, key);
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
      for (let j = 0; j < missKeys.length; j += 1) {
        const key = missKeys[j]!;
        const vector = fresh[j]!;
        for (const i of wanted.get(key)!) out[i] = vector;
        this.put(key, vector);
        this.persistence?.putEmbedding(this.model, this.version, key, vector);
      }
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
