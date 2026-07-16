import * as vscode from 'vscode';
import { ApprovalsClient, approveResumeAndReconcile } from '@migrapilot/pilot-client';
import { renderActionConsent } from '../services/approvalDelta.js';
import { newRequestId } from '@migrapilot/pilot-client';
import { CAP_APPROVALS, evaluateCapability } from '../services/commandCapabilities.js';
import { type CommandDeps, surfacePilotError, withCancellableProgress } from './commandRouting.js';

// Minimal, lifecycle-accurate approval review. Deliberately NOT a card redesign
// (P4 defers UI hardening): it lists PENDING actions and offers approve/reject
// on the exact stored action, then approves→resumes→reconciles. Approve/reject
// are only offered for PENDING; terminal/approved actions are shown read-only.

export async function runReviewApprovals(deps: CommandDeps): Promise<void> {
  const backend = deps.router.current() ?? (await deps.router.resolve());
  if (backend.kind === 'local') {
    await vscode.window.showInformationMessage('Approvals require pilot-api (remote) mode.');
    return;
  }
  const gate = evaluateCapability(backend, CAP_APPROVALS);
  if (gate.mode === 'denied') {
    await surfacePilotError(deps.output, gate.error, newRequestId());
    return;
  }

  const approvals = new ApprovalsClient(deps.pilot);
  let actions;
  try {
    actions = await approvals.list();
  } catch (err) {
    await surfacePilotError(deps.output, err, newRequestId());
    return;
  }

  const pending = actions.filter((a) => a.state === 'PENDING');
  if (pending.length === 0) {
    await vscode.window.showInformationMessage('MigraPilot: no pending actions to review.');
    return;
  }

  const pick = await vscode.window.showQuickPick(
    pending.map((a) => ({ label: a.summary ?? a.actionId, description: a.state, actionId: a.actionId })),
    { title: 'MigraPilot: pending actions', placeHolder: 'Select an action to review' },
  );
  if (!pick) {
    return;
  }

  // Show the exact delta (filtered, redacted) as a read-only consent view before
  // asking for a decision. Internal identifiers are never rendered.
  const selected = pending.find((a) => a.actionId === pick.actionId);
  if (selected?.change) {
    const doc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: `# Review pending action\n\n${renderActionConsent(selected.change)}`,
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  }

  const choice = await vscode.window.showInformationMessage(
    `Approve this action? (${pick.label})`,
    { modal: true },
    'Approve',
    'Reject',
  );
  if (choice !== 'Approve' && choice !== 'Reject') {
    return;
  }

  try {
    if (choice === 'Reject') {
      const rejected = await approvals.reject(pick.actionId, newRequestId());
      await vscode.window.showInformationMessage(`MigraPilot: action ${rejected.state.toLowerCase()}.`);
      return;
    }
    const outcome = await withCancellableProgress('MigraPilot: approving & executing…', (signal) =>
      approveResumeAndReconcile(approvals, pick.actionId, signal),
    );
    await vscode.window.showInformationMessage(
      outcome.status === 'completed'
        ? 'MigraPilot: action approved and executed.'
        : `MigraPilot: action ${outcome.status.replace('_', ' ')} (state ${outcome.action.state}).`,
    );
  } catch (err) {
    await surfacePilotError(deps.output, err, newRequestId());
  }
}
