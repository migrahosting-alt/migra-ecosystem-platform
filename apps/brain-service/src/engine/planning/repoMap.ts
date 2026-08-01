/**
 * MigraAI Engine — the compact repository map.
 *
 * The measured defect this exists to remove: a correct small-scope answer cost 305s
 * across 8 model calls, 99% of it inference, with `brainTransport.ts` read four
 * times and context growing 1,906 → 8,704 units. The loop was paying a model to
 * rediscover, by trial and error, facts that are cheap and deterministic to compute
 * once — which files exist, what they export, what they import, which are tests or
 * generated or archived.
 *
 * So compute them once. Over the whole 2,899-file repository this map costs ~76ms
 * to build (git enumeration 6ms, stat 11ms, source scan 59ms) and is cached by HEAD
 * plus a working-tree fingerprint, so the second question pays nothing.
 *
 * What the map deliberately does NOT contain is file CONTENT. It is a routing
 * structure for deciding what to open; evidence still comes from real reads
 * recorded in the ledger, and no claim may ever rest on the map alone.
 *
 * Enumeration is `git ls-files`, never a filesystem walk: this repository's
 * `.gitignore` is a hard allowlist, so the tracked set IS the governed material.
 * © MigraTeck LLC.
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** How a file is likely to be used, for ranking and for exclusion. */
export type FileRole = 'source' | 'test' | 'config' | 'doc' | 'asset' | 'generated' | 'archive';

export interface RepoMapEntry {
  /** Workspace-relative, forward slashes. */
  path: string;
  ext: string;
  role: FileRole;
  sizeBytes: number;
  /** Newline count; 0 when the file was not scanned (asset/oversize). */
  lineCount: number;
  /** Exported identifiers, when cheaply extractable. */
  exports: string[];
  /** Module specifiers this file imports, relative ones resolved to tracked paths. */
  imports: string[];
  /** Nearest owning package name, from the closest `package.json`. */
  packageName?: string;
  /** Why this looks like an entry point, when it does. */
  entryPoint?: string;
}

export interface RepoMap {
  root: string;
  /** `git rev-parse HEAD`, or `''` outside a repository. */
  head: string;
  /** Hash of `git status --porcelain` — a dirty tree invalidates the cache. */
  dirtyFingerprint: string;
  entries: RepoMapEntry[];
  /** Index by path for O(1) lookup. */
  byPath: Map<string, RepoMapEntry>;
  builtInMs: number;
  /** True when this map came from the cache rather than a fresh build. */
  fromCache: boolean;
  /** Present when enumeration could not use git and the map is empty. */
  unavailable?: string;
}

/** Files bigger than this are indexed by name only — scanning them earns nothing. */
const MAX_SCAN_BYTES = 512 * 1024;

const SOURCE_EXT = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'py', 'go', 'rs', 'rb', 'java', 'kt', 'cs', 'php', 'sh', 'bash']);
const CONFIG_EXT = new Set(['json', 'jsonc', 'yml', 'yaml', 'toml', 'ini', 'conf', 'env', 'lock', 'xml', 'prisma', 'sql']);
const DOC_EXT = new Set(['md', 'mdx', 'txt', 'rst', 'adoc']);

/**
 * Paths that are real but must not be ranked as evidence for how the code behaves.
 *
 * Deliberately the same conservative shape the lexical retriever already uses —
 * `-starter`, backups, archives, `-old`/`-copy` — plus build output and generated
 * clients. NOT `template`/`example`/`sample`, which name real source here.
 */
const ARCHIVE_PATH = /(?:^|\/)(?:\.archived?[^/]*|archives?|backups?|\.backups?|\.trash|\.old)\//i;
const ARCHIVE_NAME = /(?:[-_](?:starter|backup|bak|orig|deprecated)|[-_]old|[-_]copy)(?:[-_/.]|$)/i;
const GENERATED_PATH = /(?:^|\/)(?:dist|build|out|coverage|generated|node_modules|\.next|\.turbo|\.vscode-test)\//i;
const GENERATED_NAME = /\.(?:generated|min|d)\.[a-z]+$/i;
const TEST_PATH = /(?:^|\/)(?:tests?|__tests__|spec|e2e)\//i;
const TEST_NAME = /\.(?:test|spec)\.[a-z]+$/i;

/** Filenames that make a file an entry point, and the reason to record. */
const ENTRY_NAMES: Array<[RegExp, string]> = [
  [/(?:^|\/)server\.[cm]?[jt]sx?$/, 'server entry'],
  [/(?:^|\/)main\.[cm]?[jt]sx?$/, 'main entry'],
  [/(?:^|\/)index\.[cm]?[jt]sx?$/, 'module index'],
  [/(?:^|\/)extension\.[cm]?[jt]sx?$/, 'vscode extension entry'],
  [/(?:^|\/)app\.[cm]?[jt]sx?$/, 'app entry'],
  [/(?:^|\/)cli\.[cm]?[jt]sx?$/, 'cli entry'],
  [/(?:^|\/)package\.json$/, 'package manifest'],
];

const EXPORT_RE =
  /^[ \t]*export[ \t]+(?:default[ \t]+)?(?:async[ \t]+)?(?:abstract[ \t]+)?(?:class|function|const|let|var|interface|type|enum)[ \t]+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST_RE = /^[ \t]*export[ \t]*\{([^}]{1,400})\}/gm;
const IMPORT_RE = /(?:^|\n)[ \t]*(?:import|export)[^'"\n]*from[ \t]*['"]([^'"\n]+)['"]/g;
const REQUIRE_RE = /require\([ \t]*['"]([^'"\n]+)['"][ \t]*\)/g;

export function classifyRole(rel: string, ext: string): FileRole {
  if (GENERATED_PATH.test(rel) || GENERATED_NAME.test(rel)) return 'generated';
  if (ARCHIVE_PATH.test(rel) || ARCHIVE_NAME.test(path.basename(rel))) return 'archive';
  if (TEST_PATH.test(rel) || TEST_NAME.test(rel)) return 'test';
  if (SOURCE_EXT.has(ext)) return 'source';
  if (CONFIG_EXT.has(ext)) return 'config';
  if (DOC_EXT.has(ext)) return 'doc';
  return 'asset';
}

function entryPointOf(rel: string): string | undefined {
  for (const [re, why] of ENTRY_NAMES) if (re.test(rel)) return why;
  return undefined;
}

/** Resolve a relative import specifier to a tracked path, when one exists. */
function resolveImport(fromRel: string, spec: string, tracked: Set<string>): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec));
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`];
  // `.js` specifiers in ESM TypeScript point at the `.ts` source.
  if (base.endsWith('.js')) candidates.push(base.replace(/\.js$/, '.ts'), base.replace(/\.js$/, '.tsx'));
  for (const c of candidates) if (tracked.has(c)) return c;
  return undefined;
}

/** Owning package for a path — the nearest ancestor directory with a manifest. */
function ownerIndex(root: string, tracked: string[]): Array<{ dir: string; name: string }> {
  const owners: Array<{ dir: string; name: string }> = [];
  for (const rel of tracked) {
    if (path.posix.basename(rel) !== 'package.json') continue;
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as { name?: string };
      if (typeof pkg.name === 'string' && pkg.name) owners.push({ dir, name: pkg.name });
    } catch {
      /* an unreadable manifest simply owns nothing */
    }
  }
  // Longest directory first, so the NEAREST manifest wins.
  return owners.sort((a, b) => b.dir.length - a.dir.length);
}

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd: root, maxBuffer: 1 << 28 });
  return stdout;
}

export interface RepoMapCacheKey {
  root: string;
  head: string;
  dirtyFingerprint: string;
}

/**
 * Cache of built maps.
 *
 * Bounded, and keyed by repository identity AND state: a map is only reused when
 * HEAD and the working-tree fingerprint both match, so an answer can never be
 * planned against a tree that has since changed.
 */
const CACHE = new Map<string, RepoMap>();
const CACHE_LIMIT = 8;

export function cacheKeyOf(k: RepoMapCacheKey): string {
  return `${k.root}::${k.head}::${k.dirtyFingerprint}`;
}

/** Clear the cache — for tests, and for an operator forcing a rebuild. */
export function clearRepoMapCache(): void {
  CACHE.clear();
}

export interface BuildRepoMapOptions {
  /** Skip the cache and rebuild. */
  force?: boolean;
}

/**
 * Build (or reuse) the map for a workspace.
 *
 * Never throws: a directory that is not a git repository yields an EMPTY map with
 * `unavailable` set, and the caller falls back to exploration rather than planning
 * against a map it silently invented.
 */
export async function buildRepoMap(root: string, opts: BuildRepoMapOptions = {}): Promise<RepoMap> {
  const started = Date.now();
  const realRoot = (() => {
    try {
      return fs.realpathSync(root);
    } catch {
      return root;
    }
  })();

  let head = '';
  let dirtyFingerprint = '';
  let tracked: string[];
  try {
    head = (await git(realRoot, ['rev-parse', 'HEAD'])).trim();
    const porcelain = await git(realRoot, ['status', '--porcelain']);
    dirtyFingerprint = createHash('sha256').update(porcelain).digest('hex').slice(0, 16);
    tracked = (await git(realRoot, ['ls-files', '-z'])).split('\0').filter(Boolean);
  } catch (err) {
    return {
      root: realRoot,
      head: '',
      dirtyFingerprint: '',
      entries: [],
      byPath: new Map(),
      builtInMs: Date.now() - started,
      fromCache: false,
      unavailable: err instanceof Error ? err.message : String(err),
    };
  }

  const key = cacheKeyOf({ root: realRoot, head, dirtyFingerprint });
  if (!opts.force) {
    const hit = CACHE.get(key);
    if (hit) return { ...hit, fromCache: true, builtInMs: Date.now() - started };
  }

  const trackedSet = new Set(tracked);
  const owners = ownerIndex(realRoot, tracked);
  const entries: RepoMapEntry[] = [];

  for (const rel of tracked) {
    const ext = (rel.split('.').pop() ?? '').toLowerCase();
    const role = classifyRole(rel, ext);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(path.join(realRoot, rel)).size;
    } catch {
      continue; // tracked but absent from the working tree
    }
    const entry: RepoMapEntry = { path: rel, ext, role, sizeBytes, lineCount: 0, exports: [], imports: [] };
    const owner = owners.find((o) => (o.dir === '' ? true : rel.startsWith(o.dir + '/')));
    if (owner) entry.packageName = owner.name;
    const entryWhy = entryPointOf(rel);
    if (entryWhy) entry.entryPoint = entryWhy;

    // Scan only what a scan can answer: source files, of a sane size, that are not
    // build output. Everything else is indexed by name and left alone.
    if ((role === 'source' || role === 'test') && sizeBytes <= MAX_SCAN_BYTES) {
      try {
        const text = fs.readFileSync(path.join(realRoot, rel), 'utf8');
        entry.lineCount = countLines(text);
        const exportNames = new Set<string>();
        for (const m of text.matchAll(EXPORT_RE)) exportNames.add(m[1]!);
        for (const m of text.matchAll(EXPORT_LIST_RE)) {
          for (const piece of m[1]!.split(',')) {
            const name = piece.trim().split(/\s+as\s+/)[0]?.trim().replace(/^type\s+/, '');
            if (name && /^[A-Za-z_$][\w$]*$/.test(name)) exportNames.add(name);
          }
        }
        entry.exports = [...exportNames].slice(0, 64);
        const specs = new Set<string>();
        for (const m of text.matchAll(IMPORT_RE)) specs.add(m[1]!);
        for (const m of text.matchAll(REQUIRE_RE)) specs.add(m[1]!);
        entry.imports = [...specs].map((s) => resolveImport(rel, s, trackedSet) ?? s).slice(0, 64);
      } catch {
        /* unreadable file: keep the name-level entry */
      }
    }
    entries.push(entry);
  }

  const map: RepoMap = {
    root: realRoot,
    head,
    dirtyFingerprint,
    entries,
    byPath: new Map(entries.map((e) => [e.path, e])),
    builtInMs: Date.now() - started,
    fromCache: false,
  };
  if (CACHE.size >= CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value as string);
  CACHE.set(key, map);
  return map;
}

function countLines(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) n += 1;
  return n;
}

/**
 * A short, model-readable digest of the map.
 *
 * Sent INSTEAD of a growing transcript so the model knows the shape of the
 * repository without the loop having to prove it one tool call at a time. Bounded
 * by line count, and it carries no file content — a claim can never rest on it.
 */
export function describeCandidates(entries: RepoMapEntry[], limit = 24): string {
  return entries
    .slice(0, limit)
    .map((e) => {
      const exports = e.exports.length ? ` exports: ${e.exports.slice(0, 8).join(', ')}` : '';
      const pkg = e.packageName ? ` [${e.packageName}]` : '';
      const entry = e.entryPoint ? ` (${e.entryPoint})` : '';
      return `- ${e.path} — ${e.role}, ${e.lineCount || '?'} lines${pkg}${entry}${exports}`;
    })
    .join('\n');
}
