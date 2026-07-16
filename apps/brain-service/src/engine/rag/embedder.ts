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

export class OllamaEmbedder implements Embedder {
  constructor(
    private readonly baseUrl: string,
    readonly model = 'nomic-embed-text:latest',
    readonly version = 'v1',
    private readonly apiKey?: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`embedder HTTP ${res.status}`);
    const data = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    const out = (data.data ?? []).map((d) => d.embedding);
    if (out.length !== texts.length) throw new Error('embedder returned wrong count');
    return out;
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

  async embed(texts: string[]): Promise<number[][]> {
    const keys = texts.map((t) => hashText(t));
    const missIdx: number[] = [];
    const missTexts: string[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      const key = keys[i]!;
      if (this.cache.has(key)) continue;
      // Durable cache: (model, version, hash) — never cross model/version.
      const persisted = this.persistence?.getEmbedding(this.model, this.version, key);
      if (persisted) { this.cache.set(key, persisted); continue; }
      missIdx.push(i);
      missTexts.push(texts[i]!);
    }
    if (missTexts.length) {
      const fresh = await this.inner.embed(missTexts);
      for (let j = 0; j < missIdx.length; j += 1) {
        const key = keys[missIdx[j]!]!;
        this.put(key, fresh[j]!);
        this.persistence?.putEmbedding(this.model, this.version, key, fresh[j]!);
      }
    }
    return keys.map((k) => this.cache.get(k)!);
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
