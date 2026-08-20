// MigraPilot — `MigraPilot: Quick Edit`.
//
// THE LIGHTWEIGHT EDIT LANE. Ask for a small change, see the exact diff, apply it — without
// entering a governed coding run. Larger or riskier work still belongs in Agent Mode /
// governed coding, which this does not touch.
//
// Two rules enforced rather than documented:
//
//   THE WORKSPACE IS RESOLVED, NEVER TYPED. Same rule as the governed coding command and the
//   ad-hoc command lane: a path accepted from free text is an access-control decision made by
//   whoever is typing.
//
//   THE EXTENSION NEVER WRITES. Proposal and application both go through the engine's
//   changeset machinery — `fs.proposeChangeset` (read-only) then `fs.applyChangeset`
//   (approval-required, atomic, all-or-nothing, rollback on partial failure). Writing here to
//   "make a small edit quick" would bypass containment, staleness detection and rollback in
//   one move, which is exactly the machinery that makes a small edit safe to accept.
//
// All decisions live in `services/quickEditFlow.ts`, which imports no `vscode` so the
// refusal and fail-closed paths are testable under bare `node --test`.

import * as vscode from 'vscode';
import type { CommandDeps } from './commandRouting.js';
import { applyApprovedChangesetDetailed } from '../services/changesetApply.js';
import {
  runQuickEditFlow,
  type QuickEditEngine,
  type QuickEditOp,
  type QuickEditProposal,
  type QuickEditUi,
} from '../services/quickEditFlow.js';

/** Render the proposal as a readable diff summary for the confirmation dialog. */
function diffSummary(ops: readonly QuickEditOp[]): string {
  return ops
    .map((op) => {
      const kind = op.kind ?? op.op ?? 'modify';
      const before = (op.before ?? '').split('\n').length;
      const after = (op.after ?? '').split('\n').length;
      return `${kind}  ${op.path}  (${before} → ${after} lines)`;
    })
    .join('\n');
}

function defaultUi(output: vscode.OutputChannel): QuickEditUi {
  return {
    confirm: async (summary, ops) => {
      output.appendLine(`\nProposed change — ${summary}\n${diffSummary(ops)}`);
      output.show(true);
      const choice = await vscode.window.showInformationMessage(
        `Apply MigraPilot's change to ${summary}?`,
        { modal: true, detail: diffSummary(ops) },
        'Apply',
      );
      return choice === 'Apply';
    },
    showRefusal: async (reason) => {
      output.appendLine(`\nQuick edit refused: ${reason}`);
      const choice = await vscode.window.showWarningMessage(`Quick edit: ${reason}`, 'Show Logs');
      if (choice === 'Show Logs') output.show(true);
    },
    showApplied: async (files) => {
      output.appendLine(`\nApplied: ${files.join(', ')}`);
      void vscode.window.showInformationMessage(`MigraPilot applied ${files.length} file change(s).`);
    },
  };
}

/**
 * Adapter over the EXISTING engine paths. Nothing new is introduced on the Brain side:
 * the propose half is the engineer loop (preview-only by owner policy) and the apply half
 * is the same mint -> consume handshake the chat proposal flow already uses.
 */
function engineAdapter(deps: CommandDeps): QuickEditEngine {
  return {
    propose: async (instruction, rootPath) => {
      let latest: QuickEditProposal | undefined;
      for await (const frame of deps.migraAi.engineerStream({ rootPath, task: instruction })) {
        const preview = (frame.data as { preview?: QuickEditProposal } | undefined)?.preview;
        if (preview?.proposalHash && preview.ops?.length) latest = preview;
      }
      return latest;
    },
    apply: async (rootPath, proposalHash) =>
      applyApprovedChangesetDetailed(
        (req) => deps.migraAi.executeTool(req as never) as never,
        rootPath,
        proposalHash,
      ),
  };
}

export async function runQuickEdit(deps: CommandDeps, ui?: QuickEditUi): Promise<void> {
  const output = deps.output ?? vscode.window.createOutputChannel('MigraPilot');
  const surface = ui ?? defaultUi(output);

  const instruction = await vscode.window.showInputBox({
    title: 'MigraPilot: Quick Edit',
    prompt: 'Describe a small, bounded change. Larger work belongs in a governed coding run.',
    placeHolder: 'rename the timeout constant to REQUEST_TIMEOUT_MS',
    ignoreFocusOut: true,
  });
  if (instruction === undefined) return; // cancelled

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'MigraPilot: proposing a change…', cancellable: false },
    async () => {
      await runQuickEditFlow({
        instruction,
        // Resolved, never typed.
        rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        engine: engineAdapter(deps),
        ui: surface,
      });
    },
  );
}
