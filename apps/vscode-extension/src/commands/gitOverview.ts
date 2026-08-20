// MigraPilot — `MigraPilot: Git Status & History`.
//
// Read-only Git visibility. The extension asks the Brain a structured question and renders
// the answer; it never shells out, never reads `.git`, and cannot request arbitrary Git
// execution. `git` remains deliberately absent from the ad-hoc command lane's allowlist —
// answering a read-only question by granting arbitrary `git` execution would have been the
// shortcut, and it would have bought mutation capability along with it.
//
// THE WORKSPACE IS RESOLVED, NEVER TYPED, as in every other lane.
//
// Decisions and formatting live in `services/gitInsightFlow.ts`, which imports no `vscode`.

import * as vscode from 'vscode';
import type { CommandDeps } from './commandRouting.js';
import {
  runGitInsightFlow,
  type GitHistory,
  type GitInsightSource,
  type GitOverview,
} from '../services/gitInsightFlow.js';

const DEFAULT_HISTORY_LIMIT = 15;

/** Structured tool calls only — the request types carry no subcommand and no flags. */
function brainSource(deps: CommandDeps): GitInsightSource {
  const call = async <T>(tool: string, input: unknown): Promise<T> => {
    const outcome = (await deps.migraAi.executeTool({ tool, input } as never)) as {
      status?: string;
      result?: unknown;
      error?: string;
      reason?: string;
    };
    if (outcome.status === 'ok' || outcome.status === 'executed') return outcome.result as T;
    // A refusal is reported as itself — the engine's structured reason, not a guess.
    throw new Error(outcome.error ?? `Git request refused${outcome.reason ? ` (${outcome.reason})` : ''}`);
  };
  return {
    overview: (rootPath) => call<GitOverview>('git.overview', { rootPath }),
    history: (rootPath, limit) => call<GitHistory>('git.history', { rootPath, limit }),
  };
}

export async function runGitOverview(deps: CommandDeps): Promise<void> {
  const output = deps.output ?? vscode.window.createOutputChannel('MigraPilot');
  const outcome = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Window, title: 'MigraPilot: reading Git status…' },
    async () =>
      runGitInsightFlow({
        // Resolved, never typed.
        rootPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
        limit: DEFAULT_HISTORY_LIMIT,
        source: brainSource(deps),
      }),
  );

  if (outcome.status === 'unavailable') {
    output.appendLine(`\nGit: ${outcome.reason}`);
    const choice = await vscode.window.showWarningMessage(`MigraPilot: ${outcome.reason}`, 'Show Logs');
    if (choice === 'Show Logs') output.show(true);
    return;
  }
  output.appendLine(`\n${outcome.report}`);
  output.show(true);
}
