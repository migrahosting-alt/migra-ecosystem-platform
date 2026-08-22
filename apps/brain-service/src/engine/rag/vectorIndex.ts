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

  /**
   * Chunks per file, for the APPROVED content.
   *
   * A library-wide "searchable" boolean cannot answer "can this file be read?", and the UI
   * was claiming "Ready — MigraPilot can read this" for a whitespace-only file that produced
   * ZERO chunks. Readiness is a per-file fact, so the index has to report it per file.
   */
  chunkCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const [filePath, list] of this.byFile.entries()) counts[filePath] = list.length;
    return counts;
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

  /**
   * Size estimate. Defensive about `vector` because this ran AFTER the durable
   * commit and threw on an undefined one, converting a committed sync into a
   * reported failure. It is now called before the commit, and it also refuses to
   * be the thing that fails: a missing vector contributes nothing rather than
   * throwing. Vector VALIDITY is enforced at the persistence boundary, not here.
   */
  approxBytes(): number {
    let n = 0;
    for (const list of this.byFile.values()) for (const c of list) n += c.text.length + (c.vector?.length ?? 0) * 8;
    return n;
  }

  /** Top-K by cosine similarity across all chunks. */
  /**
   * Nearest chunks, optionally restricted to a set of files.
   *
   * THE SCOPE IS APPLIED BEFORE RANKING, not after. Taking top-K across the whole index
   * and filtering the survivors silently loses recall: a conversation grounded in one
   * small file would be out-scored by every other document the user owns, and the answer
   * would come back "your indexed documents do not cover that" for a file that was right
   * there. Measured exactly that way in production before this existed.
   */
  search(queryVec: number[], topK: number, files?: ReadonlySet<string>): SearchHit[] {
    const hits: SearchHit[] = [];
    for (const [filePath, list] of this.byFile.entries()) {
      if (files && !files.has(filePath)) continue;
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
