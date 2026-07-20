import path from 'node:path';
import * as vscode from 'vscode';
import { MigraAiClient } from './migraAiClient.js';
import { applyApprovedChangeset } from './changesetApply.js';
import { isPilotError, toUserMessage } from '@migrapilot/pilot-client';

// Apply a workspace-engineer CHANGESET proposal (multi-file create/edit/delete)
// on explicit user confirmation — the "build the app" apply step. The engineer
// loop is preview-only by owner policy: it PROPOSES a changeset (stored on the
// engine, keyed by hash) and NEVER writes. This is the operator-approval half:
// show the diffs, confirm, then apply through the engine's approval boundary
// (`fs.applyChangeset` — approval-required, atomic, rollback-on-failure). The
// extension never writes files itself; the engine owns the mutation.

/** One proposed file operation, as surfaced on the engineer `proposal` event. */
export interface ChangesetOp {
  op?: string;
  path?: string;
  kind?: string; // 'add' | 'modify' | 'delete' | 'mkdir'
  before?: string | null;
  after?: string | null;
}

export interface ChangesetProposal {
  proposalHash: string;
  ops: ChangesetOp[];
  fileCount?: number;
}

const MAX_DIFFS = 10; // don't flood the editor for a huge changeset

/** Present a proposed changeset and, on confirmation, apply it via the engine.
 * Returns true iff files were applied. Non-throwing: surfaces failures as
 * warnings so a bad proposal never breaks the chat turn. */
export async function previewAndMaybeApplyChangeset(
  migraAi: MigraAiClient,
  rootPath: string,
  proposal: ChangesetProposal,
  title: string,
): Promise<boolean> {
  const fileOps = proposal.ops.filter((o) => o.kind !== 'mkdir' && o.path);
  if (!proposal.proposalHash || fileOps.length === 0) return false;

  const names = fileOps.map((o) => o.path!).filter(Boolean);
  const summary =
    names.length <= 5 ? names.join(', ') : `${names.slice(0, 5).join(', ')} +${names.length - 5} more`;

  const choice = await vscode.window.showInformationMessage(
    `MigraPilot proposed ${fileOps.length} file change${fileOps.length === 1 ? '' : 's'}: ${summary}. Apply to the workspace?`,
    'Apply',
    'Review diffs',
    'Dismiss',
  );

  if (choice === 'Review diffs') {
    await showChangesetDiffs(rootPath, title, fileOps);
    const confirm = await vscode.window.showInformationMessage(
      `Apply ${fileOps.length} proposed file change${fileOps.length === 1 ? '' : 's'}?`,
      'Apply',
      'Dismiss',
    );
    if (confirm !== 'Apply') return false;
  } else if (choice !== 'Apply') {
    return false;
  }

  // Confirmed → run the engine approval sequence (mint token, then consume it to
  // apply exactly once, atomically with rollback on failure).
  let outcome: 'applied' | 'not_applied';
  try {
    outcome = await applyApprovedChangeset((req) => migraAi.executeTool(req), rootPath, proposal.proposalHash);
  } catch (error) {
    await surfaceToolError(error, 'apply');
    return false;
  }
  if (outcome !== 'applied') {
    await surfaceToolError(new Error('not applied'), 'propose');
    return false;
  }

  await vscode.window.showInformationMessage(
    `MigraPilot applied ${fileOps.length} file change${fileOps.length === 1 ? '' : 's'} to the workspace.`,
  );
  return true;
}

async function surfaceToolError(error: unknown, phase: 'propose' | 'apply'): Promise<void> {
  const code = isPilotError(error) ? error.code : 'SERVER_ERROR';
  const base = toUserMessage(code) || 'MigraPilot could not apply the proposed changes.';
  // A stale hash (proposal TTL elapsed) is the common, recoverable case.
  const hint = phase === 'propose' ? ' The proposal may have expired — ask MigraPilot to rebuild it.' : '';
  await vscode.window.showWarningMessage(`${base}${hint}`);
}

/** Open a native diff for each proposed file (bounded). Creates render as an
 * empty-vs-content diff; edits as before-vs-after; deletes as content-vs-empty. */
async function showChangesetDiffs(rootPath: string, title: string, ops: ChangesetOp[]): Promise<void> {
  const shown = ops.slice(0, MAX_DIFFS);
  for (const op of shown) {
    const rel = op.path!;
    const lang = languageForPath(rel);
    const left = await vscode.workspace.openTextDocument({ language: lang, content: op.before ?? '' });
    const right = await vscode.workspace.openTextDocument({ language: lang, content: op.after ?? '' });
    const label = op.kind === 'add' ? 'create' : op.kind === 'delete' ? 'delete' : 'modify';
    await vscode.commands.executeCommand('vscode.diff', left.uri, right.uri, `${title}: ${label} ${rel}`);
  }
  if (ops.length > shown.length) {
    void vscode.window.showInformationMessage(`Showing ${shown.length} of ${ops.length} proposed file diffs.`);
  }
  // Referenced so a future absolute-path resolver keeps a stable signature.
  void rootPath;
}

function languageForPath(p: string): string {
  const ext = path.extname(p).toLowerCase();
  switch (ext) {
    case '.ts': case '.tsx': return 'typescript';
    case '.js': case '.jsx': case '.mjs': case '.cjs': return 'javascript';
    case '.json': return 'json';
    case '.md': return 'markdown';
    case '.css': return 'css';
    case '.html': return 'html';
    case '.py': return 'python';
    case '.sh': return 'shellscript';
    case '.yml': case '.yaml': return 'yaml';
    default: return 'plaintext';
  }
}
