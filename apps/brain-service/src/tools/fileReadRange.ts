import fs from 'node:fs';
import path from 'node:path';
import {
  FileReadRangeRequestSchema,
  type FileReadRangeRequest,
  type FileReadRangeResponse,
} from '@migrapilot/protocol';

export async function fileReadRange(
  input: FileReadRangeRequest,
): Promise<FileReadRangeResponse> {
  const req = FileReadRangeRequestSchema.parse(input);
  const absPath = path.resolve(req.rootPath, req.path);
  const raw = fs.readFileSync(absPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;

  // A caller-inverted range is a real error; a range that overshoots EOF is
  // not — callers (e.g. diagnostic focus windows) routinely request a few
  // lines past the end of short files, so clamp to the file's bounds instead
  // of failing the whole request.
  if (req.startLine > req.endLine) {
    throw new Error('Requested line range is inverted (startLine > endLine).');
  }

  const startLine = Math.max(1, Math.min(req.startLine, totalLines));
  const endLine = Math.max(startLine, Math.min(req.endLine, totalLines));
  const selected = lines.slice(startLine - 1, endLine).join('\n');

  return {
    tool: 'file.readRange',
    path: req.path,
    startLine,
    endLine,
    content: selected,
    totalLines,
  };
}