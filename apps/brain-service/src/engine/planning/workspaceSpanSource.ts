/**
 * MigraAI Engine — the one way the engine turns a workspace path into evidence.
 *
 * Both the planner and the exploration fallback obtain source through this, so the
 * containment checks in `runInspection` remain the single boundary and the cache's
 * freshness token is computed the same way everywhere. A second reader with its own
 * `fs.readFileSync` would be a second, unaudited path to the user's files — the
 * same shape of defect `check-brain-transport.mjs` exists to prevent for the Brain.
 *
 * The fingerprint is a STAT (mtime + size), never a read: it is consulted on every
 * cache hit, and re-reading a file to decide whether to re-read it would leave the
 * filesystem cost exactly where it was. © MigraTeck LLC.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { runInspection } from '../inspectRoutes.js';
import type { EvidenceSource } from '../grounding/evidenceLedger.js';

export function makeSpanSource(workspaceRoot: string, relPath: string, startLine: number, endLine: number): EvidenceSource {
  return {
    fingerprint() {
      try {
        const s = fs.statSync(path.resolve(workspaceRoot, relPath));
        return `${s.mtimeMs}:${s.size}`;
      } catch {
        return undefined; // absent or unreadable: treat as unknown, never as unchanged
      }
    },
    async read() {
      const { data } = await runInspection({ rootPath: workspaceRoot, op: 'read', path: relPath, startLine, endLine });
      const d = data as { startLine?: number; endLine?: number; content?: string; totalLines?: number };
      return {
        startLine: typeof d.startLine === 'number' ? d.startLine : startLine,
        endLine: typeof d.endLine === 'number' ? d.endLine : endLine,
        text: typeof d.content === 'string' ? d.content : '',
        // Carried so the cache can tell "we hold the whole file" from "we hold a
        // window" — `runInspection` clamps an over-long range to the real EOF.
        ...(typeof d.totalLines === 'number' ? { totalLines: d.totalLines } : {}),
      };
    },
  };
}
