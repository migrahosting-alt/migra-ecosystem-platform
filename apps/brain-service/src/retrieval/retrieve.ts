import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RetrieveRequest, RetrieveResponse, RetrievedChunk } from '@migrapilot/shared-types';

const TEXT_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.py', '.java', '.go', '.rs', '.sql']);

export async function retrieveContext(input: RetrieveRequest): Promise<RetrieveResponse> {
  const activeChunks = input.activeFile ? [await readActiveFileChunk(input.activeFile)] : [];

  return {
    repoSummary: `Scaffold retrieval for ${path.basename(input.workspaceRoot)}.`,
    chunks: activeChunks.filter(Boolean) as RetrievedChunk[],
    tokenEstimate: 180,
  };
}

async function readActiveFileChunk(filePath: string): Promise<RetrievedChunk | null> {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (!TEXT_EXTENSIONS.has(ext)) {
      return null;
    }

    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    const snippet = lines.slice(0, 40).join('\n');

    return {
      path: filePath,
      startLine: 1,
      endLine: Math.min(40, lines.length),
      snippet,
      score: 0.9,
      source: 'recent',
    };
  } catch {
    return null;
  }
}
