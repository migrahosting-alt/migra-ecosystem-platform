// MigraPilot — the real VS Code implementation of the governed coding UI.
//
// The ONLY file in this feature that touches `vscode.window` dialogs. Everything
// above it works against the typed interface, which is what lets the packaged
// acceptance drive the real command with scripted answers instead of trying to
// intercept a namespace it cannot replace.
//
// Each method converts a VS Code result into exactly one typed outcome. The
// conversions are the point: `showWarningMessage` answers `string | undefined`,
// and mapping `undefined` onto anything but `dismiss` would turn a closed dialog
// into a decision the operator never made.

import * as vscode from 'vscode';
import type {
  CancellationAnswer,
  CodingErrorViewModel,
  CodingFinalReportViewModel,
  CodingProgressViewModel,
  GovernedCodingUi,
  ScopeApprovalAnswer,
  ScopeApprovalViewModel,
} from './governedCodingUi.js';

async function showMarkdown(body: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content: body, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
}

export function createVscodeGovernedCodingUi(progress?: vscode.Progress<{ message?: string }>): GovernedCodingUi {
  return {
    async requestIssueText(): Promise<string | undefined> {
      const value = await vscode.window.showInputBox({
        title: 'MigraPilot: Governed Coding Change',
        prompt: 'Describe the problem in behavioural terms. MigraPilot proposes a file scope for your approval before writing anything.',
        placeHolder: 'e.g. Cancelled line items are still counted in the order total.',
        ignoreFocusOut: true,
        validateInput: (input) => (input.trim().length < 12 ? 'Describe the issue in a little more detail.' : undefined),
      });
      return value?.trim() ? value.trim() : undefined;
    },

    async presentScopeApproval(model: ScopeApprovalViewModel): Promise<ScopeApprovalAnswer> {
      // The document carries the evidence; the modal carries the exact paths, so a
      // decision is never made from a title alone.
      await showMarkdown(model.markdown);
      const choice = await vscode.window.showWarningMessage(
        model.title,
        { modal: true, detail: model.modalDetail },
        'Approve scope',
        'Reject',
      );
      if (choice === 'Approve scope') return 'approve';
      if (choice === 'Reject') return 'reject';
      return 'dismiss';
    },

    async presentCancellationChoice(): Promise<CancellationAnswer> {
      const choice = await vscode.window.showWarningMessage(
        'Stop watching, or cancel the run?',
        { modal: true, detail: 'Closing this notification stops MigraPilot watching the run. The run itself keeps going on the Brain unless you cancel it.' },
        'Cancel the run',
        'Just stop watching',
      );
      if (choice === 'Cancel the run') return 'cancel-run';
      if (choice === 'Just stop watching') return 'stop-watching';
      return 'dismiss';
    },

    async showProgress(model: CodingProgressViewModel): Promise<void> {
      const resolved = model.steps.filter((s) => s.outcome !== 'pending');
      const done = resolved.filter((s) => s.outcome === 'succeeded').length;
      progress?.report({ message: `${model.phaseLabel}${resolved.length ? ` — ${done}/${resolved.length} steps complete` : ''}` });
    },

    async showFinalReport(model: CodingFinalReportViewModel): Promise<void> {
      await showMarkdown(model.markdown);
    },

    async showError(model: CodingErrorViewModel): Promise<void> {
      // Fire-and-forget: awaiting the result would leave the command pending until
      // the toast is dismissed (see the repo's notification-awaits guard).
      if (model.recoverable) void vscode.window.showWarningMessage(`${model.title}. ${model.detail}`);
      else void vscode.window.showErrorMessage(`${model.title}. ${model.detail}`);
    },
  };
}
