import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  WorkspaceSearchRequestSchema,
  type WorkspaceSearchRequest,
  type WorkspaceSearchResponse,
} from '@migrapilot/protocol';

type Match = WorkspaceSearchResponse['matches'][number];

// Hard bounds. A workspace can contain a huge and/or binary tree (e.g. a
// checked-in browser cache with tens of thousands of files). Without bounds a
// naive read-every-file walk pins a CPU and blocks the event loop, which makes
// the WHOLE runner unresponsive — every unrelated request then times out as
// `local_runner_unavailable`. These caps guarantee search returns promptly (with
// truthful partial results) and never starves the event loop.
const SEARCH_TIMEOUT_MS = 12_000;
const RG_MAX_BUFFER = 16 * 1024 * 1024;

// Heavy / non-source directory segments always pruned so a big tree (deps, build
// output, checked-in browser caches) never dominates the walk. Unioned with the
// caller's excludeGlobs. These are directory NAMES matched anywhere in the path.
const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  '.next', '.turbo', '.venv', 'venv', 'target', 'vendor', '.cache',
  // Chromium/Electron browser-profile caches (e.g. Lighthouse runs checked into
  // the tree) — thousands of binary files, never source.
  'Cache_Data', 'Code Cache', 'GPUCache', 'ShaderCache', 'DawnCache',
  'DawnGraphiteCache', 'DawnWebGPUCache', 'GrShaderCache',
];
const DEFAULT_IGNORED_DIRS = new Set(DEFAULT_EXCLUDE_DIRS);

// Non-canonical trees excluded by DEFAULT so grounding/agent answers describe the
// CURRENT code, not an archived/backup/legacy copy. A repo like this one carries
// dozens of duplicate copies (e.g. `.archived-20260123/…`, `backups/…`,
// `*-legacy`), plus Windows `Zone.Identifier` download-marker junk — searching
// them makes an assistant cite stale files as if they were live. Glob patterns
// (not just dir names) so `.archived-<date>` and `*legacy*` are covered.
const DEFAULT_EXCLUDE_GLOBS = [
  '**/.archived*/**',
  '**/.archive/**',
  '**/backups/**',
  '**/backup/**',
  '**/*-legacy/**',
  '**/*legacy*/**',
  '**/.tmp*/**',
  '**/tmp/**',
  '**/prod-patches/**',
  '**/.trash/**',
  '**/.old/**',
  '**/*.Zone.Identifier',
  '**/*Zone.Identifier',
  // Generated evaluation output / run logs — a model's own recorded runs must
  // never pollute its own search (it would "find" its past queries as evidence).
  '**/eval/results/**',
  '**/*-acceptance.json',
  '**/*-evidence*.json',
];
const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip files larger than 2 MiB
const BINARY_SNIFF_BYTES = 8_192; // prefix read to detect binary content
const MAX_FILES_SCANNED = 20_000; // fallback: files opened for content
const MAX_DIRS_VISITED = 50_000; // fallback: directories descended into
const YIELD_EVERY = 256; // fallback: yield to the event loop every N files

/**
 * Content search backed by ripgrep when available — the same engine editor
 * assistants use. ripgrep is fast, respects `.gitignore`, auto-detects and skips
 * binary files, and is naturally bounded, so a giant/binary tree can never hang
 * the runner or hide real matches. Returns `null` when `rg` is unavailable or
 * fails to start so the caller can fall back to the bounded JS walk.
 */
async function ripgrepSearch(req: WorkspaceSearchRequest): Promise<Match[] | null> {
  const args = [
    '--json',
    '--fixed-strings',
    '--ignore-case',
    '--hidden', // search .github/.vscode/… (rg always still skips the .git dir)
    // This repo (and others) may use an allowlist `.gitignore` that ignores the
    // whole working tree. A code assistant must search the ACTUAL working-tree
    // files, so VCS ignore rules must not silence the search. Binary detection
    // and our explicit excludes still keep it bounded.
    '--no-ignore-vcs',
    '--max-columns', '4000',
    '--max-filesize', '2M',
    '--max-count', String(req.limit), // per-file cap; global cap applied below
  ];
  for (const dir of DEFAULT_EXCLUDE_DIRS) args.push('-g', `!**/${dir}/**`);
  for (const g of DEFAULT_EXCLUDE_GLOBS) args.push('-g', `!${g}`);
  for (const g of req.excludeGlobs) args.push('-g', `!${g}`);
  for (const g of req.includeGlobs) args.push('-g', g);
  args.push('--', req.query, '.');

  return await new Promise<Match[] | null>((resolve) => {
    execFile(
      'rg',
      args,
      { cwd: req.rootPath, timeout: SEARCH_TIMEOUT_MS, maxBuffer: RG_MAX_BUFFER },
      (err, stdout) => {
        // ENOENT → rg not installed; fall back. Exit code 1 = "no matches" (not an
        // error). On timeout/other errors we still parse whatever stdout arrived
        // so the result is a truthful partial rather than a lie or a crash.
        const e = err as (NodeJS.ErrnoException & { code?: string | number }) | null;
        if (e && e.code === 'ENOENT') return resolve(null);
        resolve(parseRgJson(stdout ?? '', req.limit));
      },
    );
  });
}

/** Parse ripgrep `--json` line stream into bounded matches. */
function parseRgJson(stdout: string, limit: number): Match[] {
  const matches: Match[] = [];
  for (const raw of stdout.split('\n')) {
    if (matches.length >= limit) break;
    if (!raw) continue;
    let evt: {
      type?: string;
      data?: {
        path?: { text?: string };
        line_number?: number;
        lines?: { text?: string };
      };
    };
    try {
      evt = JSON.parse(raw);
    } catch {
      continue;
    }
    if (evt.type !== 'match' || !evt.data) continue;
    const rel = (evt.data.path?.text ?? '').replace(/^\.[\\/]/, '').replace(/\\/g, '/');
    const line = evt.data.line_number ?? 0;
    if (!rel || line < 1) continue;
    matches.push({
      path: rel,
      line,
      preview: (evt.data.lines?.text ?? '').replace(/\r?\n$/, '').trim().slice(0, 400),
    });
  }
  return matches;
}

/** Convert a glob (`**`, `*`, `?`) into an anchored RegExp over POSIX paths. */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i += 1;
        if (glob[i + 1] === '/') i += 1; // `**/` also matches zero segments
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp('^' + re + '$');
}

/** A prefix read that never returns text if the file looks binary (has a NUL). */
function readTextIfSmallAndText(absPath: string): string | null {
  let fd: number | null = null;
  try {
    const stat = fs.statSync(absPath);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    if (stat.size === 0) return '';
    fd = fs.openSync(absPath, 'r');
    const sniff = Buffer.allocUnsafe(Math.min(BINARY_SNIFF_BYTES, stat.size));
    const read = fs.readSync(fd, sniff, 0, sniff.length, 0);
    if (sniff.subarray(0, read).includes(0)) return null; // NUL byte → binary
    return fs.readFileSync(fd, 'utf8');
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* already closed */
      }
    }
  }
}

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

/** Bounded, event-loop-safe fallback used only when ripgrep is unavailable. */
async function fallbackWalkSearch(req: WorkspaceSearchRequest): Promise<Match[]> {
  const needle = req.query.toLowerCase();
  const excludes = [...req.excludeGlobs, ...DEFAULT_EXCLUDE_GLOBS].map(globToRegExp);
  const includes = req.includeGlobs.map(globToRegExp);
  const matches: Match[] = [];

  const rel = (abs: string): string =>
    path.relative(req.rootPath, abs).replace(/\\/g, '/');
  const excluded = (relPath: string): boolean => excludes.some((rx) => rx.test(relPath));
  const included = (relPath: string): boolean =>
    includes.length === 0 || includes.some((rx) => rx.test(relPath));

  const deadline = Date.now() + SEARCH_TIMEOUT_MS;
  let filesScanned = 0;
  let dirsVisited = 0;

  const stack: string[] = [req.rootPath];
  while (stack.length > 0) {
    if (matches.length >= req.limit) break;
    if (filesScanned >= MAX_FILES_SCANNED || dirsVisited >= MAX_DIRS_VISITED) break;
    if (Date.now() > deadline) break;

    const dir = stack.pop()!;
    dirsVisited += 1;

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (matches.length >= req.limit) break;
      const fullPath = path.join(dir, entry.name);
      const relPath = rel(fullPath);

      if (entry.isDirectory()) {
        if (DEFAULT_IGNORED_DIRS.has(entry.name)) continue;
        if (excluded(`${relPath}/x`)) continue; // prune excluded subtrees
        stack.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (excluded(relPath) || !included(relPath)) continue;
      if (filesScanned >= MAX_FILES_SCANNED || Date.now() > deadline) break;

      filesScanned += 1;
      if (filesScanned % YIELD_EVERY === 0) await yieldToEventLoop();

      const text = readTextIfSmallAndText(fullPath);
      if (text === null) continue;

      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? '';
        if (line.toLowerCase().includes(needle)) {
          matches.push({ path: relPath, line: index + 1, preview: line.trim().slice(0, 400) });
          if (matches.length >= req.limit) break;
        }
      }
    }
  }
  return matches;
}

export async function workspaceSearch(
  input: WorkspaceSearchRequest,
): Promise<WorkspaceSearchResponse> {
  const req = WorkspaceSearchRequestSchema.parse(input);
  const viaRg = await ripgrepSearch(req);
  const matches = viaRg ?? (await fallbackWalkSearch(req));
  return { tool: 'workspace.search', matches };
}
