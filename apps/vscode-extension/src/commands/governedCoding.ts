// MigraPilot — `MigraPilot: Governed Coding Change`.
//
// The editor-facing surface. It owns windows, prompts and buttons; it owns no
// judgement about what a run did. Every label it renders comes from
// codingSurfaceModel, which computes from the Brain snapshot alone.
//
// Two rules that are easy to get wrong and are enforced here:
//
//   THE WORKSPACE IS RESOLVED, NEVER TYPED. The issue text is free-form; the path
//   is not. A user cannot type a workspace root into this command, because a path
//   accepted from free text is an access-control decision made by whoever is
//   typing. VS Code resolves the active folder, and the Brain still enforces its
//   own configured boundary on top.
//
//   CLOSING THE PANEL IS NOT CANCELLING. Dismissing a progress notification stops
//   the extension watching; it does not stop the run, and it must never report
//   that it did. Cancellation is an explicit control with its own durable answer.

import * as vscode from 'vscode';
import type { CodingRunClient, CodingRunSnapshot } from '../services/codingRunClient.js';
import { runCodingWorkflow, requestCodingCancellation, type CodingWorkflowUi } from '../services/codingWorkflow.js';
import {
  approvalDocument,
  childViews,
  decideReload,
  finalReportDocument,
  phaseView,
} from '../services/codingSurfaceModel.js';

/** Remembered so a window reload can ask the Brain what happened. */
export const ACTIVE_CODING_RUN_KEY = 'migrapilot.governedCoding.activeRunId';

async function showMarkdown(title: string, body: string): Promise<void> {
  const doc = await vscode.workspace.openTextDocument({ content: body, language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
  void title;
}

/** The active folder, or a refusal. Never read from user input. */
export function resolveWorkspaceRoot(): { ok: true; root: string } | { ok: false; message: string } {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return { ok: false, message: 'Open a folder before starting a governed coding change.' };
  if (folders.length > 1) {
    // Ambiguity is refused rather than guessed: picking one of several roots on
    // the user's behalf decides where writes may land.
    return { ok: false, message: 'This workspace has multiple folders. Open a single-folder workspace to run a governed coding change.' };
  }
  return { ok: true, root: folders[0]!.uri.fsPath };
}

export function registerGovernedCodingCommand(
  context: vscode.ExtensionContext,
  client: CodingRunClient,
  log: (message: string) => void,
): vscode.Disposable {
  return vscode.commands.registerCommand('migrapilot.governedCoding', async () => {
    const capability = await client.getCodingCapability();
    if (capability.kind !== 'ok') {
      void vscode.window.showWarningMessage(
        capability.kind === 'capability_unavailable'
          ? `Governed coding is not available: ${capability.detail}`
          : `Could not reach the MigraPilot Brain: ${describe(capability)}`,
      );
      return;
    }
    if (!capability.value.available) {
      void vscode.window.showWarningMessage(`Governed coding is not enabled on this Brain: ${capability.value.unavailableReason ?? 'unavailable'}`);
      return;
    }

    const workspace = resolveWorkspaceRoot();
    if (!workspace.ok) {
      void vscode.window.showWarningMessage(workspace.message);
      return;
    }

    const issueText = await vscode.window.showInputBox({
      title: 'Governed coding change',
      prompt: 'Describe the problem in behavioural terms. MigraPilot will propose a file scope for your approval before writing anything.',
      placeHolder: 'e.g. Cancelled line items are still counted in the order total.',
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim().length < 12 ? 'Describe the issue in a little more detail.' : undefined),
    });
    if (!issueText?.trim()) return;

    let activeRunId: string | undefined;
    let latest: CodingRunSnapshot | undefined;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'MigraPilot: governed coding change', cancellable: true },
      async (progress, token) => {
        // The token means "stop watching". Whether the RUN stops is a separate,
        // durable question answered by the Brain — see the cancellation block.
        const watching = new AbortController();
        token.onCancellationRequested(() => watching.abort());

        const ui: CodingWorkflowUi = {
          async requestScopeApproval(request) {
            activeRunId = request.runId;
            await context.globalState.update(ACTIVE_CODING_RUN_KEY, request.runId);
            const document = approvalDocument(request);
            await showMarkdown(document.title, document.markdown);
            const choice = await vscode.window.showWarningMessage(
              document.title,
              { modal: true, detail: document.modalDetail },
              'Approve scope',
              'Reject',
            );
            if (choice === 'Approve scope') return 'approve';
            if (choice === 'Reject') return 'reject';
            return undefined;
          },
          onProgress(snapshot) {
            latest = snapshot;
            activeRunId = snapshot.runId;
            void context.globalState.update(ACTIVE_CODING_RUN_KEY, snapshot.runId);
            const view = phaseView(snapshot);
            const children = childViews(snapshot).filter((c) => c.outcome !== 'pending');
            const done = children.filter((c) => c.outcome === 'succeeded').length;
            progress.report({ message: `${view.label}${children.length ? ` — ${done}/${children.length} steps complete` : ''}` });
          },
          onFinalReport(snapshot) { latest = snapshot; },
          onProblem(problem) {
            log(`governed-coding: ${problem.title} — ${problem.detail}`);
            if (!problem.recoverable) void vscode.window.showErrorMessage(`${problem.title}. ${problem.detail}`);
          },
        };

        const outcome = await runCodingWorkflow(client, {
          issueText: issueText.trim(),
          workspaceRoot: workspace.root,
          ui,
          signal: watching.signal,
          isDisposed: () => watching.signal.aborted,
        });

        // ── the user pressed the notification's Cancel ────────────────────────
        if (token.isCancellationRequested && activeRunId && latest && latest.phase !== 'terminal') {
          const choice = await vscode.window.showWarningMessage(
            'Stop watching, or cancel the run?',
            { modal: true, detail: 'Closing this notification stops MigraPilot watching the run. The run itself keeps going on the Brain unless you cancel it.' },
            'Cancel the run',
            'Just stop watching',
          );
          if (choice === 'Cancel the run') {
            const result = await requestCodingCancellation(client, activeRunId, latest.revision);
            // The label is the Brain's answer, never the button press.
            void vscode.window.showInformationMessage(`MigraPilot: ${result.label}`);
          }
          return;
        }

        if (outcome.kind === 'unavailable') { void vscode.window.showWarningMessage(`Governed coding is unavailable: ${outcome.detail}`); return; }
        if (outcome.kind === 'dismissed') return;
        if (outcome.kind === 'problem') { void vscode.window.showErrorMessage(`MigraPilot could not complete the run: ${outcome.detail}`); }

        const snapshot = 'snapshot' in outcome ? outcome.snapshot : latest;
        if (!snapshot) return;
        await showMarkdown('Governed coding report', finalReportDocument(snapshot));
        await offerFollowUp(snapshot, workspace.root);
      },
    );
  });
}

/** Post-run actions. Deliberately narrow — no unrestricted terminal shortcut. */
async function offerFollowUp(snapshot: CodingRunSnapshot, root: string): Promise<void> {
  const changed = snapshot.finalReport?.changedFiles ?? [];
  if (!changed.length) return;
  const choice = await vscode.window.showInformationMessage(
    `MigraPilot changed ${changed.length} file(s).`,
    'Open changed files',
    'Open Source Control',
  );
  if (choice === 'Open changed files') {
    for (const rel of changed.slice(0, 10)) {
      const uri = vscode.Uri.joinPath(vscode.Uri.file(root), rel);
      const doc = await vscode.workspace.openTextDocument(uri).then((d) => d, () => undefined);
      if (doc) await vscode.window.showTextDocument(doc, { preview: false });
    }
  } else if (choice === 'Open Source Control') {
    await vscode.commands.executeCommand('workbench.view.scm');
  }
}

/**
 * Restore a remembered run after a window reload.
 *
 * The extension restarting says NOTHING about the run, so this always asks the
 * Brain. A missing run and an unavailable capability are reported differently
 * because they lead a user to entirely different actions.
 */
export async function restoreGovernedCodingRun(
  context: vscode.ExtensionContext,
  client: CodingRunClient,
  log: (message: string) => void,
): Promise<void> {
  const storedRunId = context.globalState.get<string>(ACTIVE_CODING_RUN_KEY);
  if (!storedRunId) return;

  const capability = await client.getCodingCapability();
  const lookup = await client.getCodingRun(storedRunId);
  const decision = decideReload({
    storedRunId,
    ...(capability.kind === 'ok' ? { capability: capability.value } : {}),
    lookup:
      lookup.kind === 'ok' ? { kind: 'ok', value: lookup.value }
        : lookup.kind === 'not_found' ? { kind: 'not_found' }
          : lookup.kind === 'corrupt' ? { kind: 'corrupt', detail: lookup.corruption.detail }
            : lookup.kind === 'capability_unavailable' ? { kind: 'capability_unavailable', detail: lookup.detail }
              : { kind: 'other', detail: describe(lookup) },
  });

  switch (decision.kind) {
    case 'show_final':
      await context.globalState.update(ACTIVE_CODING_RUN_KEY, undefined);
      await showMarkdown('Governed coding report', finalReportDocument(decision.snapshot));
      break;
    case 'restore_approval':
      await vscode.window.showInformationMessage(
        `MigraPilot has a coding run awaiting your approval (${phaseView(decision.snapshot).label}).`,
        'Review scope',
      ).then(async (choice) => {
        if (choice === 'Review scope') await vscode.commands.executeCommand('migrapilot.governedCoding.resume', decision.snapshot.runId);
      });
      break;
    case 'restore_progress':
      void vscode.window.showInformationMessage(`MigraPilot coding run is still ${phaseView(decision.snapshot).label.toLowerCase()}.`);
      break;
    case 'run_missing':
      await context.globalState.update(ACTIVE_CODING_RUN_KEY, undefined);
      log(`governed-coding: remembered run ${storedRunId} is no longer known to the Brain.`);
      break;
    case 'capability_unavailable':
      log(`governed-coding: capability unavailable on reload — ${decision.detail}`);
      break;
    case 'unreadable':
      void vscode.window.showErrorMessage(`MigraPilot: a previous coding run's record cannot be read. ${decision.detail}`);
      break;
    case 'unknown':
      log(`governed-coding: could not restore run ${storedRunId} — ${decision.detail}`);
      break;
    case 'nothing_to_restore':
      break;
  }
}

function describe(result: { kind: string; detail?: string; message?: string; status?: number }): string {
  return result.message ?? result.detail ?? (result.status ? `${result.kind} (${result.status})` : result.kind);
}
