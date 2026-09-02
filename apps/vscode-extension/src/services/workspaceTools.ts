/*
 * THE WORKSPACE TOOLS, RUN WHERE THE WORKSPACE IS.
 *
 * These used to execute inside the Brain, which was fine while the Brain ran on
 * the developer's machine. Once it moved to a shared governed server the files
 * were no longer there: reads failed, and a directory listing came back EMPTY —
 * telling the agent the project had no files and inviting it to invent some.
 *
 * So the Brain asks and the extension answers. Everything here is deliberately
 * plain filesystem work with no model in it: the Brain still decides WHAT to
 * look at and WHY, and this module only reports what is actually on disk.
 *
 * TWO RULES HOLD EVERY IMPLEMENTATION BELOW.
 *
 * 1. Absence is an ERROR, never an empty success. That distinction is the whole
 *    reason this module exists, and re-introducing a silent empty anywhere would
 *    recreate the original defect on the other side of the wire.
 * 2. Nothing here writes. Proposals are computed and returned for the operator
 *    to approve through the existing preview-and-apply path, which stays the
 *    only thing that touches the working tree.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** Tools this extension can answer. Anything else is refused by name, not ignored. */
export const SUPPORTED_WORKSPACE_TOOLS = [
  'workspace.list',
  'file.read',
  'git.status',
  'fs.proposeChangeset',
] as const;

export type SupportedWorkspaceTool = (typeof SUPPORTED_WORKSPACE_TOOLS)[number];

export class WorkspaceToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceToolError';
  }
}

const asRecord = (input: unknown): Record<string, unknown> =>
  input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

/**
 * Resolve a path INSIDE the root, refusing anything that escapes it.
 *
 * The Brain is a model-driven caller, so a traversal is a realistic accident
 * rather than a hypothetical: the boundary is enforced here, on the machine that
 * actually holds the files, not upstream where it could be reasoned around.
 */
function contained(root: string, rel: string | undefined): string {
  const base = path.resolve(root);
  const target = path.resolve(base, rel ?? '.');
  const withSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(withSep)) {
    throw new WorkspaceToolError(`path "${rel}" escapes the workspace root`);
  }
  return target;
}

/** Assert the root exists and is a directory — the check whose absence caused the original bug. */
async function assertRoot(rootPath: string | undefined): Promise<string> {
  const root = str(rootPath);
  if (!root) throw new WorkspaceToolError('rootPath is required');
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new WorkspaceToolError(`workspace root "${root}" does not exist on this machine`);
  }
  if (!stat.isDirectory()) throw new WorkspaceToolError(`workspace root "${root}" is not a directory`);
  return path.resolve(root);
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'out', '.next', 'coverage']);
const LIST_LIMIT = 500;
const READ_LIMIT_BYTES = 512 * 1024;

async function workspaceList(input: Record<string, unknown>): Promise<unknown> {
  const root = await assertRoot(str(input.rootPath));
  const dir = contained(root, str(input.path));
  const maxDepth = typeof input.depth === 'number' ? input.depth : 0;
  const limit = typeof input.limit === 'number' ? Math.min(input.limit, LIST_LIMIT) : LIST_LIMIT;

  const entries: Array<{ path: string; type: string; size?: number }> = [];
  let truncated = false;

  const walk = async (current: string, depth: number): Promise<void> => {
    if (truncated) return;
    let dirents;
    try {
      dirents = await fs.readdir(current, { withFileTypes: true });
    } catch {
      // One unreadable directory must not sink the listing — but see assertRoot:
      // the ROOT is checked separately, so this can never mean "workspace missing".
      return;
    }
    dirents.sort((a, b) => a.name.localeCompare(b.name));
    for (const d of dirents) {
      if (entries.length >= limit) {
        truncated = true;
        return;
      }
      const abs = path.join(current, d.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (d.isDirectory()) {
        entries.push({ path: rel, type: 'dir' });
        if (depth < maxDepth && !SKIP_DIRS.has(d.name)) await walk(abs, depth + 1);
      } else if (d.isSymbolicLink()) {
        entries.push({ path: rel, type: 'symlink' });
      } else {
        let size: number | undefined;
        try {
          size = (await fs.stat(abs)).size;
        } catch {
          size = undefined;
        }
        entries.push({ path: rel, type: 'file', ...(size === undefined ? {} : { size }) });
      }
    }
  };

  await walk(dir, 0);
  return {
    tool: 'workspace.list',
    dir: path.relative(root, dir).split(path.sep).join('/') || '.',
    entries,
    truncated,
  };
}

async function fileRead(input: Record<string, unknown>): Promise<unknown> {
  const root = await assertRoot(str(input.rootPath));
  const rel = str(input.path);
  if (!rel) throw new WorkspaceToolError('path is required');
  const target = contained(root, rel);
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    // Say it plainly. A model told a file is missing asks for a different one;
    // a model handed empty content believes the file exists and is blank.
    throw new WorkspaceToolError(`"${rel}" does not exist in this workspace`);
  }
  if (stat.isDirectory()) throw new WorkspaceToolError(`"${rel}" is a directory — use workspace.list`);
  if (stat.size > READ_LIMIT_BYTES) {
    throw new WorkspaceToolError(`"${rel}" is ${stat.size} bytes, larger than the ${READ_LIMIT_BYTES}-byte read limit`);
  }
  const text = await fs.readFile(target, 'utf8');
  return { tool: 'file.read', path: rel, text, bytes: stat.size };
}

async function gitStatus(input: Record<string, unknown>): Promise<unknown> {
  const root = await assertRoot(str(input.rootPath));
  try {
    const { stdout } = await run('git', ['status', '--porcelain=v1', '--branch'], { cwd: root, maxBuffer: 4 << 20 });
    const lines = stdout.split('\n').filter(Boolean);
    const branchLine = lines.find((l) => l.startsWith('##')) ?? '';
    const files = lines
      .filter((l) => !l.startsWith('##'))
      .map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) }));
    return { tool: 'git.status', branch: branchLine.replace(/^##\s*/, ''), files, clean: files.length === 0 };
  } catch (err) {
    throw new WorkspaceToolError(`git status failed: ${(err as Error).message}`);
  }
}

/**
 * Compute a changeset PROPOSAL. Nothing is written here.
 *
 * Each op is resolved and classified against what is actually on disk, so the
 * Brain learns whether a "create" would in fact overwrite — a distinction the
 * operator needs before approving, and one only this machine can answer.
 */
async function proposeChangeset(input: Record<string, unknown>): Promise<unknown> {
  const root = await assertRoot(str(input.rootPath));
  const ops = Array.isArray(input.ops) ? (input.ops as Array<Record<string, unknown>>) : [];
  if (!ops.length) throw new WorkspaceToolError('ops must contain at least one operation');

  const resolved = [];
  let totalBytes = 0;
  for (const op of ops) {
    const rel = str(op.path);
    if (!rel) throw new WorkspaceToolError('every op needs a path');
    const target = contained(root, rel);
    const kind = str(op.op) ?? 'create';
    const content = typeof op.content === 'string' ? op.content : '';
    let exists = true;
    try {
      await fs.stat(target);
    } catch {
      exists = false;
    }
    totalBytes += Buffer.byteLength(content, 'utf8');
    resolved.push({
      op: kind,
      path: rel,
      exists,
      // Named explicitly so an approving human is never surprised by an overwrite.
      effect: kind === 'delete' ? 'delete' : exists ? 'overwrite' : 'create',
      bytes: Buffer.byteLength(content, 'utf8'),
    });
  }

  return {
    tool: 'fs.proposeChangeset',
    fileCount: resolved.length,
    totalBytes,
    changeset: { rootPath: root, ops },
    ops: resolved,
    // Stated, not implied: this call changed nothing.
    applied: false,
  };
}

/** Run one delegated workspace tool. Unknown tools are refused by name. */
export async function executeWorkspaceTool(tool: string, input: unknown): Promise<unknown> {
  const args = asRecord(input);
  switch (tool) {
    case 'workspace.list':
      return workspaceList(args);
    case 'file.read':
      return fileRead(args);
    case 'git.status':
      return gitStatus(args);
    case 'fs.proposeChangeset':
      return proposeChangeset(args);
    default:
      throw new WorkspaceToolError(
        `${tool} is not implemented by this client yet (supported: ${SUPPORTED_WORKSPACE_TOOLS.join(', ')})`,
      );
  }
}
