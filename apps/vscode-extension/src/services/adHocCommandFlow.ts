/**
 * The ad-hoc command lane's control flow, with no `vscode` import.
 *
 * Split out for the same reason `brainConfigVscode.ts` is split from `brainClient.ts`:
 * the interesting behaviour here is what happens when the Brain is unreachable, when a
 * command is refused, and when one exits non-zero — and none of that is testable under
 * bare `node --test` if the module drags the editor host in with it.
 *
 * `commands/runCommand.ts` supplies the host bindings; this owns the decisions.
 */

import { formatCommandResult, parseCommandInput } from './commandInput.js';

export interface AdHocCommandUi {
  prompt(previous: string | undefined): Promise<string | undefined>;
  showRefusal(message: string): Promise<void>;
  showResult(text: string, failed: boolean): Promise<void>;
}

export interface AdHocCommandRunner {
  runCommand(body: { rootPath: string; command: string[] }): Promise<
    | { ok: true; result: { exitCode: number | null; timedOut: boolean; truncated: boolean; redacted: boolean; durationMs: number; stdout: string; stderr: string } }
    | { ok: false; refusal: string }
  >;
}

export interface AdHocCommandContext {
  workspaceRoot: string | undefined;
  ui: AdHocCommandUi;
  runner: AdHocCommandRunner;
  recall?: () => string | undefined;
  remember?: (value: string) => Promise<void>;
  /** Wraps the call so the host can show progress. Identity is fine for tests. */
  withProgress?: <T>(label: string, task: () => Promise<T>) => Promise<T>;
}

export async function runAdHocCommandFlow(ctx: AdHocCommandContext): Promise<void> {
  if (ctx.workspaceRoot === undefined || ctx.workspaceRoot.length === 0) {
    await ctx.ui.showRefusal('Open a workspace folder first — a command needs a resolved root.');
    return;
  }
  const typed = await ctx.ui.prompt(ctx.recall?.());
  if (typed === undefined) return; // cancelled

  const parsed = parseCommandInput(typed);
  if (!parsed.ok) {
    await ctx.ui.showRefusal(parsed.reason);
    return;
  }
  await ctx.remember?.(typed.trim());

  const label = parsed.argv.join(' ');
  const invoke = async (): Promise<Awaited<ReturnType<AdHocCommandRunner['runCommand']>>> =>
    ctx.runner.runCommand({ rootPath: ctx.workspaceRoot as string, command: parsed.argv });

  let outcome: Awaited<ReturnType<AdHocCommandRunner['runCommand']>>;
  try {
    outcome = ctx.withProgress ? await ctx.withProgress(label, invoke) : await invoke();
  } catch (error) {
    // FAIL CLOSED. The Brain is the only executor; if it cannot be reached the command did
    // not run, and saying anything else would be a lie the user acts on. There is
    // deliberately no local fallback path from here.
    const message = error instanceof Error ? error.message : String(error);
    await ctx.ui.showRefusal(`the Brain Service is unavailable, so the command was NOT run (${message}).`);
    return;
  }

  if (!outcome.ok) {
    await ctx.ui.showRefusal(outcome.refusal);
    return;
  }
  const r = outcome.result;
  const text = formatCommandResult({
    argv: parsed.argv,
    cwd: ctx.workspaceRoot,
    exitCode: r.exitCode,
    timedOut: r.timedOut,
    truncated: r.truncated,
    redacted: r.redacted,
    durationMs: r.durationMs,
    stdout: r.stdout,
    stderr: r.stderr,
  });
  await ctx.ui.showResult(text, r.timedOut || r.exitCode !== 0);
}
