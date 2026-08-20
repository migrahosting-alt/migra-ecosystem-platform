// MigraPilot — `MigraPilot: Run Command`.
//
// THE AD-HOC COMMAND LANE
// -----------------------
//   Ad-hoc lane (this command)        Agent Mode
//   -------------------------------   ----------------------------------------
//   ONE bounded command               multi-step governed recipe
//   user-initiated, per invocation    autonomous, checkpoint/approval semantics
//   no autonomous follow-up           broader coordinated workflow
//   no mutation authority beyond      recipe-scoped mutation authority
//     what the allowed command does
//
// Two rules enforced rather than documented:
//
//   THE WORKSPACE IS RESOLVED, NEVER TYPED. Same rule as the governed coding command:
//   a path accepted from free text is an access-control decision made by whoever is
//   typing. VS Code resolves the active folder; the Brain still contains it by realpath.
//
//   NOTHING EXECUTES LOCALLY. The extension never spawns a process. Every control —
//   allowlist, no shell, containment, publish/deploy/push refusal, timeout, output caps,
//   redaction — lives in the Brain's `commandRun.ts`. Executing here to "save a round
//   trip" would make all of it decorative, so the Brain being unreachable means the
//   command does not run at all.

import * as vscode from 'vscode';
import type { CommandDeps } from './commandRouting.js';
import { runAdHocCommandFlow, type AdHocCommandUi } from '../services/adHocCommandFlow.js';

const LAST_COMMAND_KEY = 'migrapilot.runCommand.last';

/** Host bindings only. Every decision lives in `adHocCommandFlow.ts`. */
function defaultUi(output: vscode.OutputChannel): AdHocCommandUi {
  return {
    prompt: async (previous) =>
      vscode.window.showInputBox({
        title: 'MigraPilot: Run Command',
        prompt: 'One command, no shell. The program must be on the Brain allowlist.',
        placeHolder: 'npm test -- --runInBand',
        value: previous ?? '',
        ignoreFocusOut: true,
      }),
    showRefusal: async (message) => {
      output.appendLine(`\nRefused: ${message}`);
      const choice = await vscode.window.showWarningMessage(
        `MigraPilot refused the command: ${message}`,
        'Show Logs',
      );
      if (choice === 'Show Logs') output.show(true);
    },
    showResult: async (text, failed) => {
      output.appendLine(`\n${text}`);
      output.show(true);
      if (failed) {
        void vscode.window.showWarningMessage('Command finished with a non-zero exit. See MigraPilot logs.');
      }
    },
  };
}

export async function runAdHocCommand(
  deps: CommandDeps,
  memento?: vscode.Memento,
  ui?: AdHocCommandUi,
): Promise<void> {
  const output = deps.output ?? vscode.window.createOutputChannel('MigraPilot');
  await runAdHocCommandFlow({
    // Resolved, never typed.
    workspaceRoot: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    ui: ui ?? defaultUi(output),
    runner: deps.migraAi as never,
    recall: () => memento?.get<string>(LAST_COMMAND_KEY),
    remember: async (value) => { await memento?.update(LAST_COMMAND_KEY, value); },
    withProgress: async (label, task) =>
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `MigraPilot: ${label}`, cancellable: false },
        task,
      ),
  });
}
