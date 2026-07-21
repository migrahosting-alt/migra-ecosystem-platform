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
const PER_TERM_LIMIT = 24; // matches per term — enough that a common identifier's
// actual definition is in scope (not crowded out by references/schemas), so the
// definition-first ranking can promote the file that truly answers the question.
const DEFAULT_MAX_CHUNKS = 6;
// How far a definition may be followed before we give up and keep the radius —
// a bound on both cost and the damage a miscounted brace can do.
const MAX_DEFINITION_SPAN = 120;

/** Path markers for a NON-CANONICAL copy of code — a `-starter` scaffold, a
 * backup/archive, or a `-old`/`-copy`/`.bak`/`.orig`/`-deprecated` duplicate.
 * Files under these are deprioritized so grounding prefers the real source over
 * a duplicate (e.g. `migracms-enterprise/` over `Clients/migracms-enterprise-
 * starter/`). Deliberately conservative — NO `template`/`example`/`sample`,
 * which routinely name real source (email-template.ts, examples/). */
const COPY_PATH =
  /(?:[-_](?:starter|backup|bak|orig|deprecated))(?:[-_/.]|$)|[-_]old(?:[-_/.]|$)|[-_]copy(?:[-_/.]|$)|(?:^|\/)(?:backups?|archives?|\.backups?)\//i;

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

/** Paths that are never useful GROUNDING evidence: dependency/build output,
 * generated clients, and recorded eval runs. A generated Prisma client ranked
 * above real source in a live probe. */
// Post-filter for the filename-targeted pass. ripgrep applies globs in ORDER and
// the LAST match wins, so a filename include re-includes paths the exclude list
// already dropped (a node_modules eslint plugin came back that way). Filtering
// the results ourselves is order-independent.

const NOISE_PATH = /(?:^|\/)(?:node_modules|\.turbo|\.next|dist|build|coverage|generated|\.vscode-test)(?:\/|$)|\.log$|\.min\.[a-z]+$/i;

const RETRIEVAL_EXCLUDES = [
  '**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**',
  '**/eval/results/**', '**/results/**', '**/*-acceptance.json',
  '**/generated/**', '**/*.generated.*', '**/.next/**', '**/build/**',
];

export interface WeightedTerm {
  term: string;
  weight: number;
}

/** Raw weighted-token extraction from a single piece of text. */
function rawTerms(text: string): WeightedTerm[] {
  const raw = text.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+|[\w-]+\.[A-Za-z0-9]{1,6}|[A-Za-z_$][\w$]{2,}/g) ?? [];
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
  return scored;
}

/** Pull distinctive, searchable tokens out of a query, WEIGHTED so an identifier
 * ranks far above a leftover common word. When `conversationContext` is given,
 * IDENTIFIERS from prior turns are inherited (so a follow-up like "what ops does
 * it support?" still anchors on the earlier subject) — but ranked AFTER the
 * current query's own terms, and never generic words from history. */
/** Adjacent word pairs from the query, joined camelCase.
 *
 * People ask about "the changeset lint" but the code is named `changesetLint`.
 * Searching the words separately drowns in every eslint config in the tree,
 * while the joined identifier hits the one file that implements it. Cheap and
 * high-precision: a match on `changesetLint` is almost never a coincidence. */
export function camelCandidates(query: string): string[] {
  const words = (query.match(/[A-Za-z][A-Za-z0-9]{2,}/g) ?? []).filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const out: string[] = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    const a = words[i]!.toLowerCase();
    const b = words[i + 1]!;
    out.push(a + b.charAt(0).toUpperCase() + b.slice(1).toLowerCase());
  }
  return [...new Set(out)].slice(0, 4);
}

export function salientTermsWeighted(query: string, conversationContext = ''): WeightedTerm[] {
  const q = rawTerms(query);
  const have = new Set(q.map((t) => t.term.toLowerCase()));
  // Only inherit strong identifiers (weight 3) from history, deduped vs the query.
  const ctx = conversationContext
    ? rawTerms(conversationContext).filter((t) => t.weight >= 3 && !have.has(t.term.toLowerCase()))
    : [];
  // Stable sort by weight keeps query terms ahead of context terms at equal
  // weight (V8 sort is stable), while a context identifier (w3) still outranks a
  // generic query word (w1/w2) — exactly what a subject-less follow-up needs.
  const combined = [...q, ...ctx].sort((a, b) => b.weight - a.weight);
  return combined.slice(0, MAX_TERMS);
}

export async function retrieveContext(input: RetrieveRequest): Promise<RetrieveResponse> {
  const maxChunks = input.maxChunks && input.maxChunks > 0 ? input.maxChunks : DEFAULT_MAX_CHUNKS;
  const chunks: RetrievedChunk[] = [];

  // 1) The active file is the strongest recency signal — always include it.
  if (input.activeFile) {
    const active = await readActiveFileChunk(input.activeFile);
    if (active) chunks.push(active);
  }

  // 2) Lexical search of the working tree for the query's salient terms — plus
  // any subject identifier inherited from the conversation so follow-ups anchor.
  const terms = salientTermsWeighted(input.query ?? '', input.conversationContext ?? '');
  const topWeight = terms[0]?.weight ?? 0;
  if (terms.length > 0) {
    // Aggregate per file: WEIGHTED score (sum of matched-term weights) + the best
    // "distinctive" term that hit it (so we can put its definition in the snippet).
    const perFile = new Map<string, { lines: Set<number>; score: number; bestTerm: string; bestWeight: number; hitPrimary: boolean }>();
    // The PRIMARY term is the question's subject (highest weight, earliest in the
    // query). A verbose question ("locate MigraCMS … its path, package name,
    // routes, README or architecture documentation") otherwise lets generic
    // filler words outvote it: files matching README/architecture/documentation
    // crowded out the ONE thing actually asked about. Files that match the
    // primary term get a decisive bonus so the SUBJECT dominates grounding.
    const primaryTerm = terms[0]?.term;
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
          excludeGlobs: RETRIEVAL_EXCLUDES,
        });
        matches = res.matches;
      } catch {
        continue; // best-effort per term
      }
      const filesThisTerm = new Set<string>();
      for (const m of matches) {
        const entry = perFile.get(m.path) ?? { lines: new Set<number>(), score: 0, bestTerm: term, bestWeight: 0, hitPrimary: false };
        entry.lines.add(m.line);
        if (!filesThisTerm.has(m.path)) {
          entry.score += weight;
          filesThisTerm.add(m.path);
        }
        if (term === primaryTerm) entry.hitPrimary = true;
        if (weight > entry.bestWeight) { entry.bestWeight = weight; entry.bestTerm = term; }
        perFile.set(m.path, entry);
      }
    }

    // Direct DEFINITION search for the top identifier: a plain substring search
    // for a common name is saturated by schema/type/test files, so the actual
    // `function <name>` may never be returned. Searching the definition forms
    // finds the implementing file directly and pins it to the top.
    const ident = terms.find((t) => t.weight >= 3)?.term;
    if (ident) {
      const defQueries = [`function ${ident}`, `const ${ident}`, `class ${ident}`, `interface ${ident}`, `type ${ident}`];
      for (const q of defQueries) {
        try {
          const res = await workspaceSearch({
            rootPath: input.workspaceRoot, query: q, limit: 4, includeGlobs: [],
            excludeGlobs: RETRIEVAL_EXCLUDES,
          });
          for (const m of res.matches) {
            const entry = perFile.get(m.path) ?? { lines: new Set<number>(), score: 0, bestTerm: ident, bestWeight: 3, hitPrimary: ident === primaryTerm };
            entry.lines.add(m.line);
            entry.score += 8; // a real definition is the strongest possible signal
            entry.bestWeight = Math.max(entry.bestWeight, 3);
            if (ident === primaryTerm) entry.hitPrimary = true;
            perFile.set(m.path, entry);
          }
        } catch { /* best-effort */ }
      }
    }

    // FILENAME-TARGETED CANDIDATES. The per-term content search is capped at
    // PER_TERM_LIMIT and returns matches in traversal order, so in a large
    // monorepo the RIGHT file can be truncated away before scoring ever sees it
    // — no ranking can rescue a file that never became a candidate. Observed:
    // "what does the changeset lint check?" never surfaced changesetLint.ts,
    // because "changeset" and "lint" each matched 24 other files first.
    //
    // So search each term again, restricted to files whose PATH contains it.
    // Tiny result set, very high precision: a file named after the thing asked
    // about is almost always the thing that implements it.
    for (const term of [...terms.map((t) => t.term), ...camelCandidates(input.query ?? '')]) {
      if (term.length < 4) continue; // too generic to name a file usefully
      const capped = term.charAt(0).toUpperCase() + term.slice(1);
      try {
        const res = await workspaceSearch({
          rootPath: input.workspaceRoot,
          query: term,
          // Counts match LINES, not files: one chatty file ate an entire
          // 8-line budget in a live probe and hid every other candidate. The
          // glob already restricts this to a handful of files, so allow plenty.
          limit: 200,
          // Globs are case-sensitive; cover the two casings that actually name
          // files (`changesetLint.ts`, `ChangesetLint.ts`).
          includeGlobs: [`**/*${term}*`, `**/*${capped}*`],
          excludeGlobs: RETRIEVAL_EXCLUDES,
        });
        for (const m of res.matches) {
          if (NOISE_PATH.test(m.path)) continue;
          const entry = perFile.get(m.path) ?? { lines: new Set<number>(), score: 0, bestTerm: term, bestWeight: 1, hitPrimary: term === primaryTerm };
          entry.lines.add(m.line);
          entry.score += 7; // named after the subject — as strong as a definition hit
          if (term === primaryTerm) entry.hitPrimary = true;
          perFile.set(m.path, entry);
        }
      } catch { /* best-effort */ }
    }

    // Filename signal: a file NAMED after the identifier (workspaceSearch.ts for
    // `workspaceSearch`) almost always DEFINES it — a strong prior that lifts the
    // implementation above the many schema/type/test files sharing the substring.
    for (const [relPath, info] of perFile) {
      const base = path.basename(relPath).replace(/\.[^.]+$/, '').toLowerCase();
      const t = info.bestTerm.toLowerCase();
      if (base === t) info.score += 6;
      else if (base.includes(t) || t.includes(base)) info.score += 3;
      // The question's SUBJECT wins: a file that actually mentions the primary
      // term outranks one that merely matched generic filler ("README",
      // "architecture", "documentation") from the same sentence.
      if (info.hitPrimary) info.score += 8;
      // Deprioritize NON-CANONICAL copies: a `-starter`/template scaffold, a
      // backup/archive, a vendored or `.bak`/`-old` copy, or an extracted zip. In
      // a monorepo the same component often exists as both the real source AND a
      // client copy; the canonical source should ground the answer, not the copy
      // (a query for "MigraCMS" was landing on Clients/…-starter/ instead of the
      // real migracms-enterprise/).
      // Rank a copy a clear notch below its canonical twin (roughly a
      // definition-signal's worth) — but never so hard that a copy vanishes when
      // it is the only match (a copy still beats nothing).
      if (COPY_PATH.test(relPath)) info.score -= 7;
    }

    // Drop NOISE: when the query has a distinctive identifier (weight ≥ 3), keep
    // only files that a distinctive term actually hit. This removes files that
    // merely contain a leftover common word — the cause of grounding on noise.
    const entries = [...perFile.entries()];
    const filtered = topWeight >= 3 ? entries.filter(([, v]) => v.bestWeight >= 3) : entries;

    // Pre-rank by weighted score, then materialise the top candidates. Reading
    // the window tells us whether a file DEFINES the term (vs merely references
    // it) — the file with the definition is what actually answers the question,
    // so it is promoted above references and its snippet captures the body.
    const preRanked = filtered.sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score;
      return sourceRank(a[0]) - sourceRank(b[0]);
    });

    const alreadyHave = new Set(chunks.map((c) => c.path));
    const candidates: Array<{ chunk: RetrievedChunk; isDef: boolean; isTest: boolean; score: number; rank: number }> = [];
    for (const [relPath, info] of preRanked.slice(0, Math.max(maxChunks * 2, 8))) {
      if (alreadyHave.has(path.resolve(input.workspaceRoot, relPath))) continue;
      const built = await readWindow(input.workspaceRoot, relPath, [...info.lines], info.bestTerm, info.score, topWeight);
      if (built) candidates.push({ chunk: built.chunk, isDef: built.isDef, isTest: isTestFile(relPath), score: info.score, rank: sourceRank(relPath) });
    }
    // REAL source before test fixtures (a `function foo` inside a *.test.ts is
    // fixture data, not the answer to "what does foo do"), then definition-first,
    // then weighted score, then source-kind.
    candidates.sort((a, b) => {
      if (a.isTest !== b.isTest) return a.isTest ? 1 : -1;
      if (a.isDef !== b.isDef) return a.isDef ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return a.rank - b.rank;
    });
    for (const c of candidates) {
      if (chunks.length >= maxChunks) break;
      chunks.push(c.chunk);
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

/** Test/spec/fixture files — their inline code is fixture data, not the answer. */
function isTestFile(relPath: string): boolean {
  return /(\.(test|spec)\.[jt]sx?$)|(^|[\\/])(tests?|__tests__|__mocks__|fixtures?)[\\/]/i.test(relPath);
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
/** Last line of the definition that starts at `defLine` (1-based).
 *
 * A fixed radius truncates real symbols: `lintChangeset` runs past a 24-line
 * window, so the retrieved excerpt omitted its duplicate-definition check and
 * the answer was correct but INCOMPLETE. Following the braces instead means the
 * model sees the whole function.
 *
 * Brace counting is deliberately simple — it only has to find the end of a
 * definition, and an unbalanced count just falls back to the radius. Braces in
 * strings or comments can skew it, so the result is always clamped. */
export function definitionEndLine(lines: string[], defLine: number, maxSpan: number): number {
  let depth = 0;
  let opened = false;
  const limit = Math.min(lines.length, defLine + maxSpan);
  for (let i = defLine - 1; i < limit; i += 1) {
    for (const ch of lines[i] ?? '') {
      if (ch === '{') { depth += 1; opened = true; }
      else if (ch === '}') depth -= 1;
    }
    if (opened && depth <= 0) return i + 1;
  }
  return 0; // unbalanced or too long — caller keeps its default window
}

/** Python and friends have no closing brace: the definition ends at the next
 * non-empty line indented no further than the `def` itself. */
export function indentedBlockEndLine(lines: string[], defLine: number, maxSpan: number): number {
  const indentOf = (l: string): number => l.length - l.trimStart().length;
  const base = indentOf(lines[defLine - 1] ?? '');
  const limit = Math.min(lines.length, defLine + maxSpan);
  let lastInBlock = 0;
  for (let i = defLine; i < limit; i += 1) {
    const l = lines[i] ?? '';
    if (!l.trim()) continue; // blank lines belong to neither side
    if (indentOf(l) <= base) return lastInBlock; // dedent — the block ended above
    lastInBlock = i + 1; // 1-based, and never a trailing blank
  }
  return 0;
}

async function readWindow(
  workspaceRoot: string,
  relPath: string,
  candidateLines: number[],
  term: string,
  score: number,
  topWeight: number,
): Promise<{ chunk: RetrievedChunk; isDef: boolean } | null> {
  try {
    const abs = path.resolve(workspaceRoot, relPath);
    const content = await fs.readFile(abs, 'utf8');
    const lines = content.split(/\r?\n/);
    const esc = term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    // A DEFINITION, not a call: a declaration keyword followed by the term, OR
    // the term as an assignment/property target (`term:` / `term =`). Crucially
    // NOT `term(` — that is a call site (e.g. `registerInspectRoutes(app)`).
    const defRe = new RegExp(
      `\\b(function|class|interface|type|enum|def|func)\\s+${esc}\\b` +
        `|\\b(const|let|var)\\s+${esc}\\b` +
        `|\\bexport\\b[^\\n]*\\b(function|class|const|interface|type|enum)\\b[^\\n]*\\b${esc}\\b` +
        `|\\b${esc}\\s*[:=](?!=)`,
    );
    // Find the DEFINITION line. Prefer a matched line that is a definition; if the
    // returned matches are only references, scan the WHOLE file — the actual
    // definition may not have been among the (capped) match lines.
    const sorted = [...new Set(candidateLines)].sort((a, b) => a - b);
    let line = sorted[0]!;
    let isDef = false;
    for (const ln of sorted) {
      if (defRe.test(lines[ln - 1] ?? '')) { line = ln; isDef = true; break; }
    }
    if (!isDef) {
      for (let i = 0; i < lines.length; i += 1) {
        if (defRe.test(lines[i]!)) { line = i + 1; isDef = true; break; }
      }
    }
    // For a definition, bias the window to capture the BODY (what it actually
    // does) — a few lines above for the signature, more below for the impl.
    const startLine = Math.max(1, line - (isDef ? 3 : CONTEXT_RADIUS));
    // A definition is read to its END rather than cut at a fixed radius, so the
    // model sees the whole symbol it is being asked about.
    let endLine = Math.min(lines.length, line + (isDef ? CONTEXT_RADIUS * 3 : CONTEXT_RADIUS));
    if (isDef) {
      const indented = /\.(?:py|rb|yaml|yml)$/i.test(relPath);
      const found = indented
        ? indentedBlockEndLine(lines, line, MAX_DEFINITION_SPAN)
        : definitionEndLine(lines, line, MAX_DEFINITION_SPAN);
      if (found > endLine) endLine = Math.min(lines.length, found);
    }
    const snippet = lines.slice(startLine - 1, endLine).join('\n');
    return {
      isDef,
      chunk: {
        path: abs,
        startLine,
        endLine,
        snippet,
        // A definition scores highest; references/imports lower.
        score: Math.min(0.99, (isDef ? 0.85 : 0.55) + 0.03 * Math.min(score, 5) * (topWeight >= 3 ? 1 : 0.6)),
        source: 'grep',
      },
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
