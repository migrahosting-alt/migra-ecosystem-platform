import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RetrieveRequest, RetrieveResponse, RetrievedChunk } from '@migrapilot/shared-types';
import { workspaceSearch } from '../tools/workspaceSearch.js';

// Lexical workspace grounding for chat turns that have no APPROVED semantic
// index. Without this the chat model answers repository questions from
// imagination ("registerInspectRoutes likely sets up debug routes…") instead of
// from the actual code. Here we search the working tree for the query's salient
// terms and return real code snippets the model must ground its answer on — the
// same evidence-first behaviour editor assistants provide. Bounded and
// best-effort: it must never slow down or fail a chat turn.

const TEXT_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.md', '.py',
  '.java', '.go', '.rs', '.sql', '.yaml', '.yml', '.sh', '.css', '.html',
]);
const CONTEXT_RADIUS = 8; // lines of context above/below a matched line
const MAX_TERMS = 4; // distinct query terms searched
const PER_TERM_LIMIT = 6; // matches requested per term
const DEFAULT_MAX_CHUNKS = 6;

// Question/filler/instruction words that carry no retrieval signal. Searching
// these (e.g. "cite", "file", "explain") pulls in unrelated files and drowns the
// real match, so a weak model then grounds on noise or hallucinates.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'what', 'whats',
  'why', 'how', 'does', 'did', 'are', 'was', 'were', 'has', 'have', 'had', 'can',
  'could', 'should', 'would', 'repo', 'repository', 'code', 'codebase', 'file',
  'files', 'function', 'functions', 'class', 'method', 'methods', 'explain',
  'tell', 'show', 'about', 'inside', 'used', 'use', 'uses', 'using', 'work',
  'works', 'working', 'handle', 'handled', 'handles', 'implement', 'implemented',
  'implementation', 'where', 'when', 'which', 'here', 'there', 'get', 'set',
  'from', 'into', 'your', 'our', 'its', 'do', 'doing', 'done', 'within',
  // instruction words users add ("...cite the file", "the actual name", …)
  'cite', 'cites', 'cited', 'citation', 'name', 'named', 'names', 'specific',
  'specifically', 'actual', 'actually', 'exactly', 'exact', 'purpose', 'mean',
  'means', 'responsible', 'related', 'various', 'kinds', 'kind', 'thing', 'things',
  'part', 'parts', 'stuff', 'please', 'need', 'want', 'give', 'find', 'look',
]);

export interface WeightedTerm {
  term: string;
  weight: number;
}

/** Pull distinctive, searchable tokens out of a natural-language query, WEIGHTED
 * so an identifier ranks far above a leftover common word. Identifiers
 * (camelCase / snake_case / dotted / PascalCase / filenames) are the strong
 * signal; a plain lowercase word is weak and only used if nothing better. */
export function salientTermsWeighted(query: string): WeightedTerm[] {
  const raw = query.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[\w-]+\.[A-Za-z0-9]{1,6}|[A-Za-z_$][\w$]{2,}/g) ?? [];
  const seen = new Set<string>();
  const scored: WeightedTerm[] = [];
  for (const tok of raw) {
    const term = tok.trim();
    const low = term.toLowerCase();
    if (term.length < 3 || seen.has(low) || STOPWORDS.has(low)) continue;
    seen.add(low);
    const isIdentifier =
      (/[a-z]/.test(term) && /[A-Z]/.test(term)) || // camelCase / PascalCase
      /[._/]/.test(term) || // dotted / path / filename
      /_/.test(term); // snake_case
    const weight = isIdentifier ? 3 : term.length >= 9 ? 2 : 1;
    scored.push({ term, weight });
  }
  scored.sort((a, b) => b.weight - a.weight || b.term.length - a.term.length);
  return scored.slice(0, MAX_TERMS);
}

export async function retrieveContext(input: RetrieveRequest): Promise<RetrieveResponse> {
  const maxChunks = input.maxChunks && input.maxChunks > 0 ? input.maxChunks : DEFAULT_MAX_CHUNKS;
  const chunks: RetrievedChunk[] = [];

  // 1) The active file is the strongest recency signal — always include it.
  if (input.activeFile) {
    const active = await readActiveFileChunk(input.activeFile);
    if (active) chunks.push(active);
  }

  // 2) Lexical search of the working tree for the query's salient terms.
  const terms = salientTermsWeighted(input.query ?? '');
  const topWeight = terms[0]?.weight ?? 0;
  if (terms.length > 0) {
    // Aggregate per file: WEIGHTED score (sum of matched-term weights) + the best
    // "distinctive" term that hit it (so we can put its definition in the snippet).
    const perFile = new Map<string, { lines: Set<number>; score: number; bestTerm: string; bestWeight: number }>();
    for (const { term, weight } of terms) {
      let matches: Array<{ path: string; line: number }> = [];
      try {
        const res = await workspaceSearch({
          rootPath: input.workspaceRoot,
          query: term,
          limit: PER_TERM_LIMIT,
          includeGlobs: [],
          // Exclude deps/build AND generated artifacts (eval output, results) so a
          // model's own recorded runs never pollute grounding evidence.
          excludeGlobs: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**', '**/eval/results/**', '**/results/**', '**/*-acceptance.json'],
        });
        matches = res.matches;
      } catch {
        continue; // best-effort per term
      }
      const filesThisTerm = new Set<string>();
      for (const m of matches) {
        const entry = perFile.get(m.path) ?? { lines: new Set<number>(), score: 0, bestTerm: term, bestWeight: 0 };
        entry.lines.add(m.line);
        if (!filesThisTerm.has(m.path)) {
          entry.score += weight;
          filesThisTerm.add(m.path);
        }
        if (weight > entry.bestWeight) { entry.bestWeight = weight; entry.bestTerm = term; }
        perFile.set(m.path, entry);
      }
    }

    // Drop NOISE: when the query has a distinctive identifier (weight ≥ 3), keep
    // only files that a distinctive term actually hit. This removes files that
    // merely contain a leftover common word — the cause of grounding on noise.
    const entries = [...perFile.entries()];
    const filtered = topWeight >= 3 ? entries.filter(([, v]) => v.bestWeight >= 3) : entries;

    // Rank: higher weighted score first, then source files over data/docs.
    const ranked = filtered.sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score;
      return sourceRank(a[0]) - sourceRank(b[0]);
    });

    const alreadyHave = new Set(chunks.map((c) => c.path));
    for (const [relPath, info] of ranked) {
      if (chunks.length >= maxChunks) break;
      if (alreadyHave.has(path.resolve(input.workspaceRoot, relPath))) continue;
      const chunk = await readWindow(input.workspaceRoot, relPath, [...info.lines], info.bestTerm, info.score, topWeight);
      if (chunk) {
        chunks.push(chunk);
        alreadyHave.add(chunk.path);
      }
    }
  }

  return {
    repoSummary: chunks.length
      ? `Lexical retrieval over ${path.basename(input.workspaceRoot)} (${chunks.length} snippet(s)).`
      : `No matching source found in ${path.basename(input.workspaceRoot)} for this query.`,
    chunks,
    tokenEstimate: chunks.reduce((n, c) => n + Math.ceil(c.snippet.length / 4), 0),
  };
}

/** Lower rank = preferred. Source code beats config/data/docs. */
function sourceRank(relPath: string): number {
  const ext = path.extname(relPath).toLowerCase();
  if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java'].includes(ext)) return 0;
  if (['.sql', '.sh', '.css', '.html'].includes(ext)) return 1;
  if (['.md'].includes(ext)) return 2;
  return 3; // .json / .yaml / other
}

/** Read a context window. Prefers the line where `term` is DEFINED (function /
 * const / class / export …) over a mere reference, so the snippet the model
 * grounds on actually shows what the symbol is — not an import line. */
async function readWindow(
  workspaceRoot: string,
  relPath: string,
  candidateLines: number[],
  term: string,
  score: number,
  topWeight: number,
): Promise<RetrievedChunk | null> {
  try {
    const abs = path.resolve(workspaceRoot, relPath);
    const content = await fs.readFile(abs, 'utf8');
    const lines = content.split(/\r?\n/);
    const esc = term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const defRe = new RegExp(
      `\\b(function|const|let|var|class|interface|type|enum|export|async|def|func)\\b[^\\n]*\\b${esc}\\b|\\b${esc}\\s*[:=(]`,
    );
    // Among the matched lines, prefer one that looks like a definition of `term`.
    const sorted = [...new Set(candidateLines)].sort((a, b) => a - b);
    let line = sorted[0]!;
    for (const ln of sorted) {
      if (defRe.test(lines[ln - 1] ?? '')) { line = ln; break; }
    }
    const startLine = Math.max(1, line - CONTEXT_RADIUS);
    const endLine = Math.min(lines.length, line + CONTEXT_RADIUS);
    const snippet = lines.slice(startLine - 1, endLine).join('\n');
    return {
      path: abs,
      startLine,
      endLine,
      snippet,
      // Score reflects the weighted match strength (distinctive terms dominate).
      score: Math.min(0.99, 0.5 + 0.1 * Math.min(score, 5) * (topWeight >= 3 ? 1 : 0.6)),
      source: 'grep',
    };
  } catch {
    return null;
  }
}

async function readActiveFileChunk(filePath: string): Promise<RetrievedChunk | null> {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      return null;
    }

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    const snippet = lines.slice(0, 40).join('\n');

    return {
      path: filePath,
      startLine: 1,
      endLine: Math.min(40, lines.length),
      snippet,
      score: 0.9,
      source: 'recent',
    };
  } catch {
    return null;
  }
}
