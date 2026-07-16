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

export function chunkFile(filePath: string, content: string): RawChunk[] {
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
      if (wt.trim()) out.push(mkChunk(filePath, language, b.symbol, w.start, w.end, wt));
    }
  }
  return out;
}

function isCode(language: string): boolean {
  return !['markdown', 'json', 'yaml', 'toml', 'text'].includes(language);
}

function mkChunk(filePath: string, language: string, symbol: string | undefined, start: number, end: number, text: string): RawChunk {
  return { filePath, language, symbol, startLine: start, endLine: end, text, contentHash: sha1(text) };
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
