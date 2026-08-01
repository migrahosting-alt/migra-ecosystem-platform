// A consistent, MACHINE-AUTHORED work report rendered after every engineer/build
// task — so the user always gets the same clear "here's what I did" summary
// regardless of what prose the model wrote in its final answer (Claude Code /
// Copilot behavior). Pure + unit-tested; the caller feeds it observed run facts.

import { deriveFlags, isStaleRender, type PersistedBrainOperation } from '../services/brainPersistence.js';

/** The authoritative execution snapshot a report is rendered FROM.
 *
 * `currentRevision` is what the store believes is authoritative right now. If it
 * differs from the snapshot's own revision the report is rendered from stale data and
 * says so — mixed revisions are never rendered silently. */
export interface WorkReportExecution {
  record: PersistedBrainOperation;
  currentRevision: number;
}

export interface WorkReportInput {
  /** The user's task text. */
  task: string;
  /** Folder the run operated in. */
  root: string;
  /** Files in the final proposed changeset (empty if none). */
  proposedFiles: Array<{ path: string; kind?: string }>;
  /** True iff the changeset was applied to disk. */
  applied: boolean;
  /**
   * @deprecated NOT an authority. When `execution` is supplied every outcome flag is
   * derived from the persisted record and this value is ignored entirely. It remains
   * only for call sites that have not yet been migrated to the execution snapshot.
   */
  cancelled: boolean;
  /** The persisted execution record. When present it is the ONLY source of truth for
   * cancelled/success/failed/interrupted. */
  execution?: WorkReportExecution;
  /** Whether auto-apply mode was on (changes how "not applied" reads). */
  autoApply?: boolean;
}

function clip(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

const KIND_LABEL: Record<string, string> = { add: 'create', delete: 'delete', mkdir: 'mkdir', modify: 'modify' };

/** Render the report as a Markdown block. Deterministic — same facts, same text. */
export function buildWorkReport(input: WorkReportInput): string {
  // One snapshot decides every outcome flag. `input.cancelled` is consulted only when
  // no execution record was supplied, and is deprecated.
  const flags = input.execution ? deriveFlags(input.execution.record) : undefined;
  const cancelled = flags ? flags.cancelled : input.cancelled;

  const header: string[] = [];
  if (input.execution) {
    const { record, currentRevision } = input.execution;
    const stale = isStaleRender(
      { operationId: record.operationId, revision: record.revision },
      { operationId: record.operationId, revision: currentRevision },
    );
    if (stale) {
      header.push(
        `> **STALE REPORT** — rendered from revision ${record.revision}, but revision ` +
          `${currentRevision} is authoritative. Do not rely on the outcome below.`,
        '',
      );
    }
    header.push(`_operation \`${record.operationId}\` · revision ${record.revision}_`, '');
    if (flags && !flags.success && record.currentState === 'completed') {
      header.push(
        '> Completed **without** durable terminal evidence — not reported as success.',
        '',
      );
    }
    if (flags?.interrupted) {
      header.push(
        `> Interrupted (${record.recovery?.evidence ?? 'unknown'}) — the outcome was never observed.`,
        '',
      );
    }
    if (flags?.cancellationRequested && !flags.cancellationConfirmed) {
      header.push('> Cancellation requested but not confirmed', '');
    }
  }
  const prefix = header.length ? `${header.join('\n')}` : '';

  if (cancelled) {
    return `\n\n---\n${prefix}**⏹ Stopped.** The run was cancelled before it finished — no changes were applied.\n`;
  }

  const lines: string[] = ['\n\n---', ...(prefix ? [prefix] : []), '### 📋 Summary'];
  lines.push(`- **Task:** ${clip(input.task, 160) || '(none)'}`);
  lines.push(`- **Folder:** \`${input.root}\``);

  const files = input.proposedFiles.filter((f) => f.path);
  if (files.length === 0) {
    // NEVER a green tick here. "✅ Done" under "none proposed" reads as success,
    // and the owner saw exactly that after a build order produced nothing. The
    // wording stays NEUTRAL rather than alarmed, because a task like "run the
    // tests" legitimately changes no files — state the fact, claim nothing.
    lines.push('- **Changes:** none proposed — no files were written.');
    lines.push('- **Status:** No files were created or changed.');
    return lines.join('\n') + '\n';
  }

  const MAX_LIST = 12;
  const shown = files.slice(0, MAX_LIST);
  const list = shown
    .map((f) => `\`${f.path}\`${f.kind && KIND_LABEL[f.kind] ? ` _(${KIND_LABEL[f.kind]})_` : ''}`)
    .join(', ');
  const more = files.length > shown.length ? ` +${files.length - shown.length} more` : '';
  lines.push(`- **Files:** ${files.length} — ${list}${more}`);

  if (input.applied) {
    lines.push('- **Status:** ✅ Applied to the workspace.');
    lines.push('- **Next:** run/verify the result; use Version History to revert if needed.');
  } else {
    lines.push(
      input.autoApply
        ? '- **Status:** ⚠️ Proposed but NOT applied (auto-apply was on but the apply did not complete). Try again or apply manually.'
        : '- **Status:** ⏳ Proposed — not applied yet.',
    );
    if (!input.autoApply) {
      lines.push('- **Next:** click **Apply** on the prompt to write them (or enable `migrapilot.autoApplyChangeset` to apply automatically).');
    }
  }
  return lines.join('\n') + '\n';
}
