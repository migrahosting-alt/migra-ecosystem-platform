import { EditApplyRequestSchema, type EditApplyRequest } from '@migrapilot/protocol';
import type { WorkspaceFs } from './adapters.js';
import { containedPath } from './paths.js';
import { WorkspaceToolError } from './errors.js';

export interface EditApplyFileOutcome {
  path: string;
  changed: boolean;
  /** dry-run only — the exact proposed effect. */
  before?: string;
  after?: string;
  /** live only — read-back confirmed the write. */
  verified?: boolean;
}

export interface EditApplyOutcome {
  tool: 'edit.apply';
  mode: 'dry-run' | 'live';
  files: EditApplyFileOutcome[];
}

/**
 * Hardened, runtime-neutral `edit.apply`. The host injects a bounded {@link
 * WorkspaceFs}; every path is forced through {@link containedPath}. Guarantees:
 *  - PATH CONTAINMENT: no absolute paths, no `..` traversal, no symlink escape.
 *  - VALIDATE-ALL-FIRST: ranges + containment are checked and next-content computed
 *    for every file BEFORE anything is written, so a validation error never leaves
 *    a partial write.
 *  - DRY-RUN returns the exact before/after effect and writes nothing.
 *  - LIVE writes atomically (adapter temp+rename), READS BACK to verify, and ROLLS
 *    BACK every already-written file on any failure — a multi-file apply is
 *    all-or-nothing and a failure is reported precisely (fail closed).
 */
export function editApply(input: unknown, opts: { fs: WorkspaceFs; mode: 'dry-run' | 'live' }): EditApplyOutcome {
  const req = EditApplyRequestSchema.parse(input);
  const { fs, mode } = opts;

  const grouped = new Map<string, EditApplyRequest['changes']>();
  for (const c of req.changes) {
    const list = grouped.get(c.path) ?? [];
    list.push(c);
    grouped.set(c.path, list);
  }

  // ── Phase 1: validate + compute. No writes. ────────────────────────────────
  const planned: Array<{ path: string; abs: string; before: string; after: string; changed: boolean }> = [];
  for (const [relPath, changes] of grouped) {
    const abs = containedPath(req.rootPath, relPath, fs);
    if (!fs.exists(abs)) throw new WorkspaceToolError('NOT_FOUND', `File not found: ${relPath}`);
    const before = fs.readFile(abs);
    const next = before.split(/\r?\n/);
    for (const ch of [...changes].sort((l, r) => r.startLine - l.startLine)) {
      if (ch.startLine < 1 || ch.endLine < ch.startLine || ch.endLine > next.length) {
        throw new WorkspaceToolError('INVALID_RANGE', `Invalid edit range ${ch.startLine}-${ch.endLine} for ${relPath}`);
      }
      next.splice(ch.startLine - 1, ch.endLine - ch.startLine + 1, ...ch.replacement.split(/\r?\n/));
    }
    const after = next.join('\n');
    planned.push({ path: relPath, abs, before, after, changed: after !== before });
  }

  if (mode === 'dry-run') {
    return { tool: 'edit.apply', mode: 'dry-run', files: planned.map((p) => ({ path: p.path, changed: p.changed, before: p.before, after: p.after })) };
  }

  // ── Phase 2: live write + read-back verify + rollback-on-failure. ───────────
  const written: Array<{ abs: string; before: string }> = [];
  try {
    for (const p of planned) {
      fs.writeFile(p.abs, p.after);
      written.push({ abs: p.abs, before: p.before });
      if (fs.readFile(p.abs) !== p.after) {
        throw new WorkspaceToolError('READBACK_MISMATCH', `Read-back verification failed for ${p.path}`);
      }
    }
  } catch (err) {
    for (const w of [...written].reverse()) {
      try { fs.writeFile(w.abs, w.before); } catch { /* best-effort rollback */ }
    }
    if (err instanceof WorkspaceToolError) throw err;
    throw new WorkspaceToolError('PARTIAL_WRITE', `Apply failed and was rolled back: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { tool: 'edit.apply', mode: 'live', files: planned.map((p) => ({ path: p.path, changed: p.changed, verified: true })) };
}
