import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import type { ProposedEdit } from '@migrapilot/shared-types';
import type {
  EditApplyResponse,
  EditPreviewResponse,
} from '@migrapilot/protocol';
import { MigraAiClient } from './migraAiClient.js';
import { isPilotError, toUserMessage } from '@migrapilot/pilot-client';
import { verifyEditsApplied } from './editVerification.js';

type ToolEditChange = {
  path: string;
  startLine: number;
  endLine: number;
  replacement: string;
};

/**
 * Preview a set of proposed edits and, on user confirmation, apply them — ALL
 * through the MigraAI Engine's capability boundary (`edit.apply`). The engine
 * owns the approval lifecycle: the first (approval-less) call mints a single-use
 * token bound to the exact input and returns a preview; the confirmed second call
 * consumes that token to execute exactly once (replay-refused). The extension
 * never calls `edit.*` directly and preserves the read-back verification.
 */
export async function previewAndMaybeApplyProposedEdits(
  migraAi: MigraAiClient,
  rootPath: string,
  edits: readonly ProposedEdit[],
  title: string,
): Promise<boolean> {
  if (!edits.length) {
    return false;
  }

  const changes = edits.map((edit) => ({
    path: toRelativeWorkspacePath(rootPath, edit.path),
    startLine: edit.replacementRange.startLine,
    endLine: edit.replacementRange.endLine,
    replacement: edit.newText,
  }));
  const input = { rootPath, changes };

  // Approval-less call → engine mints a single-use token + returns the preview.
  let approvalId: string;
  let previewResult: EditPreviewResponse;
  try {
    const minted = await migraAi.executeTool({ tool: 'edit.apply', input });
    if (minted.status !== 'approval_required') {
      return false;
    }
    approvalId = minted.approvalId;
    previewResult = minted.preview as EditPreviewResponse;
  } catch (error) {
    await surfaceToolError(error);
    return false;
  }

  await showPreview(rootPath, title, previewResult);

  const choice = await vscode.window.showInformationMessage(
    previewResult.files.length === 1
      ? `MigraPilot prepared a patch preview for ${previewResult.files[0]?.path}.`
      : `MigraPilot prepared ${previewResult.files.length} patch previews.`,
    'Apply Patch',
    'Dismiss',
  );

  if (choice !== 'Apply Patch') {
    return false;
  }

  const dirtyPath = firstDirtyPath(rootPath, changes);
  if (dirtyPath) {
    await vscode.window.showWarningMessage(
      `Save or revert local editor changes before applying MigraPilot edits to ${dirtyPath}.`,
    );
    return false;
  }

  // Confirmed → consume the token; the engine executes exactly once.
  let applyResult: EditApplyResponse;
  try {
    const applied = await migraAi.executeTool({ tool: 'edit.apply', input, approvalId });
    if (applied.status !== 'executed') {
      return false;
    }
    applyResult = applied.result as EditApplyResponse;
  } catch (error) {
    await surfaceToolError(error);
    return false;
  }

  const changedCount = applyResult.files.filter((file) => file.changed).length;

  // Read back the workspace: verify the edits actually landed rather than
  // trusting the apply response (P3 invariant). Only non-empty replacements are
  // verifiable by substring; deletions/whitespace-only edits are skipped.
  const expectations = changes
    .filter((c) => c.replacement.trim().length > 0)
    .map((c) => ({ path: c.path, expectedSubstring: c.replacement.trim() }));
  const verification = await verifyEditsApplied(expectations, (relPath) =>
    readFile(path.resolve(rootPath, relPath), 'utf8'),
  );

  if (!verification.verified) {
    await vscode.window.showWarningMessage(
      verification.failures.length === 1
        ? `MigraPilot could not verify the edit to ${verification.failures[0]}. Review the file before relying on it.`
        : `MigraPilot could not verify edits to ${verification.failures.length} files. Review them before relying on them.`,
    );
    return false;
  }

  await vscode.window.showInformationMessage(
    changedCount === 1
      ? 'MigraPilot applied and verified 1 patch.'
      : `MigraPilot applied and verified ${changedCount} patches.`,
  );

  return changedCount > 0;
}

async function surfaceToolError(error: unknown): Promise<void> {
  const code = isPilotError(error) ? error.code : 'SERVER_ERROR';
  const message = toUserMessage(code) || 'MigraPilot could not apply the edit.';
  await vscode.window.showWarningMessage(message);
}

function toRelativeWorkspacePath(rootPath: string, filePath: string): string {
  const absolutePath = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(rootPath, filePath);
  const relativePath = path.relative(path.resolve(rootPath), absolutePath).replace(/\\/g, '/');

  if (!relativePath || relativePath.startsWith('..')) {
    throw new Error(`Proposed edit path is outside the workspace: ${filePath}`);
  }

  return relativePath;
}

function firstDirtyPath(rootPath: string, changes: readonly ToolEditChange[]): string | null {
  for (const change of changes) {
    const absolutePath = path.resolve(rootPath, change.path);
    const document = vscode.workspace.textDocuments.find(
      (item) => item.uri.scheme === 'file' && path.resolve(item.uri.fsPath) === absolutePath,
    );

    if (document?.isDirty) {
      return change.path;
    }
  }

  return null;
}

async function showPreview(
  rootPath: string,
  title: string,
  preview: EditPreviewResponse,
): Promise<void> {
  if (preview.files.length === 1) {
    const file = preview.files[0]!;
    const originalUri = vscode.Uri.file(path.resolve(rootPath, file.path));
    const originalDocument = await vscode.workspace.openTextDocument(originalUri);
    const previewDocument = await vscode.workspace.openTextDocument({
      language: originalDocument.languageId,
      content: file.after,
    });

    await vscode.commands.executeCommand(
      'vscode.diff',
      originalUri,
      previewDocument.uri,
      `${title}: ${file.path}`,
    );
    return;
  }

  const document = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: [
      `# ${title}`,
      '',
      ...preview.files.map((file) => `- ${file.path}`),
    ].join('\n'),
  });
  await vscode.window.showTextDocument(document, { preview: true });
}