import fs from 'node:fs';
import path from 'node:path';
import {
  WorkspaceSearchRequestSchema,
  type WorkspaceSearchRequest,
  type WorkspaceSearchResponse,
} from '@migrapilot/protocol';

const DEFAULT_IGNORED_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  'coverage',
  '.next',
  '.turbo',
]);

function walk(dir: string, files: string[] = []): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
        continue;
      }
      walk(fullPath, files);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

export async function workspaceSearch(
  input: WorkspaceSearchRequest,
): Promise<WorkspaceSearchResponse> {
  const req = WorkspaceSearchRequestSchema.parse(input);
  const needle = req.query.toLowerCase();
  const allFiles = walk(req.rootPath);
  const matches: WorkspaceSearchResponse['matches'] = [];

  for (const absPath of allFiles) {
    if (matches.length >= req.limit) {
      break;
    }

    let text: string;
    try {
      text = fs.readFileSync(absPath, 'utf8');
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.toLowerCase().includes(needle)) {
        matches.push({
          path: path.relative(req.rootPath, absPath).replace(/\\/g, '/'),
          line: index + 1,
          preview: line.trim(),
        });

        if (matches.length >= req.limit) {
          break;
        }
      }
    }
  }

  return {
    tool: 'workspace.search',
    matches,
  };
}