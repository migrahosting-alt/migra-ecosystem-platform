/**
 * MigraAI Engine — per-workspace vector index.
 *
 * In-memory, versioned, workspace-scoped. Chunks are grouped by file so a changed
 * or deleted file atomically replaces/removes exactly its chunks (stale chunks are
 * invalidated). `clone()` supports staging: a full sync builds into a clone and the
 * IndexService swaps it in only on success, so a partial/failed run never replaces
 * the active index.
 */

import { cosine } from './embedder.js';

export interface IndexedChunk {
  id: string;
  workspaceId: string;
  filePath: string;
  language: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  embeddingModel: string;
  embeddingVersion: string;
  indexedAt: number;
  text: string;
  vector: number[];
}

export interface SearchHit {
  chunk: IndexedChunk;
  semantic: number;
}

export class VectorIndex {
  version = 1;
  private readonly byFile = new Map<string, IndexedChunk[]>();

  /** Replace all chunks for a file (atomic per file). */
  replaceFile(filePath: string, chunks: IndexedChunk[]): void {
    this.byFile.set(filePath, chunks);
    this.version += 1;
  }

  removeFile(filePath: string): boolean {
    const had = this.byFile.delete(filePath);
    if (had) this.version += 1;
    return had;
  }

  hasFile(filePath: string): boolean {
    return this.byFile.has(filePath);
  }

  files(): string[] {
    return [...this.byFile.keys()];
  }

  /** Content hashes currently indexed for a file (for incremental change detection). */
  fileHashes(filePath: string): Set<string> {
    return new Set((this.byFile.get(filePath) ?? []).map((c) => c.contentHash));
  }

  size(): number {
    let n = 0;
    for (const list of this.byFile.values()) n += list.length;
    return n;
  }

  approxBytes(): number {
    let n = 0;
    for (const list of this.byFile.values()) for (const c of list) n += c.text.length + c.vector.length * 8;
    return n;
  }

  /** Top-K by cosine similarity across all chunks. */
  search(queryVec: number[], topK: number): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const list of this.byFile.values()) {
      for (const chunk of list) hits.push({ chunk, semantic: cosine(queryVec, chunk.vector) });
    }
    hits.sort((a, b) => b.semantic - a.semantic);
    return hits.slice(0, topK);
  }

  /** All chunks (for lexical/hybrid scoring). */
  all(): IndexedChunk[] {
    const out: IndexedChunk[] = [];
    for (const list of this.byFile.values()) out.push(...list);
    return out;
  }

  /** Deep-ish clone for staging (chunks are immutable once built, so shallow-copy
   * the per-file arrays). */
  clone(): VectorIndex {
    const copy = new VectorIndex();
    copy.version = this.version;
    for (const [file, list] of this.byFile) copy.byFile.set(file, [...list]);
    return copy;
  }
}
