// List what is actually IN a workspace directory.
//
// The agent could search file CONTENT, read a line range, read a symbol and ask
// git for status — but it had no way to enumerate files. Asked "what is in the
// root?", it therefore had no tool that could answer, and it guessed: against a
// repository holding package.json, README.md and .gitignore it reported "the
// root directory is empty, and there is no package.json file".
//
// That is not a prompting problem. An agent cannot report filesystem evidence it
// has no instrument to observe, so this supplies the instrument.
//
// Bounded and contained on the same terms as the other read-only tools: never
// escapes the workspace root, never walks into dependency/build trees, and
// truncates rather than enumerating an unbounded tree.

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** Directory names never worth listing — they bury the real contents. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next',
  '.turbo', '.cache', '.venv', 'venv', '__pycache__', '.vscode-test',
]);

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1_000;
const MAX_DEPTH = 3;

export const WorkspaceListRequestSchema = z.object({
  rootPath: z.string().min(1),
  /** Workspace-relative directory to list. Defaults to the root itself. */
  path: z.string().optional(),
  /** Recurse this many levels below `path` (0 = the directory itself). */
  depth: z.number().int().min(0).max(MAX_DEPTH).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
});

export type WorkspaceListRequest = z.infer<typeof WorkspaceListRequestSchema>;

export interface WorkspaceListEntry {
  /** Workspace-relative path, POSIX-separated. */
  path: string;
  type: 'file' | 'dir' | 'symlink';
  /** Bytes, for files only. */
  size?: number;
}

export interface WorkspaceListResponse {
  tool: 'workspace.list';
  dir: string;
  entries: WorkspaceListEntry[];
  /** True when the listing hit `limit` and is therefore incomplete. */
  truncated: boolean;
}

/** Resolve `rel` under `root`, refusing anything that escapes it. */
function contained(root: string, rel?: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, rel ?? '.');
  const withSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(withSep)) {
    throw new Error(`path "${rel}" escapes the workspace root`);
  }
  return target;
}

export async function workspaceList(input: WorkspaceListRequest): Promise<WorkspaceListResponse> {
  const req = WorkspaceListRequestSchema.parse(input);
  const root = path.resolve(req.rootPath);
  const dir = contained(root, req.path);
  const limit = req.limit ?? DEFAULT_LIMIT;
  const maxDepth = req.depth ?? 0;

  const entries: WorkspaceListEntry[] = [];
  let truncated = false;

  const walk = (current: string, depth: number): void => {
    if (truncated) return;
    let dirents: fs.Dirent[];
    try {
      dirents = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return; // unreadable directory is reported as absent, never as a crash
    }
    // Stable order so the same tree lists identically every time.
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
        if (depth < maxDepth && !SKIP_DIRS.has(d.name)) walk(abs, depth + 1);
      } else if (d.isSymbolicLink()) {
        entries.push({ path: rel, type: 'symlink' });
      } else {
        let size: number | undefined;
        try {
          size = fs.statSync(abs).size;
        } catch {
          size = undefined;
        }
        entries.push({ path: rel, type: 'file', ...(size === undefined ? {} : { size }) });
      }
    }
  };

  walk(dir, 0);
  return {
    tool: 'workspace.list',
    dir: path.relative(root, dir).split(path.sep).join('/') || '.',
    entries,
    truncated,
  };
}
