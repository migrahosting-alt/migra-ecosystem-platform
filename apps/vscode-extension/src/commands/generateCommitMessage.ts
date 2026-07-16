import { spawn } from 'node:child_process';
import * as vscode from 'vscode';
import { type BoundedDiff, type ConventionSetting, buildBoundedDiff, detectConvention } from '../commitGen/prepare.js';
import { type GitResult, type GitRunner, assertReadOnly, recentSubjects, stagedFiles, unstagedFiles } from '../commitGen/git.js';
import { type CommitMessage, deterministicCommitMessage, sanitizeCommitMessage, validateSubject } from '../commitGen/sanitize.js';
import { type ModelProvider } from '../providers/modelProvider.js';
import { collectCompletion } from '../providers/providerFactory.js';
import { CAP_COMMIT_MESSAGE, evaluateCapability } from '../services/commandCapabilities.js';
import { newRequestId } from '@migrapilot/pilot-client';
import { isPilotError } from '@migrapilot/pilot-client';
import { type CommandDeps, surfacePilotError, withCancellableProgress } from './commandRouting.js';

export interface CommitGenDeps extends CommandDeps {
  makeProvider: () => ModelProvider;
}

export interface CommitGenOptions {
  includeUnstaged?: boolean;
  convention?: ConventionSetting;
}

export type CommitGenResult =
  | { status: 'no-staged-changes' } // precise, non-error; no provider request made
  | { status: 'generated'; subject: string; body: string; includedUnstaged: boolean; providerId: string }
  | { status: 'refused'; reason: string } // capability-gated remote
  | { status: 'error'; reason: string }; // provider failure / malformed / unusable

/** Real, read-only git runner (spawn — no execFile maxBuffer trap). */
function realGitRunner(root: string): GitRunner {
  return {
    run: (args, signal) =>
      new Promise<GitResult>((resolve) => {
        assertReadOnly(args); // defense in depth — never a mutating subcommand
        const child = spawn('git', args, { cwd: root, signal });
        let stdout = '';
        child.stdout?.on('data', (d) => (stdout += d.toString()));
        child.on('close', (code) => resolve({ stdout, code: code ?? 1 }));
        child.on('error', () => resolve({ stdout: '', code: 1 }));
      }),
  };
}

function renderDiffForPrompt(diff: BoundedDiff): string {
  return diff.files
    .map((f) => (f.category === 'normal' ? `### ${f.status} ${f.path}\n${f.content}` : f.content))
    .join('\n\n');
}

async function obtainMessage(
  provider: ModelProvider,
  diff: BoundedDiff,
  convention: ReturnType<typeof detectConvention>,
  signal?: AbortSignal,
): Promise<CommitMessage> {
  if (provider.id === 'stub') {
    return deterministicCommitMessage(diff, convention);
  }
  const system = [
    'You write a git commit message describing ONLY the changes shown.',
    'Output a concise subject line, then a blank line, then an optional body.',
    convention.conventional
      ? 'Use Conventional Commits (type(scope): subject) only where the diff clearly supports it.'
      : 'Do NOT use a type(scope): prefix.',
    'Do NOT invent issue numbers, breaking-change markers, scopes, test results, or affected components not in the diff.',
    'Do not include code fences or trailers.',
  ].join(' ');
  const user = `Changes:\n\n${renderDiffForPrompt(diff)}`;
  const completion = await collectCompletion(
    provider,
    { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], requestId: newRequestId() },
    signal,
  );
  return sanitizeCommitMessage(completion.content, convention);
}

/**
 * Provider-backed, strictly READ-ONLY commit-message generation. Never stages,
 * commits, amends, or mutates the repo. Defaults to staged changes only; with no
 * staged changes it returns a precise result WITHOUT contacting the provider. In
 * remote-pilot mode it is capability-gated with no local fallback. Provider
 * failure surfaces as an error (no fabricated message).
 */
export async function runGenerateCommitMessage(
  deps: CommitGenDeps,
  root: string,
  opts: CommitGenOptions,
  signal?: AbortSignal,
): Promise<CommitGenResult> {
  const backend = deps.router.current() ?? (await deps.router.resolve());
  if (backend.kind !== 'local') {
    const decision = evaluateCapability(backend, CAP_COMMIT_MESSAGE);
    if (decision.mode !== 'remote') {
      const reason = decision.mode === 'denied' ? decision.error.code : 'unresolved-backend';
      return { status: 'refused', reason: `remote commit-message generation unavailable (${reason})` };
    }
  }

  const git = realGitRunner(root);
  const staged = await stagedFiles(git, signal);
  const includeUnstaged = opts.includeUnstaged === true;
  const unstaged = includeUnstaged ? await unstagedFiles(git, signal) : [];

  if (staged.length === 0 && (!includeUnstaged || unstaged.length === 0)) {
    return { status: 'no-staged-changes' }; // no provider request made
  }

  const stagedDiff = await buildBoundedDiff(git, staged, true, {}, signal);
  const unstagedDiff = includeUnstaged
    ? await buildBoundedDiff(git, unstaged, false, {}, signal)
    : { files: [], totalFiles: 0, truncated: false, includedUnstaged: false };
  const combined: BoundedDiff = {
    files: [...stagedDiff.files, ...unstagedDiff.files],
    totalFiles: stagedDiff.totalFiles + unstagedDiff.totalFiles,
    truncated: stagedDiff.truncated || unstagedDiff.truncated,
    includedUnstaged: unstagedDiff.files.length > 0,
  };

  const convention = detectConvention(await recentSubjects(git, 20, signal), opts.convention ?? 'auto');

  let message: CommitMessage;
  try {
    message = await obtainMessage(deps.makeProvider(), combined, convention, signal);
  } catch (err) {
    if (isPilotError(err)) {
      return { status: 'error', reason: err.code };
    }
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }

  const validation = validateSubject(message.subject, convention.maxSubjectLength);
  if (!validation.ok) {
    return { status: 'error', reason: `provider produced no usable subject (${validation.reason})` };
  }

  return {
    status: 'generated',
    subject: message.subject,
    body: message.body,
    includedUnstaged: combined.includedUnstaged,
    providerId: deps.makeProvider().capabilities().providerId,
  };
}

/** Interactive command: generate → preview → optional copy. No git mutation. */
export async function runGenerateCommitMessageCommand(deps: CommitGenDeps): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    await vscode.window.showWarningMessage('Open a workspace folder to generate a commit message.');
    return;
  }
  const root = folder.uri.fsPath;
  const requestId = newRequestId();

  try {
    const result = await withCancellableProgress('MigraPilot: writing commit message…', (signal) =>
      runGenerateCommitMessage(deps, root, {}, signal),
    );
    if (result.status === 'no-staged-changes') {
      await vscode.window.showInformationMessage(
        'MigraPilot: no staged changes to describe. Stage changes first (git add).',
      );
      return;
    }
    if (result.status === 'refused' || result.status === 'error') {
      await vscode.window.showWarningMessage(`MigraPilot could not write a commit message: ${result.reason}`);
      return;
    }
    // Preview (read-only) BEFORE any clipboard action.
    const preview = result.body ? `${result.subject}\n\n${result.body}` : result.subject;
    const doc = await vscode.workspace.openTextDocument({ language: 'git-commit', content: preview });
    await vscode.window.showTextDocument(doc, { preview: true });
    const choice = await vscode.window.showInformationMessage('MigraPilot generated a commit message.', 'Copy to Clipboard');
    if (choice === 'Copy to Clipboard') {
      await vscode.env.clipboard.writeText(preview);
      await vscode.window.showInformationMessage('Commit message copied to clipboard.');
    }
  } catch (err) {
    await surfacePilotError(deps.output, err, requestId);
  }
}
