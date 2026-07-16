/**
 * MigraAI Engine — hybrid retriever.
 *
 * Baseline is semantic similarity fused with lexical/path/symbol/recency signals
 * — NO reranking model yet (a seam is provided; prove embeddings + hybrid first).
 * Results are deduped for overlap, fit to a chunk/token budget, and carry a
 * transparent per-chunk score breakdown ("why selected") — never hidden reasoning.
 * Every result cites its file + line range.
 */

import type { IndexedChunk, VectorIndex } from './vectorIndex.js';

export interface RetrievedRagChunk {
  filePath: string;
  language: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  snippet: string;
  score: number;
  why: { semantic: number; lexical: number; path: number; symbol: number; recency: number };
}

export interface RetrieveDiagnostics {
  candidatesConsidered: number;
  returned: number;
  deduped: number;
  omittedForBudget: number;
  estimatedTokens: number;
  reranked: boolean;
}

export interface Reranker {
  rerank(queryText: string, hits: RetrievedRagChunk[]): Promise<RetrievedRagChunk[]>;
}

export interface HybridOptions {
  topK?: number;
  maxChunks?: number;
  tokenBudget?: number;
  weights?: { semantic: number; lexical: number; path: number; symbol: number; recency: number };
  reranker?: Reranker;
}

const DEFAULT_WEIGHTS = { semantic: 0.6, lexical: 0.2, path: 0.1, symbol: 0.07, recency: 0.03 };

export async function hybridRetrieve(
  index: VectorIndex,
  queryVec: number[],
  queryText: string,
  opts: HybridOptions = {},
): Promise<{ chunks: RetrievedRagChunk[]; diagnostics: RetrieveDiagnostics }> {
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const topK = opts.topK ?? 40;
  const maxChunks = opts.maxChunks ?? 6;
  const tokenBudget = opts.tokenBudget ?? 2000;

  const terms = tokenize(queryText);
  const candidates = index.search(queryVec, topK);
  if (candidates.length === 0) {
    return { chunks: [], diagnostics: { candidatesConsidered: 0, returned: 0, deduped: 0, omittedForBudget: 0, estimatedTokens: 0, reranked: false } };
  }
  const now = Math.max(...candidates.map((c) => c.chunk.indexedAt));
  const oldest = Math.min(...candidates.map((c) => c.chunk.indexedAt));
  const span = Math.max(1, now - oldest);

  let scored: RetrievedRagChunk[] = candidates.map(({ chunk, semantic }) => {
    const lexical = lexicalScore(terms, chunk.text);
    const pathScore = lexicalScore(terms, chunk.filePath.replace(/[/_.-]/g, ' '));
    const symbolScore = chunk.symbol ? lexicalScore(terms, chunk.symbol) : 0;
    const recency = (chunk.indexedAt - oldest) / span;
    const total =
      weights.semantic * semantic + weights.lexical * lexical + weights.path * pathScore + weights.symbol * symbolScore + weights.recency * recency;
    return {
      filePath: chunk.filePath, language: chunk.language, symbol: chunk.symbol,
      startLine: chunk.startLine, endLine: chunk.endLine, snippet: chunk.text,
      score: Number(total.toFixed(4)),
      why: { semantic: r(semantic), lexical: r(lexical), path: r(pathScore), symbol: r(symbolScore), recency: r(recency) },
    };
  });

  scored.sort((a, b) => b.score - a.score);

  let reranked = false;
  if (opts.reranker) {
    scored = await opts.reranker.rerank(queryText, scored);
    reranked = true;
  }

  // Dedup overlapping ranges (same file, overlapping lines → keep the higher score).
  const deduped: RetrievedRagChunk[] = [];
  let dedupCount = 0;
  for (const c of scored) {
    const overlap = deduped.find((d) => d.filePath === c.filePath && rangesOverlap(d, c));
    if (overlap) { dedupCount += 1; continue; }
    deduped.push(c);
  }

  // Budget: bounded chunks + token budget. Never return a whole repo.
  const chunks: RetrievedRagChunk[] = [];
  let tokens = 0;
  let omitted = 0;
  for (const c of deduped) {
    if (chunks.length >= maxChunks) { omitted += 1; continue; }
    const cost = Math.ceil(c.snippet.length / 4);
    if (tokens + cost > tokenBudget) { omitted += 1; continue; }
    tokens += cost;
    chunks.push(c);
  }

  return {
    chunks,
    diagnostics: { candidatesConsidered: candidates.length, returned: chunks.length, deduped: dedupCount, omittedForBudget: omitted, estimatedTokens: tokens, reranked },
  };
}

function tokenize(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []))];
}

function lexicalScore(terms: string[], text: string): number {
  if (terms.length === 0) return 0;
  const lower = text.toLowerCase();
  let hit = 0;
  for (const t of terms) if (lower.includes(t)) hit += 1;
  return hit / terms.length;
}

function rangesOverlap(a: { startLine: number; endLine: number }, b: { startLine: number; endLine: number }): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

function r(n: number): number {
  return Number(n.toFixed(3));
}

/** Provide a chunk's citation string (file:line-range). */
export function citation(c: RetrievedRagChunk): string {
  return `${c.filePath}:${c.startLine}-${c.endLine}`;
}
