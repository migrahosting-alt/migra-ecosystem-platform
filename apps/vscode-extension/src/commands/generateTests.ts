import { spawn } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as vscode from 'vscode';
import {
  type FrameworkInfo,
  type PackageJsonLike,
  detectTestFramework,
  deterministicTestProposal,
  selectTestCommand,
  testPathFor,
} from '../generateTests/framework.js';
import {
  type TestProposal,
  type WorkspaceFs,
  ProposalParseError,
  applyTestProposal,
  fingerprintProposal,
  parseProposal,
  validateProposal,
} from '../generateTests/proposal.js';
import { type ModelProvider } from '../providers/modelProvider.js';
import { collectCompletion } from '../providers/providerFactory.js';
import { BackendRouter } from '../services/backendRouter.js';
import { CAP_GENERATE_TESTS, evaluateCapability } from '../services/commandCapabilities.js';
import { newRequestId } from '@migrapilot/pilot-client';
import { isPilotError, toUserMessage } from '@migrapilot/pilot-client';
import { type CommandDeps, surfacePilotError, withCancellableProgress } from './commandRouting.js';

export interface TestGenDeps extends CommandDeps {
  makeProvider: () => ModelProvider;
}

export interface TestRunResult {
  command: string[];
  exitCode: number | null;
  output: string;
}

export type TestGenResult =
  | { status: 'no-write'; reason: string } // cancelled/rejected before apply
  | { status: 'refused'; reason: string } // capability / validation / changed-after-review
  | { status: 'error'; reason: string } // malformed provider output / transport
  | { status: 'partial'; written: string[]; failed: string; reason: string }
  | {
      status: 'written';
      written: string[];
      verified: boolean;
      fingerprint: string;
      testRun: TestRunResult | { skipped: true; reason: string };
    };

export interface ConfirmContext {
  proposal: TestProposal;
  fingerprint: string;
  markdown: string;
}

/** Node-backed WorkspaceFs rooted at the workspace folder. */
function makeWorkspaceFs(root: string): WorkspaceFs {
  const abs = (rel: string) => path.join(root, rel);
  return {
    exists: async (rel) => {
      try {
        await access(abs(rel));
        return true;
      } catch {
        return false;
      }
    },
    read: (rel) => readFile(abs(rel), 'utf8'),
    write: async (rel, contents) => {
      await mkdir(path.dirname(abs(rel)), { recursive: true });
      await writeFile(abs(rel), contents);
    },
  };
}

async function readPackageJson(fs: WorkspaceFs): Promise<PackageJsonLike | undefined> {
  try {
    return JSON.parse(await fs.read('package.json')) as PackageJsonLike;
  } catch {
    return undefined;
  }
}

async function obtainProposal(
  provider: ModelProvider,
  targetRelPath: string,
  targetContents: string,
  framework: FrameworkInfo,
  signal?: AbortSignal,
): Promise<TestProposal> {
  // The stub provider contributes a deterministic fixture (not a placeholder).
  if (provider.id === 'stub') {
    return deterministicTestProposal(targetRelPath, framework.framework);
  }
  const system = [
    'You are a precise test generator. Respond ONLY with a JSON object of the form',
    '{"files":[{"path":"<workspace-relative path>","contents":"<file text>","mode":"create|update"}]}.',
    'Paths must stay inside the workspace. Prefer creating a new *.test file next to the source.',
    `Test framework: ${framework.framework}.`,
  ].join(' ');
  const user = `Generate tests for ${targetRelPath}:\n\n${targetContents.slice(0, 6000)}`;
  const completion = await collectCompletion(
    provider,
    { messages: [{ role: 'system', content: system }, { role: 'user', content: user }], requestId: newRequestId() },
    signal,
  );
  return parseProposal(completion.content);
}

function previewMarkdown(proposal: TestProposal): string {
  const out: string[] = ['# MigraPilot — proposed tests', ''];
  for (const f of proposal.files) {
    out.push(`## ${f.mode === 'create' ? 'New file' : 'Update'}: \`${f.path}\``, '', '```', f.contents, '```', '');
  }
  return out.join('\n');
}

function runTestCommand(command: string[], cwd: string, signal?: AbortSignal): Promise<TestRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command[0]!, command.slice(1), { cwd, signal });
    let output = '';
    child.stdout?.on('data', (d) => (output += d.toString()));
    child.stderr?.on('data', (d) => (output += d.toString()));
    child.on('close', (code) => resolve({ command, exitCode: code, output: output.slice(0, 4000) }));
    child.on('error', (err) => resolve({ command, exitCode: null, output: String(err).slice(0, 4000) }));
  });
}

/**
 * The full non-destructive test-generation flow. Generates ONCE, validates, asks
 * `confirm` (which shows the preview), and only then writes — reading the
 * workspace back and running the narrowest safe command. No write happens if
 * confirm returns false. Provider output is validated; a configured real
 * provider is never replaced by the stub. In remote-pilot mode it is
 * capability-gated and never silently falls back to local.
 */
export async function runGenerateTests(
  deps: TestGenDeps,
  targetRelPath: string,
  root: string,
  confirm: (ctx: ConfirmContext) => Promise<boolean>,
  opts: { runCommand?: boolean; signal?: AbortSignal } = {},
): Promise<TestGenResult> {
  const backend = deps.router.current() ?? (await deps.router.resolve());
  if (backend.kind !== 'local') {
    // Remote generation is capability-gated; no silent fallback to local.
    const decision = evaluateCapability(backend, CAP_GENERATE_TESTS);
    if (decision.mode !== 'remote') {
      const reason = decision.mode === 'denied' ? decision.error.code : 'unresolved-backend';
      return { status: 'refused', reason: `remote test generation unavailable (${reason})` };
    }
  }

  const fs = makeWorkspaceFs(root);
  let targetContents = '';
  try {
    targetContents = await fs.read(targetRelPath);
  } catch {
    return { status: 'error', reason: `cannot read target file ${targetRelPath}` };
  }
  const framework = detectTestFramework(await readPackageJson(fs));

  let proposal: TestProposal;
  try {
    proposal = await obtainProposal(deps.makeProvider(), targetRelPath, targetContents, framework, opts.signal);
  } catch (err) {
    if (err instanceof ProposalParseError) {
      return { status: 'error', reason: `provider returned malformed test proposal: ${err.message}` };
    }
    if (isPilotError(err)) {
      return { status: 'error', reason: `${err.code}` };
    }
    return { status: 'error', reason: err instanceof Error ? err.message : String(err) };
  }

  const validation = await validateProposal(proposal, root, fs);
  if (!validation.ok) {
    return { status: 'refused', reason: validation.reason };
  }

  const fingerprint = fingerprintProposal(proposal);
  const approved = await confirm({ proposal, fingerprint, markdown: previewMarkdown(proposal) });
  if (!approved) {
    return { status: 'no-write', reason: 'not confirmed' };
  }

  const applied = await applyTestProposal(proposal, fingerprint, root, fs);
  if (applied.status === 'refused') {
    return { status: 'refused', reason: applied.reason };
  }
  if (applied.status === 'partial') {
    return { status: 'partial', written: applied.written, failed: applied.failed, reason: applied.reason };
  }

  // Run the narrowest safe command (constrained detector, never the provider).
  let testRun: TestRunResult | { skipped: true; reason: string } = {
    skipped: true,
    reason: 'test execution not requested',
  };
  if (opts.runCommand) {
    const firstTest = proposal.files.find((f) => f.path)?.path ?? testPathFor(targetRelPath);
    const command = selectTestCommand(framework.framework, firstTest);
    testRun = command
      ? await runTestCommand(command, root, opts.signal)
      : { skipped: true, reason: `no known test command for framework "${framework.framework}"` };
  }

  return { status: 'written', written: applied.written, verified: applied.verified, fingerprint, testRun };
}

/** Interactive command: preview doc + modal confirm, then run + report. */
export async function runGenerateTestsCommand(deps: TestGenDeps): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    await vscode.window.showWarningMessage('Open a file to generate tests for.');
    return;
  }
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    await vscode.window.showWarningMessage('Open a workspace folder to generate tests.');
    return;
  }
  const root = folder.uri.fsPath;
  const targetRelPath = vscode.workspace.asRelativePath(editor.document.uri, false).replace(/\\/g, '/');
  const requestId = newRequestId();

  const confirm = async (ctx: ConfirmContext): Promise<boolean> => {
    const doc = await vscode.workspace.openTextDocument({ language: 'markdown', content: ctx.markdown });
    await vscode.window.showTextDocument(doc, { preview: true });
    const choice = await vscode.window.showInformationMessage(
      `Apply ${ctx.proposal.files.length} generated test file(s)?`,
      { modal: true },
      'Apply',
    );
    return choice === 'Apply';
  };

  try {
    const result = await withCancellableProgress('MigraPilot: generating tests…', (signal) =>
      runGenerateTests(deps, targetRelPath, root, confirm, { runCommand: true, signal }),
    );
    await reportResult(result);
  } catch (err) {
    await surfacePilotError(deps.output, err, requestId);
  }
}

async function reportResult(result: TestGenResult): Promise<void> {
  switch (result.status) {
    case 'written': {
      const run =
        'skipped' in result.testRun
          ? `tests not run (${result.testRun.reason})`
          : `test command exited ${result.testRun.exitCode}`;
      await vscode.window.showInformationMessage(
        `MigraPilot wrote ${result.written.length} test file(s) · read-back ${result.verified ? 'verified' : 'UNVERIFIED'} · ${run}.`,
      );
      break;
    }
    case 'partial':
      await vscode.window.showErrorMessage(
        `MigraPilot partially wrote tests (${result.written.length} written, failed at ${result.failed}). Review the workspace.`,
      );
      break;
    case 'no-write':
      await vscode.window.showInformationMessage('MigraPilot: test generation cancelled — no files changed.');
      break;
    case 'refused':
    case 'error':
      await vscode.window.showWarningMessage(`MigraPilot could not generate tests: ${result.reason}`);
      break;
  }
}
