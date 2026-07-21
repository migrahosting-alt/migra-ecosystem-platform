// Find workspace files by NAME.
//
// The agent could search file CONTENT but had no way to ask "where is
// tsconfig.json?" or "is there a docker-compose file?" — questions about names,
// not contents. Content search answers those badly: it matches every file that
// merely mentions the string, which is how "what does the changeset lint check"
// surfaced eslint configs and deployment docs instead of changesetLint.ts.
//
// Bounded and contained like the other read-only tools: dependency and build
// trees are never walked, results are capped, and truncation is reported.

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next',
  '.turbo', '.cache', '.venv', 'venv', '__pycache__', '.vscode-test',
]);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const MAX_DEPTH = 8;

export const WorkspaceFindRequestSchema = z.object({
  rootPath: z.string().min(1),
  /** Substring or glob-ish name, e.g. "tsconfig", "*.prisma", "docker-compose*". */
  query: z.string().min(1),
  kind: z.enum(['file', 'dir', 'any']).optional(),
  limit: z.number().int().min(1).max(MAX_LIMIT).optional(),
});

export type WorkspaceFindRequest = z.infer<typeof WorkspaceFindRequestSchema>;

export interface WorkspaceFindResponse {
  tool: 'workspace.find';
  query: string;
  matches: Array<{ path: string; type: 'file' | 'dir' }>;
  truncated: boolean;
}

/** Turn a caller's name pattern into a matcher. `*` and `?` behave as globs;
 * a plain word matches as a case-insensitive substring, which is what a model
 * usually means by "find tsconfig". */
function matcher(query: string): (name: string) => boolean {
  if (/[*?]/.test(query)) {
    const rx = new RegExp(
      `^${query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`,
      'i',
    );
    return (name) => rx.test(name);
  }
  const needle = query.toLowerCase();
  return (name) => name.toLowerCase().includes(needle);
}

export async function workspaceFind(input: WorkspaceFindRequest): Promise<WorkspaceFindResponse> {
  const req = WorkspaceFindRequestSchema.parse(input);
  const root = path.resolve(req.rootPath);
  const limit = req.limit ?? DEFAULT_LIMIT;
  const kind = req.kind ?? 'any';
  const matches: WorkspaceFindResponse['matches'] = [];
  const hit = matcher(req.query.trim());
  let truncated = false;

  const walk = (dir: string, depth: number): void => {
    if (truncated || depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (truncated) return;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      const isDir = e.isDirectory();
      if (hit(e.name) && (kind === 'any' || (kind === 'dir') === isDir)) {
        if (matches.length >= limit) {
          truncated = true;
          return;
        }
        matches.push({ path: rel, type: isDir ? 'dir' : 'file' });
      }
      if (isDir && !SKIP_DIRS.has(e.name)) walk(abs, depth + 1);
    }
  };

  walk(root, 0);
  return { tool: 'workspace.find', query: req.query, matches, truncated };
}
