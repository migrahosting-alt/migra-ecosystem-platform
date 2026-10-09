import * as vscode from 'vscode';
import { isAbsolute, relative } from 'node:path';
import { assertCandidateBase, type ValidationRecord } from '@migrapilot/workspace-tools';
import { candidateScriptChoices, validateCandidate, verifyAppliedChangeset, type WorkspaceVerification } from './candidateWorkflow.js';
import { previewAndMaybeApplyChangeset, type ChangesetProposal } from './proposedChangeset.js';
import type { MigraAiClient } from './migraAiClient.js';
import { createVscodeWorkspaceHost } from './vscodeWorkspaceHost.js';
import { candidateHasDependencies } from './candidateDependencies.js';

function assertWorkspaceReady(rootPath: string): void {
  if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace explicitly before executing repository checks.');
  const dirty = vscode.workspace.textDocuments.some(document => {
    const path = relative(rootPath, document.uri.fsPath);
    return document.isDirty && document.uri.scheme === 'file' && !isAbsolute(path) && path !== '..' && !path.replace(/\\/g, '/').startsWith('../');
  });
  if (dirty) throw new Error('Save or revert workspace editor changes before executing repository checks.');
}

export interface CandidateApplyOutcome {
  applied: boolean;
  proposal?: ChangesetProposal;
  records?: ValidationRecord[];
  repairAttempts?: number;
  message?: string;
  workspaceVerification?: WorkspaceVerification;
}

export async function verifyAppliedChangesetVscode(
  rootPath: string, proposal: ChangesetProposal, signal?: AbortSignal, selectedScript?: string,
): Promise<WorkspaceVerification> {
  const records: ValidationRecord[] = [];
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const cancelled = new Promise<undefined>(resolve => controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }));
  const race = <T>(promise: Thenable<T>): Promise<T | undefined> => Promise.race([Promise.resolve(promise), cancelled]);
  try {
    if (controller.signal.aborted) return { status: 'cancelled', records: [], message: 'Original-workspace verification cancelled. Applied edits remain.' };
    assertWorkspaceReady(rootPath);
    const choices = candidateScriptChoices(rootPath);
    if (!choices.length) throw new Error('No declared validation script is available. Add an actual project check before verifying applied changes.');
    const script = selectedScript ?? await race(vscode.window.showQuickPick(choices, {
      title: 'MigraPilot — choose the original-workspace check',
      placeHolder: 'Run an existing project script on the applied files, not in a candidate.',
    }));
    if (!script || controller.signal.aborted) return {
      status: controller.signal.aborted ? 'cancelled' : 'declined', records: [],
      message: 'Original-workspace verification did not run. Applied edits remain unverified.',
    };
    const result = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: 'MigraPilot original-workspace verification', cancellable: true,
    }, async (_progress, token) => {
      const cancellation = token.onCancellationRequested(abort);
      try {
        return await verifyAppliedChangeset({
          rootPath, proposal, script, signal: controller.signal,
          onRecord: record => records.push(record),
          requestConsent: async plan => {
            const decision = await race(vscode.window.showWarningMessage(
              `Run ${plan.command.join(' ')} (${plan.script}) on the ORIGINAL workspace ${rootPath} with the applied changes in ${plan.paths.join(', ')}? `
              + `${plan.timeoutMs / 1000}s limit. This executes repository code locally, can write files, and is NOT an OS/network sandbox. `
              + 'No edits will be reapplied or automatically rolled back. Passing this check is not product/owner acceptance.',
              { modal: true }, 'Run original check',
            ));
            assertWorkspaceReady(rootPath);
            return decision === 'Run original check' && !controller.signal.aborted;
          },
        });
      } finally { cancellation.dispose(); }
    });
    if (result.status !== 'passed') void vscode.window.showWarningMessage(`MigraPilot: ${result.message}`);
    return result;
  } catch (error) {
    const message = `${error instanceof Error ? error.message : String(error)} Applied edits remain unverified.`;
    void vscode.window.showWarningMessage(`MigraPilot: ${message}`);
    return { status: controller.signal.aborted ? 'cancelled' : 'unavailable', records, message };
  } finally { signal?.removeEventListener('abort', abort); }
}

export async function validateAndApplyChangeset(
  client: MigraAiClient, rootPath: string, proposal: ChangesetProposal, goal: string,
  signal?: AbortSignal,
): Promise<CandidateApplyOutcome> {
  const records: ValidationRecord[] = [];
  let applied = false;
  let finalProposal: ChangesetProposal | undefined;
  let repairAttempts: number | undefined;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const cancelled = new Promise<undefined>(resolve => controller.signal.addEventListener('abort', () => resolve(undefined), { once: true }));
  const race = <T>(promise: Thenable<T>): Promise<T | undefined> => Promise.race([Promise.resolve(promise), cancelled]);
  try {
    if (controller.signal.aborted) return { applied: false };
    assertWorkspaceReady(rootPath);
    createVscodeWorkspaceHost().assertCanApply?.(rootPath, proposal.ops.flatMap(op => op.path ? [op.path] : []));
    const choices = candidateScriptChoices(rootPath);
    if (!choices.length) throw new Error('No declared validation script is available. Add an actual project check before using Validate & apply.');
    const script = await race(vscode.window.showQuickPick(choices, {
      title: 'MigraPilot — choose the declared candidate check',
      placeHolder: 'Only this project script will execute; no arbitrary shell commands.',
    }));
    if (!script || controller.signal.aborted) return { applied: false };
    let prepareDependencies = false;
    if (candidateHasDependencies(rootPath)) {
      const preparation = await race(vscode.window.showQuickPick([
        'Prepare locked dependencies (install scripts disabled)',
        'Check without dependency preparation',
      ], { title: 'MigraPilot — candidate dependency preparation', placeHolder: 'Only the detached candidate can be installed; original dependencies are untouched.' }));
      if (!preparation || controller.signal.aborted) return { applied: false };
      prepareDependencies = preparation === 'Prepare locked dependencies (install scripts disabled)';
    }
    const candidate = await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: 'MigraPilot candidate validation', cancellable: true,
    }, async (progress, token) => {
      const cancellation = token.onCancellationRequested(abort);
      try {
        return await validateCandidate(client, {
          rootPath, proposal, script, goal, prepareDependencies, signal: controller.signal,
          onRecord: record => records.push(record),
          requestConsent: async plan => {
            const decision = await race(vscode.window.showWarningMessage(
              `Run ${plan.command.join(' ')} (${plan.script}) in a detached candidate from a clean committed base? `
              + `Allow up to ${plan.maxRepairs} evidence-driven repairs within ${plan.paths.join(', ')}; `
              + `${plan.timeoutMs / 1000}s per check. Repository/candidate code executes locally. `
              + (plan.preparation
                ? `First run ${plan.preparation.command.join(' ')} in the candidate only (${plan.preparation.timeoutMs / 1000}s limit); packages may download, install lifecycle scripts are disabled, no ambient registry credentials are used. Manifest/lock/archive fingerprint: ${plan.preparation.fingerprint}. `
                : 'No dependency preparation will run. ')
              + 'This is file isolation, NOT an OS/network sandbox. Original files stay unchanged until fresh final-diff approval.',
              { modal: true }, 'Run candidate checks',
            ));
            assertWorkspaceReady(rootPath);
            return decision === 'Run candidate checks' && !controller.signal.aborted;
          },
          onProgress: message => progress.report({ message }),
        });
      } finally { cancellation.dispose(); }
    });
    if (controller.signal.aborted) return { applied: false };
    finalProposal = candidate.proposal;
    repairAttempts = candidate.repairAttempts;
    applied = await previewAndMaybeApplyChangeset(client, rootPath, candidate.proposal, 'Validated candidate — review final diff', {
      signal: controller.signal,
      beforeApply: () => { assertCandidateBase(rootPath, candidate.baseCommit); },
    });
    const workspaceVerification = applied
      ? await verifyAppliedChangesetVscode(rootPath, candidate.proposal, controller.signal, candidate.script)
      : undefined;
    return { applied, proposal: candidate.proposal, records: candidate.records, repairAttempts: candidate.repairAttempts, workspaceVerification };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showWarningMessage(`MigraPilot candidate validation stopped: ${message}`);
    return { applied, proposal: finalProposal, repairAttempts, records, message,
      ...(applied ? { workspaceVerification: { status: 'unavailable' as const, records: [], message } } : {}) };
  } finally {
    signal?.removeEventListener('abort', abort);
  }
}
