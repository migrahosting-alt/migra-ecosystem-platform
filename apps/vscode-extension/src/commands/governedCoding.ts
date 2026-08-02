// MigraPilot — `MigraPilot: Governed Coding Change`.
//
// The editor-facing surface. It owns sequencing and workspace resolution; it owns
// no judgement about what a run did, and it no longer reaches for global dialog
// functions. Every point where it waits on a PERSON goes through the injected
// `GovernedCodingUi`, which is what lets the packaged acceptance drive this exact
// command with scripted answers.
//
// Two rules enforced rather than documented:
//
//   THE WORKSPACE IS RESOLVED, NEVER TYPED. Issue text is free-form; the path is
//   not. A path accepted from free text is an access-control decision made by
//   whoever is typing. VS Code resolves the active folder and the Brain still
//   enforces its own configured boundary on top.
//
//   CLOSING THE PANEL IS NOT CANCELLING. Dismissing the notification stops the
//   extension watching; the run continues on the Brain. Cancellation is an explicit
//   choice with its own durable answer, and `dismiss` is a distinct outcome from
//   `reject` throughout.

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
import {
  GovernedCodingUiHolder,
  UiAdapterError,
  guardUi,
  type GovernedCodingUi,
} from '../services/governedCodingUi.js';
import { createVscodeGovernedCodingUi } from '../services/governedCodingUiVscode.js';

/** Remembered so a window reload can ask the Brain what happened. */
export const ACTIVE_CODING_RUN_KEY = 'migrapilot.governedCoding.activeRunId';

export interface GovernedCodingCommandDeps {
  client: CodingRunClient;
  log(message: string): void;
  /** Overridden only by the packaged acceptance. Production installs the VS Code
   * adapter and nothing replaces it. */
  uiHolder?: GovernedCodingUiHolder;
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
  deps: GovernedCodingCommandDeps,
): { disposable: vscode.Disposable; uiHolder: GovernedCodingUiHolder } {
  const uiHolder = deps.uiHolder ?? new GovernedCodingUiHolder((progress) => createVscodeGovernedCodingUi(progress as never));

  const disposable = vscode.commands.registerCommand('migrapilot.governedCoding', async () => {
    const client = deps.client;
    const baseUi = guardUi(uiHolder.create());

    const capability = await client.getCodingCapability();
    if (capability.kind !== 'ok') {
      await baseUi.showError({
        title: 'Governed coding is not available',
        detail: capability.kind === 'capability_unavailable' ? capability.detail : describe(capability),
        recoverable: true,
      });
      return;
    }
    if (!capability.value.available) {
      await baseUi.showError({ title: 'Governed coding is not enabled on this Brain', detail: capability.value.unavailableReason ?? 'unavailable', recoverable: true });
      return;
    }

    const workspace = resolveWorkspaceRoot();
    if (!workspace.ok) {
      await baseUi.showError({ title: 'No single workspace folder', detail: workspace.message, recoverable: true });
      return;
    }

    const issueText = await baseUi.requestIssueText();
    // Abandoning the prompt starts nothing. There is no run to cancel, reject or
    // report, and creating one would leave a durable record of a request nobody made.
    if (!issueText?.trim()) return;

    let activeRunId: string | undefined;
    let latest: CodingRunSnapshot | undefined;

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'MigraPilot: governed coding change', cancellable: true },
      async (progress, token) => {
        // Inside the progress scope the UI can report through it. A scripted UI
        // ignores the progress handle entirely.
        const ui = guardUi(uiHolder.create(progress));

        // The token means "stop watching". Whether the RUN stops is a separate,
        // durable question answered by the Brain.
        const watching = new AbortController();
        token.onCancellationRequested(() => watching.abort());

        const workflowUi: CodingWorkflowUi = {
          async requestScopeApproval(request) {
            activeRunId = request.runId;
            await context.globalState.update(ACTIVE_CODING_RUN_KEY, request.runId);
            const document = approvalDocument(request);
            const answer = await ui.presentScopeApproval({
              runId: request.runId,
              revision: request.revision,
              pathSetHash: request.pathSetHash,
              expiresAt: request.expiresAt,
              ...(request.issueSummary ? { issueSummary: request.issueSummary } : {}),
              files: request.files,
              excluded: request.excluded,
              supersededPreviousProposal: request.supersededPreviousProposal === true,
              title: document.title,
              markdown: document.markdown,
              modalDetail: document.modalDetail,
            });
            // `dismiss` is NOT a rejection — returning undefined leaves the run
            // awaiting a decision nobody made.
            return answer === 'dismiss' ? undefined : answer;
          },
          onProgress(snapshot) {
            latest = snapshot;
            activeRunId = snapshot.runId;
            void context.globalState.update(ACTIVE_CODING_RUN_KEY, snapshot.runId);
            const view = phaseView(snapshot);
            void ui.showProgress({
              runId: snapshot.runId,
              revision: snapshot.revision,
              phaseLabel: view.label,
              busy: view.busy,
              steps: childViews(snapshot),
            });
          },
          onFinalReport(snapshot) { latest = snapshot; },
          onProblem(problem) {
            deps.log(`governed-coding: ${problem.title} — ${problem.detail}`);
            if (!problem.recoverable) void ui.showError(problem);
          },
        };

        try {
          const outcome = await runCodingWorkflow(client, {
            issueText: issueText.trim(),
            workspaceRoot: workspace.root,
            ui: workflowUi,
            signal: watching.signal,
            isDisposed: () => watching.signal.aborted,
          });

          if (token.isCancellationRequested && activeRunId && latest && latest.phase !== 'terminal') {
            const answer = await ui.presentCancellationChoice();
            if (answer === 'cancel-run') {
              const result = await requestCodingCancellation(client, activeRunId, latest.revision);
              // The label is the Brain's answer, never the button press.
              deps.log(`governed-coding: ${result.label}`);
              await ui.showError({ title: 'MigraPilot', detail: result.label, recoverable: true });
            }
            return;
          }

          if (outcome.kind === 'unavailable') { await ui.showError({ title: 'Governed coding is unavailable', detail: outcome.detail, recoverable: true }); return; }
          if (outcome.kind === 'dismissed') return;
          if (outcome.kind === 'problem') await ui.showError({ title: 'MigraPilot could not complete the run', detail: outcome.detail, recoverable: false });

          const snapshot = 'snapshot' in outcome ? outcome.snapshot : latest;
          if (!snapshot) return;
          await ui.showFinalReport(finalReportView(snapshot));
        } catch (error) {
          // A broken dialog surface is an explicit command failure, never a silent
          // dismissal — "the surface broke" and "the operator closed it" lead to
          // opposite conclusions about whether anyone decided anything.
          const detail = error instanceof UiAdapterError ? error.message : error instanceof Error ? error.message : String(error);
          deps.log(`governed-coding: ${detail}`);
          void vscode.window.showErrorMessage(`MigraPilot: ${detail}`);
        }
      },
    );
  });

  return { disposable, uiHolder };
}

export function finalReportView(snapshot: CodingRunSnapshot): {
  runId: string; revision: number; state: string; complete: boolean; changedFiles: string[]; markdown: string;
} {
  return {
    runId: snapshot.runId,
    revision: snapshot.revision,
    state: snapshot.state,
    // Read from the Brain's record. The extension never computes completion.
    complete: snapshot.finalReport?.complete === true,
    changedFiles: [...(snapshot.finalReport?.changedFiles ?? [])],
    markdown: finalReportDocument(snapshot),
  };
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
  ui?: GovernedCodingUi,
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
  const surface = ui ? guardUi(ui) : undefined;

  switch (decision.kind) {
    case 'show_final':
      await context.globalState.update(ACTIVE_CODING_RUN_KEY, undefined);
      if (surface) await surface.showFinalReport(finalReportView(decision.snapshot));
      log(`governed-coding: restored terminal run ${storedRunId} (${decision.snapshot.state})`);
      break;
    case 'restore_approval':
      log(`governed-coding: run ${storedRunId} is awaiting approval`);
      if (surface) await surface.showError({ title: 'A coding run is awaiting your approval', detail: phaseView(decision.snapshot).label, recoverable: true });
      break;
    case 'restore_progress':
      log(`governed-coding: run ${storedRunId} is still ${phaseView(decision.snapshot).label.toLowerCase()}`);
      break;
    case 'run_missing':
      await context.globalState.update(ACTIVE_CODING_RUN_KEY, undefined);
      log(`governed-coding: remembered run ${storedRunId} is no longer known to the Brain.`);
      break;
    case 'capability_unavailable':
      log(`governed-coding: capability unavailable on reload — ${decision.detail}`);
      break;
    case 'unreadable':
      log(`governed-coding: run ${storedRunId} has an unreadable durable record — ${decision.detail}`);
      if (surface) await surface.showError({ title: 'A previous coding run’s record cannot be read', detail: decision.detail, recoverable: false });
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
