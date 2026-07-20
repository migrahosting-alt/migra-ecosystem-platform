// Read-only workspace inspection (`POST /api/ai/inspect`).
//
// A MODEL-FREE, deterministic local-runner path for read-only workspace/repo
// inspection. It exists so the VS Code chat can answer "report the workspace
// root / list files / git status / …" with REAL command results instead of the
// conversational model falsely claiming it cannot access the local environment.
//
// Guarantees:
//  - READ-ONLY: never writes, never mutates, needs no approval token.
//  - Workspace-root CONTAINED: every path is realpath-checked to stay inside the
//    authorized rootPath (a `..`/symlink/absolute escape → scope_not_authorized).
//  - BOUNDED: listings/search are capped; git commands run with a hard timeout.
//  - TRUTHFUL TYPED ERRORS: workspace_not_open, scope_not_authorized,
//    tool_not_available, policy_denied, tool_execution_failed,
//    tool_execution_timed_out — each with a safe remediation hint. Never a
//    generic "AI cannot access local files" refusal.
//
// © MigraTeck LLC.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { workspaceSearch } from '../tools/workspaceSearch.js';
import { fileReadRange } from '../tools/fileReadRange.js';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const GIT_TIMEOUT_MS = 10_000;
const LIST_CAP = 500;

export type InspectErrorCode =
  | 'workspace_not_open'
  | 'scope_not_authorized'
  | 'tool_not_available'
  | 'policy_denied'
  | 'tool_execution_failed'
  | 'tool_execution_timed_out';

export const INSPECT_OPS = [
  'workspace_root',
  'list',
  'find', // filesystem name/path search (files + directories)
  'search', // content search (grep-like) — DISTINCT from `find`
  'read',
  'git_status',
  'git_branch',
  'git_head',
  'git_remotes',
  'pkg_manager',
] as const;
export type InspectOp = (typeof INSPECT_OPS)[number];

const InspectRequestSchema = z.object({
  rootPath: z.string(),
  op: z.enum(INSPECT_OPS),
  /** Relative sub-path (for `list`/`read`) — must stay inside rootPath. */
  path: z.string().optional(),
  /** Needle for `find` (name/path) or `search` (content). */
  query: z.string().optional(),
  /** `find` filter: only files, only directories, or any (default). */
  kind: z.enum(['file', 'dir', 'any']).optional(),
  limit: z.number().int().min(1).max(LIST_CAP).optional(),
  startLine: z.number().int().min(1).optional(),
  endLine: z.number().int().min(1).optional(),
});
export type InspectRequest = z.infer<typeof InspectRequestSchema>;

const REMEDIATION: Record<InspectErrorCode, string> = {
  workspace_not_open: 'Open a folder in VS Code (File → Open Folder), then retry.',
  scope_not_authorized: 'The path is outside the authorized workspace. Use a path inside the open workspace.',
  tool_not_available: 'This inspection operation is not supported by the local runner.',
  policy_denied: 'The active policy disables this operation. Adjust the MigraPilot policy to allow read-only inspection.',
  tool_execution_failed: 'The read-only command failed. See the message; the workspace was not modified.',
  tool_execution_timed_out: 'The read-only command exceeded its time budget and was aborted. Nothing was modified.',
};

class InspectError extends Error {
  constructor(readonly code: InspectErrorCode, message: string) {
    super(message);
    this.name = 'InspectError';
  }
}

/** Resolve rootPath to a real directory or fail with workspace_not_open. */
async function resolveRoot(rootPath: string): Promise<string> {
  const trimmed = (rootPath ?? '').trim();
  if (!trimmed) throw new InspectError('workspace_not_open', 'No workspace root was provided.');
  let real: string;
  try {
    real = await realpath(trimmed);
  } catch {
    throw new InspectError('workspace_not_open', `Workspace root does not exist: ${trimmed}`);
  }
  if (!fs.statSync(real).isDirectory()) throw new InspectError('workspace_not_open', 'Workspace root is not a directory.');
  return real;
}

/** Realpath-contain a relative sub-path inside the root (blocks `..`/symlink/absolute escapes). */
async function containedPath(realRoot: string, rel: string | undefined): Promise<string> {
  if (!rel || rel === '.' || rel === './') return realRoot;
  if (path.isAbsolute(rel)) throw new InspectError('scope_not_authorized', 'Path must be relative to the workspace root.');
  const resolved = path.resolve(realRoot, rel);
  // realpath the target when it exists; otherwise validate the lexical resolution.
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    real = resolved; // non-existent target: fall back to the lexical path for the boundary check
  }
  if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
    throw new InspectError('scope_not_authorized', `Path escapes the workspace root: ${rel}`);
  }
  return real;
}

async function git(realRoot: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd: realRoot, maxBuffer: GIT_MAX_BUFFER, timeout: GIT_TIMEOUT_MS });
    return stdout;
  } catch (err) {
    const e = err as { killed?: boolean; signal?: string; stderr?: string; message?: string };
    if (e.killed || e.signal === 'SIGTERM') throw new InspectError('tool_execution_timed_out', `git ${args.join(' ')} timed out`);
    throw new InspectError('tool_execution_failed', (e.stderr || e.message || 'git command failed').toString().trim().slice(0, 500));
  }
}

const FIND_IGNORE = new Set(['node_modules', '.git', 'dist', 'coverage', '.next', '.turbo', 'build', 'out', '.cache']);
// Archived/backup/legacy/temp trees are pruned too, so `find` never surfaces a
// stale copy an assistant could then read and describe as if it were current.
const FIND_IGNORE_PATTERN = /^(\.archived.*|\.archive|backups?|.*-legacy|.*legacy.*|\.tmp.*|\.trash|\.old)$/i;
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Bounded, workspace-contained filesystem NAME/PATH search (files + dirs). Never
 * follows symlinked directories (prevents a symlink escape) and skips heavy dirs.
 * Matches the query against the entry basename or workspace-relative path;
 * supports `*` globbing. Distinct from content `search`. */
function findByName(realRoot: string, query: string, kind: 'file' | 'dir' | 'any', limit: number): Array<{ path: string; type: string }> {
  const q = query.toLowerCase();
  const rx = query.includes('*') ? new RegExp('^' + query.split('*').map(escapeRegExp).join('.*') + '$', 'i') : null;
  const matches: Array<{ path: string; type: string }> = [];
  const stack: string[] = [realRoot];
  // Hard node cap so a huge tree (a checked-in cache, etc.) can never make a
  // non-matching search walk unbounded and block the runner's event loop.
  const FIND_MAX_ENTRIES = 200_000;
  let visited = 0;
  while (stack.length && matches.length < limit && visited < FIND_MAX_ENTRIES) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (matches.length >= limit || visited >= FIND_MAX_ENTRIES) break;
      visited += 1;
      const abs = path.join(dir, e.name);
      const rel = path.relative(realRoot, abs);
      const isDir = e.isDirectory();
      const isSym = e.isSymbolicLink();
      const type = isDir ? 'dir' : isSym ? 'symlink' : 'file';
      const nameMatch = rx ? rx.test(e.name) || rx.test(rel) : e.name.toLowerCase().includes(q) || rel.toLowerCase().includes(q);
      const kindOk = kind === 'any' || (kind === 'dir' && isDir) || (kind === 'file' && !isDir && !isSym);
      if (nameMatch && kindOk) matches.push({ path: rel, type });
      // Recurse into REAL directories only — never a symlinked dir (escape guard),
      // and never into heavy/archived/backup/legacy trees.
      if (isDir && !isSym && !FIND_IGNORE.has(e.name) && !FIND_IGNORE_PATTERN.test(e.name)) stack.push(abs);
    }
  }
  return matches;
}

function detectPackageManager(realRoot: string): { manager: string; evidence: string } {
  const has = (f: string): boolean => fs.existsSync(path.join(realRoot, f));
  if (has('pnpm-lock.yaml')) return { manager: 'pnpm', evidence: 'pnpm-lock.yaml' };
  if (has('yarn.lock')) return { manager: 'yarn', evidence: 'yarn.lock' };
  if (has('bun.lockb')) return { manager: 'bun', evidence: 'bun.lockb' };
  if (has('package-lock.json')) return { manager: 'npm', evidence: 'package-lock.json' };
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(realRoot, 'package.json'), 'utf8')) as { packageManager?: string };
    if (typeof pkg.packageManager === 'string' && pkg.packageManager) return { manager: pkg.packageManager.split('@')[0]!, evidence: 'package.json#packageManager' };
    return { manager: 'npm', evidence: 'package.json (no lockfile; defaulting to npm)' };
  } catch {
    return { manager: 'unknown', evidence: 'no lockfile or package.json found' };
  }
}

/** Run one read-only inspection op. Returns op-specific data or throws InspectError. */
export async function runInspection(req: InspectRequest): Promise<{ op: InspectOp; data: unknown }> {
  const realRoot = await resolveRoot(req.rootPath);
  switch (req.op) {
    case 'workspace_root':
      return { op: req.op, data: { root: realRoot } };
    case 'list': {
      const dir = await containedPath(realRoot, req.path);
      const limit = req.limit ?? 200;
      const entries = fs
        .readdirSync(dir, { withFileTypes: true })
        .slice(0, limit)
        .map((e) => ({ name: e.name, type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'symlink' : 'file' }));
      return { op: req.op, data: { dir: path.relative(realRoot, dir) || '.', entries, truncatedAt: entries.length >= limit ? limit : undefined } };
    }
    case 'find': {
      if (!req.query || !req.query.trim()) throw new InspectError('tool_execution_failed', 'A non-empty `query` is required for find.');
      const matches = findByName(realRoot, req.query.trim(), req.kind ?? 'any', req.limit ?? 100);
      return { op: req.op, data: { query: req.query, kind: req.kind ?? 'any', matches } };
    }
    case 'search': {
      // CONTENT search (grep-like) — distinct from `find` (name/path).
      if (!req.query || !req.query.trim()) throw new InspectError('tool_execution_failed', 'A non-empty `query` is required for search.');
      const res = await workspaceSearch({ rootPath: realRoot, query: req.query, limit: req.limit ?? 20, includeGlobs: [], excludeGlobs: ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**'] });
      return { op: req.op, data: { query: req.query, matches: res.matches } };
    }
    case 'read': {
      if (!req.path) throw new InspectError('tool_execution_failed', 'A `path` is required for read.');
      await containedPath(realRoot, req.path); // boundary check (throws scope_not_authorized)
      try {
        const res = await fileReadRange({ rootPath: realRoot, path: req.path, startLine: req.startLine ?? 1, endLine: req.endLine ?? 400 });
        return { op: req.op, data: res };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // A missing file is a clear, common case — give a readable message
        // instead of a raw `ENOENT: no such file or directory, open '…'`.
        if (/ENOENT|no such file/i.test(msg)) {
          throw new InspectError('tool_execution_failed', `File not found in the workspace: ${req.path}. It may be a domain, a URL, or a path outside the workspace — check the name.`);
        }
        throw new InspectError('tool_execution_failed', msg.slice(0, 500));
      }
    }
    case 'git_status': {
      const branch = (await git(realRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
      const short = await git(realRoot, ['status', '--short']);
      const files = short.split(/\r?\n/).filter(Boolean).map((l) => ({ status: l.slice(0, 2), path: l.slice(3).trim() }));
      return { op: req.op, data: { branch: branch || null, clean: files.length === 0, files } };
    }
    case 'git_branch':
      return { op: req.op, data: { branch: (await git(realRoot, ['branch', '--show-current'])).trim() || null } };
    case 'git_head':
      return { op: req.op, data: { head: (await git(realRoot, ['rev-parse', 'HEAD'])).trim() || null } };
    case 'git_remotes': {
      const out = await git(realRoot, ['remote', '-v']);
      const remotes = out.split(/\r?\n/).filter(Boolean).map((l) => {
        const [name, rest] = l.split(/\s+/, 2);
        return { name, url: (rest ?? '').replace(/\s*\((fetch|push)\)$/, '').trim() };
      });
      // De-dup fetch/push pairs by name+url.
      const seen = new Set<string>();
      const unique = remotes.filter((r) => { const k = `${r.name} ${r.url}`; if (seen.has(k)) return false; seen.add(k); return true; });
      return { op: req.op, data: { remotes: unique } };
    }
    case 'pkg_manager':
      return { op: req.op, data: detectPackageManager(realRoot) };
    default:
      throw new InspectError('tool_not_available', `Unknown inspection op: ${String((req as { op?: string }).op)}`);
  }
}

/** Register `POST /api/ai/inspect`. Read-only, model-free, workspace-contained. */
export function registerInspectRoutes(app: FastifyInstance): void {
  app.post('/api/ai/inspect', async (request: FastifyRequest, reply) => {
    const traceId = String((request.headers['x-request-id'] as string | undefined) ?? '') || `insp_${randomUUID()}`;
    const parsed = InspectRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { ok: false, code: 'tool_not_available' as InspectErrorCode, error: 'Invalid inspection request.', traceId, runner: 'local', issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    }
    const op = parsed.data.op;
    try {
      const { data } = await runInspection(parsed.data);
      return { ok: true, op, runner: 'local' as const, executionScope: 'local' as const, traceId, data };
    } catch (err) {
      const code: InspectErrorCode = err instanceof InspectError ? err.code : 'tool_execution_failed';
      const message = err instanceof Error ? err.message : String(err);
      // 400 for caller/scope problems; 200-with-error is avoided so clients can
      // branch on status too. Runner/policy failures use 422/503.
      const status = code === 'workspace_not_open' || code === 'scope_not_authorized' || code === 'tool_not_available' ? 400 : code === 'policy_denied' ? 403 : code === 'tool_execution_timed_out' ? 504 : 422;
      reply.code(status);
      return { ok: false, code, error: message, remediation: REMEDIATION[code], op, runner: 'local' as const, executionScope: 'local' as const, traceId };
    }
  });
}
