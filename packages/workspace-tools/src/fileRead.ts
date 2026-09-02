// Read a whole workspace file.
//
// `file.readRange` REQUIRES startLine and endLine, so to read package.json the
// agent had to GUESS a range — and a wrong guess yields a truncated file that
// it then reasons about as if complete. Reading a small file should not require
// knowing its length in advance.
//
// Bounded: a file larger than the cap returns its head plus an explicit
// `truncated` flag and the real total, so a partial read is never mistaken for
// the whole thing.

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const DEFAULT_MAX_BYTES = 64 * 1024;
const MAX_MAX_BYTES = 512 * 1024;

export const FileReadRequestSchema = z.object({
  rootPath: z.string().min(1),
  path: z.string().min(1),
  maxBytes: z.number().int().min(1).max(MAX_MAX_BYTES).optional(),
});

export type FileReadRequest = z.infer<typeof FileReadRequestSchema>;

export interface FileReadResponse {
  tool: 'file.read';
  path: string;
  content: string;
  /** Lines in the RETURNED content. */
  lines: number;
  /** Bytes in the whole file on disk. */
  totalBytes: number;
  /** True when `content` is only the head of a larger file. */
  truncated: boolean;
}

function contained(root: string, rel: string): string {
  const base = path.resolve(root);
  const target = path.resolve(base, rel);
  const withSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (target !== base && !target.startsWith(withSep)) {
    throw new Error(`path "${rel}" escapes the workspace root`);
  }
  return target;
}

export async function fileRead(input: FileReadRequest): Promise<FileReadResponse> {
  const req = FileReadRequestSchema.parse(input);
  const abs = contained(req.rootPath, req.path);
  const maxBytes = req.maxBytes ?? DEFAULT_MAX_BYTES;

  const stat = fs.statSync(abs);
  if (stat.isDirectory()) {
    // A directory is a listing question, and answering it with an error that
    // NAMES the right tool is far better than a bare EISDIR.
    throw new Error(`"${req.path}" is a directory — use workspace.list to see what is in it`);
  }

  const buf = fs.readFileSync(abs);
  const truncated = buf.byteLength > maxBytes;
  const content = buf.subarray(0, Math.min(buf.byteLength, maxBytes)).toString('utf8');
  return {
    tool: 'file.read',
    path: req.path,
    content,
    lines: content === '' ? 0 : content.split(/\r?\n/).length,
    totalBytes: stat.size,
    truncated,
  };
}
