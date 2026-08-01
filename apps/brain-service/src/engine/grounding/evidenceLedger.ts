/**
 * MigraAI Engine — the evidence ledger for a single agentic answer run.
 *
 * The agentic loop already fed real tool output back to the model, but it kept no
 * record of WHAT was actually retrieved. Without that record a claim cannot be
 * checked: `path:line` in an answer was a formatting convention, not a verifiable
 * reference, and a model that named a file it never opened produced text that was
 * indistinguishable from a grounded one.
 *
 * This module records every span the run actually saw — the exact text, its file,
 * its line range, and a content hash — so a later pass can ask two different
 * questions and get honest answers to both:
 *
 *   1. "Does this citation point at something we really retrieved?"  → {@link resolve}
 *   2. "Does this term appear anywhere in what we retrieved?"        → {@link mentions}
 *
 * The distinction between a span (content we read) and a known path (a filename we
 * merely saw in a `find`/`list` result) is deliberate and load-bearing: a filename
 * alone is not evidence for behaviour.
 *
 * PURE: no fs, no fetch, no vscode. Everything is fed in by the caller, so every
 * rule is unit-testable without a running Brain or model. © MigraTeck LLC.
 */

import { createHash } from 'node:crypto';

/** Where a span came from. `read` is the strongest; `search` is a single line. */
export type EvidenceOrigin = 'read' | 'search' | 'seed';

/** One stretch of file content this run actually retrieved. */
export interface EvidenceSpan {
  /** Workspace-relative, forward slashes. Never absolute. */
  path: string;
  startLine: number;
  endLine: number;
  /** The literal text retrieved for this range. */
  text: string;
  /**
   * {@link text} with comments removed — what the file DOES.
   *
   * Split out because a comment is a claim about the code, not the code. A stale
   * "retries three times" header sitting above a function that retries nothing is
   * retrieved evidence for the sentence and terrible evidence for the behaviour,
   * and the verifier has to be able to tell those apart.
   */
  codeText: string;
  /** The comment text alone — supports documentation claims, never behaviour. */
  commentText: string;
  /** Stable content hash of {@link text} — proves the excerpt was not rewritten. */
  excerptHash: string;
  origin: EvidenceOrigin;
}

/** Extensions whose `#` starts a comment. `#` is a private field in JS/TS. */
const HASH_COMMENT_EXT = /\.(sh|bash|zsh|py|rb|ya?ml|toml|ini|env|conf)$/i;

/**
 * Separate executable text from commentary.
 *
 * Deliberately crude: it over-classifies rather than under-classifies, so a line
 * that might be a comment is treated as one and cannot prop up a behaviour claim.
 */
export function splitCodeAndComments(filePath: string, text: string): { code: string; comments: string } {
  const comments: string[] = [];
  const code: string[] = [];
  const hashComments = HASH_COMMENT_EXT.test(filePath);
  let inBlock = false;

  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    let codePart = '';
    while (line.length > 0) {
      if (inBlock) {
        const close = line.indexOf('*/');
        if (close === -1) {
          comments.push(line);
          line = '';
        } else {
          comments.push(line.slice(0, close));
          line = line.slice(close + 2);
          inBlock = false;
        }
        continue;
      }
      const open = line.indexOf('/*');
      // `//` only when it is not the `://` of a URL.
      const lineComment = line.search(/(?<!:)\/\//);
      const hash = hashComments ? line.indexOf('#') : -1;
      const first = [open, lineComment, hash].filter((n) => n >= 0).sort((a, b) => a - b)[0];
      if (first === undefined) {
        codePart += line;
        line = '';
        continue;
      }
      codePart += line.slice(0, first);
      if (first === open) {
        inBlock = true;
        line = line.slice(first + 2);
      } else {
        comments.push(line.slice(first));
        line = '';
      }
    }
    // A continuation line of a JSDoc block (` * text`) is commentary even when the
    // block markers landed in a different span.
    if (/^\s*\*(?!\/)/.test(rawLine) && !codePart.trim()) {
      comments.push(rawLine);
      code.push('');
    } else {
      code.push(codePart);
    }
  }
  return { code: code.join('\n'), comments: comments.join('\n') };
}

/** A reference parsed out of an answer: `path:line` or `path:start-end`. */
export interface CitationRef {
  path: string;
  startLine: number;
  endLine: number;
}

/** Normalise a path the way both a tool result and a model citation would write it. */
export function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

/**
 * Content hash for an excerpt.
 *
 * Trailing whitespace is stripped per line before hashing so an excerpt that
 * survived a round trip through JSON tool feedback still hashes to the same value;
 * nothing else is normalised, because indentation and case ARE the content.
 */
export function hashExcerpt(text: string): string {
  const normalized = text
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex').slice(0, 16);
}

/** Longest common file-extension set we treat as "a path token" in an answer. */
const PATHY = /^[\w.@/-]+$/;

/**
 * Language names and the file extensions that ARE them.
 *
 * A run that retrieved `entry.endsWith('.ts')` really is evidence that the code
 * scans TypeScript sources; refusing that sentence because the literal string
 * "TypeScript" is absent removes a true claim. These are facts about file
 * extensions, not about this repository, so the table stays small and generic.
 */
const TERM_ALIASES: Record<string, readonly string[]> = {
  typescript: ['.ts', '.tsx'],
  javascript: ['.js', '.mjs', '.cjs'],
  python: ['.py'],
  markdown: ['.md'],
  json: ['.json'],
  yaml: ['.yml', '.yaml'],
};

/**
 * Does `term` appear in an already-lower-cased body of retrieved text?
 *
 * The single place the alias table is applied, so the "is this term known at all"
 * check and the "is it in THIS source" check can never disagree — a term accepted
 * by one and rejected by the other produced a claim the gate could neither pass
 * nor explain.
 */
export function termAppearsIn(haystackLower: string, term: string): boolean {
  const t = term.trim().toLowerCase();
  if (!t) return false;
  if (haystackLower.includes(t)) return true;
  return (TERM_ALIASES[t] ?? []).some((alias) => haystackLower.includes(alias));
}

function makeSpan(path: string, startLine: number, endLine: number, text: string, origin: EvidenceOrigin): EvidenceSpan {
  const { code, comments } = splitCodeAndComments(path, text);
  return { path, startLine, endLine, text, codeText: code, commentText: comments, excerptHash: hashExcerpt(text), origin };
}

export class EvidenceLedger {
  private readonly spansByPath = new Map<string, EvidenceSpan[]>();
  private readonly paths = new Set<string>();
  /** Lower-cased concatenation of every span's text — the substring index. */
  private corpusLower = '';
  private corpusDirty = false;
  private readonly readCounts = new Map<string, number>();

  /** Record a `read` result: a real line range with its literal content. */
  recordRead(path: string, startLine: number, endLine: number, text: string): EvidenceSpan {
    const p = normalizePath(path);
    this.readCounts.set(p, (this.readCounts.get(p) ?? 0) + 1);
    return this.add(makeSpan(p, startLine, endLine, text, 'read'));
  }

  /** Record one `search` hit. A preview line is evidence for that line only. */
  recordSearchMatch(path: string, line: number, preview: string): EvidenceSpan {
    const p = normalizePath(path);
    return this.add(makeSpan(p, line, line, preview, 'search'));
  }

  /** Record a chunk from the deterministic seeding retriever. */
  recordSeed(path: string, startLine: number, endLine: number, snippet: string): EvidenceSpan {
    const p = normalizePath(path);
    return this.add(makeSpan(p, startLine, endLine, snippet, 'seed'));
  }

  /**
   * Note that a path EXISTS without recording any content for it.
   *
   * `find`, `list` and `git_status` prove a filename is real; they prove nothing
   * about what is inside it. Kept separate from spans so a claim can never be
   * supported by the mere existence of a file.
   */
  notePath(path: string): void {
    const p = normalizePath(path);
    if (p) this.paths.add(p);
  }

  private add(span: EvidenceSpan): EvidenceSpan {
    const list = this.spansByPath.get(span.path);
    if (list) list.push(span);
    else this.spansByPath.set(span.path, [span]);
    this.paths.add(span.path);
    this.corpusDirty = true;
    return span;
  }

  /** Every span recorded this run, in insertion order per file. */
  get spans(): EvidenceSpan[] {
    return [...this.spansByPath.values()].flat();
  }

  /** Files whose CONTENT was retrieved (not merely listed). */
  get readPaths(): string[] {
    return [...this.spansByPath.keys()];
  }

  /** Every path this run saw, including ones only listed or found. */
  get knownPaths(): string[] {
    return [...this.paths];
  }

  /** Files read more than once — a scope-efficiency signal for the timing report. */
  repeatedReads(): Array<{ path: string; count: number }> {
    return [...this.readCounts.entries()].filter(([, c]) => c > 1).map(([path, count]) => ({ path, count }));
  }

  get isEmpty(): boolean {
    return this.spansByPath.size === 0;
  }

  /** All retrieved text, lower-cased, for substring containment checks. */
  private corpus(): string {
    if (this.corpusDirty || !this.corpusLower) {
      this.corpusLower = this.spans.map((s) => s.text).join('\n').toLowerCase();
      this.corpusDirty = false;
    }
    return this.corpusLower;
  }

  /**
   * Does `term` appear in retrieved content?
   *
   * Case-INSENSITIVE on purpose. The question this answers is "was this term ever
   * in front of us", and a model that reproduces `brainTransport` as
   * `BrainTransport` has not fabricated anything. A term the run never retrieved is
   * absent in every casing, so the check still catches real fabrication.
   */
  mentions(term: string): boolean {
    const t = term.trim().toLowerCase();
    if (!t) return false;
    if (termAppearsIn(this.corpus(), t)) return true;
    // A path may be named in an answer by its basename, or with a leading segment
    // the tool result did not carry. Match against recorded paths both ways.
    if (PATHY.test(t)) {
      for (const p of this.paths) {
        const lower = p.toLowerCase();
        if (lower === t || lower.endsWith('/' + t) || t.endsWith('/' + lower)) return true;
      }
    }
    return false;
  }

  /** Does content for this exact file exist (as opposed to just the filename)? */
  hasContentFor(path: string): boolean {
    return this.spansByPath.has(normalizePath(path));
  }

  /** Does the run know this path at all (read, found or listed)? */
  knowsPath(path: string): boolean {
    const p = normalizePath(path);
    if (this.paths.has(p)) return true;
    for (const known of this.paths) {
      if (known.endsWith('/' + p) || p.endsWith('/' + known)) return true;
    }
    return false;
  }

  /** Every span recorded for a file, matched by exact path or by suffix. */
  spansFor(path: string): EvidenceSpan[] {
    const p = normalizePath(path);
    const exact = this.spansByPath.get(p);
    if (exact) return exact;
    const out: EvidenceSpan[] = [];
    for (const [known, spans] of this.spansByPath) {
      if (known.endsWith('/' + p) || p.endsWith('/' + known)) out.push(...spans);
    }
    return out;
  }

  /**
   * Resolve a citation to the spans that actually cover it.
   *
   * A citation resolves only when the run retrieved content for that file AND the
   * cited lines overlap a retrieved range. Citing line 400 of a file we read lines
   * 1–40 of does NOT resolve — the model would be pointing at text it never saw.
   */
  resolve(ref: CitationRef): EvidenceSpan[] {
    return this.spansFor(ref.path).filter((s) => ref.startLine <= s.endLine && ref.endLine >= s.startLine);
  }
}

/** Citation shapes an answer may use: `path:12`, `path:12-40`, `path:12–40`. */
const CITATION_RE = /(?<!\w)((?:[\w.@-]+\/)*[\w.@-]+\.[A-Za-z][\w]{0,7})\s*:\s*(\d{1,6})(?:\s*[-–—]\s*(\d{1,6}))?/g;

/** Parse every `path:line` / `path:start-end` reference out of a fragment. */
export function extractCitations(text: string): CitationRef[] {
  const out: CitationRef[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(CITATION_RE)) {
    const path = normalizePath(m[1]!);
    const startLine = Number(m[2]);
    const endLine = m[3] ? Number(m[3]) : startLine;
    if (!Number.isFinite(startLine) || startLine < 1) continue;
    const key = `${path}:${startLine}-${endLine}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ path, startLine, endLine: Math.max(startLine, endLine) });
  }
  return out;
}
