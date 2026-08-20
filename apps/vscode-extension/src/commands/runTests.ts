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
import { runTestFlow, type TestRunOutcome, type TestRunResult, type TestRunner } from '../services/testRunFlow.js';
import { testRunActivity } from '../services/testRunFlow.js';

const LAST_SCRIPT_KEY = 'migrapilot.runTests.lastScript';

function brainRunner(deps: CommandDeps): TestRunner {
  return {
    run: async (input) => (await deps.migraAi.runTests(input as never)) as unknown as TestRunResult,
  };
}

/**
 * Returns the outcome so the caller can reflect VERIFICATION in the product
 * surface. The result area is meant to answer "did it pass", and a result that
 * only ever lands in an output channel does not answer it where the user is
 * looking.
 */
export async function runTests(
  deps: CommandDeps,
  memento?: vscode.Memento,
  script?: string,
  onOutcome?: (summary: { text: string; tone: 'ok' | 'warn' | 'error' | 'info' }) => void,
): Promise<TestRunOutcome | undefined> {
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

  onOutcome?.(testRunActivity(outcome));

  if (outcome.kind === 'unavailable') {
    output.appendLine(`\nTests: ${outcome.reason}`);
    const choice = await vscode.window.showWarningMessage(`MigraPilot: ${outcome.reason}`, 'Show Logs');
    if (choice === 'Show Logs') output.show(true);
    return outcome;
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
        return runTests(deps, memento, pick, onOutcome);
      }
      return outcome;
    }
    void vscode.window.showWarningMessage(`MigraPilot: ${outcome.reason}`);
    return outcome;
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
  } else {
    // A PASS MUST ANNOUNCE ITSELF. VS Code keeps a warning toast on screen until
    // it is dismissed, so a failing run followed by a passing one left "tests
    // failed" as the newest thing a user could see — seen in the running product,
    // not in any test. Reporting only failures made the stale toast look current.
    void vscode.window.showInformationMessage(
      `MigraPilot: tests passed${outcome.result.totals ? ` (${outcome.result.totals.passed})` : ''}.`,
    );
  }
  return outcome;
}
