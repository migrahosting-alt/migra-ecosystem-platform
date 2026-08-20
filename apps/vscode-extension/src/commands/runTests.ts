// MigraPilot — `MigraPilot: Run Tests`.
//
// "Run the project's tests and tell me what failed." The extension asks the Brain to run a
// script the PROJECT already declares; it never spawns a process and never assembles a
// command line. `git` and arbitrary programs remain unreachable — the only thing runnable is
// what the project defined for itself.
//
// THE WORKSPACE IS RESOLVED, NEVER TYPED, as in every other lane.
//
// A refusal ("no test script here") renders differently from a failing suite. Collapsing
// them would tell someone their code is broken when nothing actually ran.
//
// Decisions live in `services/testRunFlow.ts`, which imports no `vscode`.

import * as vscode from 'vscode';
import type { CommandDeps } from './commandRouting.js';
import { runTestFlow, type TestRunResult, type TestRunner } from '../services/testRunFlow.js';

const LAST_SCRIPT_KEY = 'migrapilot.runTests.lastScript';

function brainRunner(deps: CommandDeps): TestRunner {
  return {
    run: async (input) => (await deps.migraAi.runTests(input as never)) as unknown as TestRunResult,
  };
}

export async function runTests(deps: CommandDeps, memento?: vscode.Memento, script?: string): Promise<void> {
  const output = deps.output ?? vscode.window.createOutputChannel('MigraPilot');
  const chosen = script ?? memento?.get<string>(LAST_SCRIPT_KEY);

  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'MigraPilot: running tests…', cancellable: false },
    async () =>
      runTestFlow({
        // Resolved, never typed.
        rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        ...(chosen !== undefined ? { script: chosen } : {}),
        runner: brainRunner(deps),
      }),
  );

  if (outcome.kind === 'unavailable') {
    output.appendLine(`\nTests: ${outcome.reason}`);
    const choice = await vscode.window.showWarningMessage(`MigraPilot: ${outcome.reason}`, 'Show Logs');
    if (choice === 'Show Logs') output.show(true);
    return;
  }

  if (outcome.kind === 'refused') {
    output.appendLine(`\nTests not run: ${outcome.reason}`);
    output.show(true);
    // Offer the project's own scripts rather than inventing a command.
    if (outcome.availableScripts.length > 0) {
      const pick = await vscode.window.showQuickPick(outcome.availableScripts, {
        title: 'MigraPilot: which test script?',
        placeHolder: outcome.reason,
      });
      if (pick !== undefined) {
        await memento?.update(LAST_SCRIPT_KEY, pick);
        await runTests(deps, memento, pick);
      }
      return;
    }
    void vscode.window.showWarningMessage(`MigraPilot: ${outcome.reason}`);
    return;
  }

  if (outcome.result.script !== null) await memento?.update(LAST_SCRIPT_KEY, outcome.result.script);
  output.appendLine(`\n${outcome.report}`);
  output.show(true);
  if (outcome.result.status !== 'passed') {
    void vscode.window.showWarningMessage(
      outcome.result.status === 'timeout'
        ? 'MigraPilot: the test run timed out.'
        : `MigraPilot: tests failed${outcome.result.totals ? ` (${outcome.result.totals.failed})` : ''}.`,
    );
  }
}
