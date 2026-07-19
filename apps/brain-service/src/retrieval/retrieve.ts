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

// Common question/filler words that carry no retrieval signal.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'what', 'why',
  'how', 'does', 'did', 'are', 'was', 'were', 'has', 'have', 'had', 'can',
  'could', 'should', 'would', 'repo', 'repository', 'code', 'codebase', 'file',
  'files', 'function', 'functions', 'class', 'method', 'explain', 'tell', 'show',
  'about', 'inside', 'used', 'use', 'uses', 'using', 'work', 'works', 'working',
  'handle', 'handled', 'handles', 'implement', 'implemented', 'where', 'when',
  'which', 'here', 'there', 'get', 'set', 'from', 'into', 'your', 'our',
]);

/** Pull distinctive, searchable tokens out of a natural-language query. Prefers
 * identifiers (camelCase / snake_case / dotted / PascalCase), filenames, and
 * longer words over generic prose. */
function salientTerms(query: string): string[] {
  const raw = query.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[\w-]+\.[A-Za-z0-9]{1,6}|[A-Za-z_$][\w$]{2,}/g) ?? [];
  const seen = new Set<string>();
  const scored: Array<{ term: string; weight: number }> = [];
  for (const tok of raw) {
    const term = tok.trim();
    const low = term.toLowerCase();
    if (term.length < 3 || seen.has(low) || STOPWORDS.has(low)) continue;
    seen.add(low);
    const distinctive =
      (/[A-Z]/.test(term) && /[a-z]/.test(term)) || /[._/\d]/.test(term) || term.length >= 8;
    scored.push({ term, weight: distinctive ? 2 : 1 });
  }
  scored.sort((a, b) => b.weight - a.weight || b.term.length - a.term.length);
  return scored.slice(0, MAX_TERMS).map((s) => s.term);
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
  const terms = salientTerms(input.query ?? '');
  if (terms.length > 0) {
    // Aggregate hits per file so a file matched by several terms ranks highest.
    const perFile = new Map<string, { lines: Set<number>; termHits: number }>();
    for (const term of terms) {
      let matches: Array<{ path: string; line: number }> = [];
      try {
        const res = await workspaceSearch({
          rootPath: input.workspaceRoot,
          query: term,
          limit: PER_TERM_LIMIT,
          includeGlobs: [],
          excludeGlobs: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**'],
        });
        matches = res.matches;
      } catch {
        continue; // best-effort per term
      }
      const filesThisTerm = new Set<string>();
      for (const m of matches) {
        const entry = perFile.get(m.path) ?? { lines: new Set<number>(), termHits: 0 };
        entry.lines.add(m.line);
        if (!filesThisTerm.has(m.path)) {
          entry.termHits += 1;
          filesThisTerm.add(m.path);
        }
        perFile.set(m.path, entry);
      }
    }

    // Rank: more distinct terms matched first, then source files over data files.
    const ranked = [...perFile.entries()].sort((a, b) => {
      if (b[1].termHits !== a[1].termHits) return b[1].termHits - a[1].termHits;
      return sourceRank(a[0]) - sourceRank(b[0]);
    });

    const alreadyHave = new Set(chunks.map((c) => c.path));
    for (const [relPath, info] of ranked) {
      if (chunks.length >= maxChunks) break;
      if (alreadyHave.has(path.resolve(input.workspaceRoot, relPath))) continue;
      const line = [...info.lines].sort((a, b) => a - b)[0]!;
      const chunk = await readWindow(input.workspaceRoot, relPath, line, info.termHits, terms.length);
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

/** Read a context window around a matched line. */
async function readWindow(
  workspaceRoot: string,
  relPath: string,
  line: number,
  termHits: number,
  totalTerms: number,
): Promise<RetrievedChunk | null> {
  try {
    const abs = path.resolve(workspaceRoot, relPath);
    const content = await fs.readFile(abs, 'utf8');
    const lines = content.split(/\r?\n/);
    const startLine = Math.max(1, line - CONTEXT_RADIUS);
    const endLine = Math.min(lines.length, line + CONTEXT_RADIUS);
    const snippet = lines.slice(startLine - 1, endLine).join('\n');
    return {
      path: abs,
      startLine,
      endLine,
      snippet,
      // Score reflects how many of the query's terms this file matched.
      score: Math.min(0.99, 0.5 + 0.5 * (termHits / Math.max(1, totalTerms))),
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
