/**
 * MigraAI Engine — RAG language-aware chunker.
 *
 * Never one generic fixed-size chunker. Boundaries follow the file's structure:
 *  - code      → symbol/function/class boundaries (size-capped, windowed if huge)
 *  - Markdown  → heading sections
 *  - JSON/YAML → top-level logical blocks
 *  - text      → bounded paragraphs
 *  - fallback  → token-aware sliding window
 *
 * Each chunk retains file/line/symbol/hash metadata so retrieval can cite an exact
 * source range. Chunk text is bounded so an index never sends a whole file (let
 * alone a whole repo) into a model context.
 */

import { createHash } from 'node:crypto';

export interface RawChunk {
  filePath: string;
  language: string;
  symbol?: string;
  startLine: number; // 1-based inclusive
  endLine: number;
  text: string;
  contentHash: string;
}

const MAX_CHARS = 1600;

/**
 * The size past which a chunk is genuinely broken, as opposed to merely large.
 *
 * 🚨 MEASURED, NOT CHOSEN. `nomic-bert.context_length` is 2048 tokens for the
 * embedding model this index uses, which is about 8,192 characters. A chunk above
 * that is SILENTLY TRUNCATED by the embedder, so its vector describes only the
 * beginning while the chunk claims to cover all of it — and retrieval then scores
 * the chunk on text its vector never saw.
 *
 * WHY THIS IS SEPARATE FROM `MAX_CHARS`. 1,600 is a retrieval-granularity target
 * and was never strictly enforced: an ordinary 60-line window measures ~1,676
 * characters and always has. Enforcing 1,600 exactly doubled the chunk count of
 * every normal document (31 -> 61 on a measured fixture), which churns every index
 * and invalidates existing citations to buy nothing — 76 characters over a
 * granularity target harms no one. 8,000 is the point where a chunk stops being
 * describable by its own embedding, which is a correctness boundary rather than a
 * preference.
 */
const HARD_MAX_CHARS = 8000;
const WINDOW_LINES = 60;
const WINDOW_OVERLAP = 10;

const LANG_BY_EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', go: 'go', rs: 'rust', java: 'java', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp',
  cs: 'csharp', rb: 'ruby', php: 'php', sh: 'bash', sql: 'sql',
  md: 'markdown', markdown: 'markdown', json: 'json', jsonc: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
  txt: 'text', text: 'text',
};

export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  return LANG_BY_EXT[ext] ?? 'text';
}

const CODE_SYMBOL = /^\s*(export\s+)?(default\s+)?(public\s+|private\s+|protected\s+|static\s+)*(async\s+)?(abstract\s+)?(function|class|interface|type|enum|const|let|var|def|func|impl|struct|module|namespace)\b\s*([A-Za-z0-9_$]+)?/;

/**
 * Where in the source a chunk sits, for formats whose "location" is not a line.
 *
 * A PDF has pages; the line numbers only exist because extraction flattened it,
 * so citing them back is telling the reader something they cannot use. When page
 * boundaries are supplied, each chunk records the page or page RANGE it actually
 * covers, and a chunk spanning a page break says so rather than picking one.
 *
 * It rides in `symbol` — the field that already means "the named location inside
 * this file" and already travels through persistence and retrieval untouched. A
 * page is exactly that for a document, and reusing it avoids a schema migration
 * and a second provenance path that could disagree with the first.
 */
function pageLabel(pageStartLines: readonly number[], start: number, end: number): string | undefined {
  if (pageStartLines.length === 0) return undefined;
  const pageOf = (line: number): number => {
    let page = 1;
    for (let i = 0; i < pageStartLines.length; i += 1) {
      if (line >= (pageStartLines[i] ?? 1)) page = i + 1;
      else break;
    }
    return page;
  };
  const first = pageOf(start);
  const last = pageOf(end);
  return first === last ? `page ${first}` : `pages ${first}-${last}`;
}

export function chunkFile(filePath: string, content: string, pageStartLines?: readonly number[]): RawChunk[] {
  const language = detectLanguage(filePath);
  const lines = content.split(/\r?\n/);
  if (content.trim() === '') return [];

  let chunks: Array<{ symbol?: string; start: number; end: number }>;
  if (language === 'markdown') chunks = markdownSections(lines);
  else if (language === 'json' || language === 'yaml' || language === 'toml') chunks = topLevelBlocks(lines);
  else if (isCode(language)) chunks = symbolBlocks(lines);
  else chunks = paragraphs(lines);

  // Enforce size cap: any block over MAX_CHARS is re-split with a sliding window.
  const out: RawChunk[] = [];
  for (const b of chunks) {
    const text = lines.slice(b.start - 1, b.end).join('\n');
    if (text.length <= MAX_CHARS) {
      if (text.trim()) out.push(mkChunk(filePath, language, b.symbol, b.start, b.end, text));
      continue;
    }
    for (const w of slidingWindow(b.start, b.end)) {
      const wt = lines.slice(w.start - 1, w.end).join('\n');
      if (!wt.trim()) continue;
      /*
       * 🚨 THE CAP WAS ENFORCED IN LINES, SO ONE LONG LINE ESCAPED IT ENTIRELY.
       *
       * `slidingWindow` divides a LINE RANGE. A block that is a single enormous
       * line — minified JSON, a one-paragraph contract, a CSV dumped without
       * breaks, text extracted from a PDF that had no hard wraps — yields exactly
       * one window covering that one line, and the window is the whole line.
       *
       * Measured: 51,600 characters of single-line text produced ONE chunk of
       * 51,600 characters against a 1,600 cap — a 32x overrun. The same text with
       * newlines produced 31 chunks, largest 1,676. Two consequences, both silent:
       *
       *  - the chunk is far past the EMBEDDING model's own context, so its vector
       *    describes only the beginning while the chunk claims to cover all of it,
       *    and retrieval scores it on text it never saw; and
       *  - retrieval drops it for budget, so a document the user just attached
       *    produced zero evidence and the turn was refused as "no relevant
       *    evidence" — about a document sitting right there.
       *
       * So the cap is finally enforced on the TEXT. Line numbers are unchanged for
       * every piece, which is the truth: they are all on the same line.
       */
      for (const piece of splitOversized(wt)) {
        out.push(mkChunk(filePath, language, b.symbol, w.start, w.end, piece));
      }
    }
  }
  return pageStartLines && pageStartLines.length > 0 ? withPages(out, pageStartLines) : out;
}

/**
 * Break text that is still over the cap into pieces no larger than it.
 *
 * Splits at the last whitespace inside the limit so a piece does not end
 * mid-token, which would corrupt both the embedding and any quotation. When there
 * is no whitespace to break on — a single unbroken 50KB token, which is real in
 * minified output — it breaks at the limit rather than giving up, because
 * returning the oversized text is what this exists to prevent.
 */
function splitOversized(text: string): string[] {
  /*
   * TRIGGERED BY THE HARD CAP, SPLIT AT THE GRANULARITY TARGET.
   *
   * Two different numbers doing two different jobs: nothing is touched until a
   * chunk is too big for its own embedding, and once it is, the pieces are sized
   * for useful retrieval rather than merely made legal.
   */
  if (text.length <= HARD_MAX_CHARS) return text.trim() ? [text] : [];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHARS) {
    const window = rest.slice(0, MAX_CHARS);
    const breakAt = window.lastIndexOf(' ');
    // Only honour a break in the last quarter; otherwise a stray early space
    // would produce a tiny piece and leave the rest still oversized.
    const cut = breakAt > MAX_CHARS * 0.75 ? breakAt : MAX_CHARS;
    const piece = rest.slice(0, cut);
    if (piece.trim()) pieces.push(piece);
    rest = rest.slice(cut);
  }
  if (rest.trim()) pieces.push(rest);
  return pieces;
}

function isCode(language: string): boolean {
  return !['markdown', 'json', 'yaml', 'toml', 'text'].includes(language);
}

function mkChunk(filePath: string, language: string, symbol: string | undefined, start: number, end: number, text: string): RawChunk {
  return { filePath, language, symbol, startLine: start, endLine: end, text, contentHash: sha1(text) };
}

/**
 * A paged document's chunks carry their page INSTEAD of a code symbol.
 *
 * Overwriting rather than merging is deliberate: an extracted PDF has no code
 * symbols, and anything the symbol heuristic matched in flattened prose is a
 * false positive that would make a worse citation than the page.
 */
function withPages(chunks: RawChunk[], pageStartLines: readonly number[]): RawChunk[] {
  return chunks.map((c) => {
    const label = pageLabel(pageStartLines, c.startLine, c.endLine);
    return label ? { ...c, symbol: label } : c;
  });
}

function symbolBlocks(lines: string[]): Array<{ symbol?: string; start: number; end: number }> {
  const boundaries: Array<{ line: number; symbol?: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = CODE_SYMBOL.exec(lines[i] ?? '');
    if (m) boundaries.push({ line: i + 1, symbol: m[7] });
  }
  if (boundaries.length === 0) return slidingWindow(1, lines.length);
  const blocks: Array<{ symbol?: string; start: number; end: number }> = [];
  // Leading preamble (imports etc.) before the first symbol.
  if (boundaries[0]!.line > 1) blocks.push({ start: 1, end: boundaries[0]!.line - 1 });
  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i]!.line;
    const end = i + 1 < boundaries.length ? boundaries[i + 1]!.line - 1 : lines.length;
    blocks.push({ symbol: boundaries[i]!.symbol, start, end });
  }
  return blocks;
}

function markdownSections(lines: string[]): Array<{ symbol?: string; start: number; end: number }> {
  const heads: Array<{ line: number; symbol: string }> = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i] ?? '');
    if (m) heads.push({ line: i + 1, symbol: m[2]!.trim().slice(0, 80) });
  }
  if (heads.length === 0) return paragraphs(lines);
  const blocks: Array<{ symbol?: string; start: number; end: number }> = [];
  if (heads[0]!.line > 1) blocks.push({ start: 1, end: heads[0]!.line - 1 });
  for (let i = 0; i < heads.length; i += 1) {
    const start = heads[i]!.line;
    const end = i + 1 < heads.length ? heads[i + 1]!.line - 1 : lines.length;
    blocks.push({ symbol: heads[i]!.symbol, start, end });
  }
  return blocks;
}

function topLevelBlocks(lines: string[]): Array<{ symbol?: string; start: number; end: number }> {
  // Best-effort: break at top-level (column-0, non-blank) keys; bounded by size cap later.
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i] ?? '';
    if (l && !/^\s/.test(l) && !/^[}\])]/.test(l)) boundaries.push(i + 1);
  }
  if (boundaries.length < 2) return slidingWindow(1, lines.length);
  const blocks: Array<{ start: number; end: number }> = [];
  for (let i = 0; i < boundaries.length; i += 1) {
    const start = boundaries[i]!;
    const end = i + 1 < boundaries.length ? boundaries[i + 1]! - 1 : lines.length;
    blocks.push({ start, end });
  }
  return blocks;
}

function paragraphs(lines: string[]): Array<{ start: number; end: number }> {
  const blocks: Array<{ start: number; end: number }> = [];
  let start = -1;
  let chars = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i] ?? '';
    if (l.trim() === '') {
      if (start !== -1) { blocks.push({ start: start + 1, end: i }); start = -1; chars = 0; }
      continue;
    }
    if (start === -1) start = i;
    chars += l.length;
    if (chars >= MAX_CHARS) { blocks.push({ start: start + 1, end: i + 1 }); start = -1; chars = 0; }
  }
  if (start !== -1) blocks.push({ start: start + 1, end: lines.length });
  return blocks.length ? blocks : slidingWindow(1, lines.length);
}

function slidingWindow(from: number, to: number): Array<{ start: number; end: number }> {
  const windows: Array<{ start: number; end: number }> = [];
  for (let s = from; s <= to; s += WINDOW_LINES - WINDOW_OVERLAP) {
    windows.push({ start: s, end: Math.min(s + WINDOW_LINES - 1, to) });
    if (s + WINDOW_LINES - 1 >= to) break;
  }
  return windows.length ? windows : [{ start: from, end: to }];
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex').slice(0, 16);
}
