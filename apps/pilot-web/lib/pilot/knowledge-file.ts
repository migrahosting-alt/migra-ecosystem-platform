// MigraPilot — file-backed MemoryStorage (.pilot-data/*.json). DEFAULT backend.
// Local-first, no DB. Cosine similarity computed in JS. globalThis-cached.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Chunk, Embedding, MemoryStorage, SearchHit, Source } from "./types";

const REPO_ROOT = process.cwd();
const DATA_DIR = resolve(REPO_ROOT, ".pilot-data");
const SOURCES_FILE = resolve(DATA_DIR, "sources.json");
const CHUNKS_FILE = resolve(DATA_DIR, "chunks.json");
const EMB_FILE = resolve(DATA_DIR, "embeddings.json");

type FileKB = { sources: Source[]; chunks: Chunk[]; embeddings: Embedding[]; loaded: boolean };
const g = globalThis as unknown as { __migrapilotKnowledge?: FileKB };
const kb: FileKB =
  g.__migrapilotKnowledge ?? (g.__migrapilotKnowledge = { sources: [], chunks: [], embeddings: [], loaded: false });
kb.sources ??= [];
kb.chunks ??= [];
kb.embeddings ??= [];

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export const fileStorage: MemoryStorage = {
  async init() {
    if (kb.loaded) return;
    kb.sources = await readJson<Source[]>(SOURCES_FILE, []);
    kb.chunks = await readJson<Chunk[]>(CHUNKS_FILE, []);
    kb.embeddings = await readJson<Embedding[]>(EMB_FILE, []);
    kb.loaded = true;
  },

  async getStats() {
    const lastIngest = kb.sources.reduce<string | null>((acc, s) => (acc && acc > s.createdAt ? acc : s.createdAt), null);
    return { sourceCount: kb.sources.length, chunkCount: kb.chunks.length, lastIngest };
  },

  async listSources() {
    return [...kb.sources].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },

  async replaceSource(source: Source, chunks: Chunk[], embeddings: Embedding[]) {
    const prior = kb.sources.find((s) => s.path === source.path);
    if (prior) {
      const dropIds = new Set(kb.chunks.filter((c) => c.sourceId === prior.id).map((c) => c.id));
      kb.chunks = kb.chunks.filter((c) => c.sourceId !== prior.id);
      kb.embeddings = kb.embeddings.filter((e) => !dropIds.has(e.chunkId));
      kb.sources = kb.sources.filter((s) => s.id !== prior.id);
    }
    kb.sources.push(source);
    kb.chunks.push(...chunks);
    kb.embeddings.push(...embeddings);
  },

  async flush() {
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(SOURCES_FILE, JSON.stringify(kb.sources));
    await writeFile(CHUNKS_FILE, JSON.stringify(kb.chunks));
    await writeFile(EMB_FILE, JSON.stringify(kb.embeddings));
  },

  async deleteSourceByPath(path: string): Promise<boolean> {
    const prior = kb.sources.find((s) => s.path === path);
    if (!prior) return false;
    const dropIds = new Set(kb.chunks.filter((c) => c.sourceId === prior.id).map((c) => c.id));
    kb.chunks = kb.chunks.filter((c) => c.sourceId !== prior.id);
    kb.embeddings = kb.embeddings.filter((e) => !dropIds.has(e.chunkId));
    kb.sources = kb.sources.filter((s) => s.id !== prior.id);
    return true;
  },

  async searchVectors(qv: number[], k: number): Promise<SearchHit[]> {
    if (kb.embeddings.length === 0) return [];
    const chunkById = new Map(kb.chunks.map((c) => [c.id, c]));
    const sourceById = new Map(kb.sources.map((s) => [s.id, s]));
    return kb.embeddings
      .map((e) => {
        const chunk = chunkById.get(e.chunkId);
        if (!chunk) return null;
        const src = sourceById.get(chunk.sourceId);
        return {
          chunkId: chunk.id,
          sourceId: chunk.sourceId,
          title: src?.title ?? "(unknown)",
          path: src?.path ?? "(unknown)",
          score: cosine(qv, e.vector),
          snippet: chunk.text.replace(/\s+/g, " ").slice(0, 300),
        } satisfies SearchHit;
      })
      .filter((h): h is SearchHit => h !== null)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(k, 20)));
  },
};
