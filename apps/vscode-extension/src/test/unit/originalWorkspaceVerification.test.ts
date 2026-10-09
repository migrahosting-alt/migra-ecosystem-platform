import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { candidateGit } from '@migrapilot/workspace-tools';
import { ProposeChangesetResponseSchema } from '@migrapilot/protocol';
import { MigraAiClient } from '../../services/migraAiClient.js';
import { createWorkspaceToolExecutor } from '../../services/workspaceTools.js';
import { approveEngineeringTask } from '../../services/engineeringTaskActions.js';
import type { EngineeringTask } from '@migrapilot/shared-types';

const requireCjs = createRequire(__filename);
const prompts: string[] = [];
let originalDecision: (message: string) => Promise<string | undefined> = async () => 'Run original check';
const stub = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ProgressLocation: { Notification: 15 },
  workspace: {
    isTrusted: true,
    textDocuments: [] as Array<{ isDirty: boolean; uri: { scheme: string; fsPath: string } }>,
    openTextDocument: async () => ({ uri: {} }),
  },
  window: {
    showQuickPick: async (choices: string[]) => choices[0],
    showInformationMessage: async (_message: string, ...actions: string[]) => actions.includes('Apply') ? 'Apply' : undefined,
    showWarningMessage: async (message: string, ...actions: unknown[]) => {
      if (!actions.length) return undefined;
      prompts.push(message);
      return message.includes('ORIGINAL workspace') ? originalDecision(message) : 'Run candidate checks';
    },
    withProgress: async (
      _options: unknown,
      task: (progress: { report(message: unknown): void }, token: { onCancellationRequested(callback: () => void): { dispose(): void } }) => Promise<unknown>,
    ) => task({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
  },
  commands: { executeCommand: async () => undefined },
};
const moduleCtor = requireCjs('node:module') as { _load(request: string, parent: unknown, main: boolean): unknown };
const originalLoad = moduleCtor._load.bind(moduleCtor);
moduleCtor._load = (request, parent, main) => request === 'vscode' ? stub : originalLoad(request, parent, main);
const native = requireCjs('../../services/candidateWorkflowVscode.js') as typeof import('../../services/candidateWorkflowVscode.js');
const host = requireCjs('../../services/vscodeWorkspaceHost.js') as typeof import('../../services/vscodeWorkspaceHost.js');
moduleCtor._load = originalLoad;

async function fixture(t: TestContext, failOriginal = false) {
  prompts.length = 0; stub.workspace.isTrusted = true; stub.workspace.textDocuments = [];
  originalDecision = async () => 'Run original check';
  const root = mkdtempSync(join(tmpdir(), 'migrapilot-original-native-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'src/value.js'), 'export const value = 0;\n');
  writeFileSync(join(root, 'tests/value.test.js'), 'import {test} from "node:test"; import assert from "node:assert/strict"; import {value} from "../src/value.js"; test("required value",()=>assert.equal(value,2));'
    + (failOriginal ? 'test("original environment",()=>assert.ok(process.cwd().includes("website-candidate-")));' : ''));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: 'node --test tests/*.test.js' } }));
  candidateGit(root, ['init', '-q']); candidateGit(root, ['add', '.']);
  candidateGit(root, ['-c', 'user.name=MigraPilot Fixture', '-c', 'user.email=fixture@migrateck.invalid',
    'commit', '-qm', 'Original verification fixture\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>']);
  const client = new MigraAiClient({ baseUrl: () => 'http://127.0.0.1:1', timeoutMs: () => 500, log() {} });
  client.setWorkspaceToolExecutor(createWorkspaceToolExecutor(host.createVscodeWorkspaceHost()));
  const proposal = ProposeChangesetResponseSchema.parse(await client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: root, ops: [{ op: 'replace', path: 'src/value.js', content: 'export const value = 2;\n' }],
  }));
  return { root, client, proposal };
}

test('native Validate & apply separately consents and runs the real original check', async t => {
  const f = await fixture(t);
  const outcome = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.');
  assert.equal(outcome.applied, true);
  assert.deepEqual(outcome.records?.map(record => record.passed), [false, true]);
  assert.equal(outcome.workspaceVerification?.status, 'passed');
  assert.equal(outcome.workspaceVerification?.records[0]?.id, 'workspace.test');
  assert.match(prompts[1]!, /ORIGINAL workspace/);
  assert.match(prompts[1]!, /NOT an OS\/network sandbox/);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
  const task: EngineeringTask = {
    taskId: 'native', workspaceRoot: f.root, stage: 'awaiting_approval', checkpoint: 'Pending',
    observedFiles: [], evidence: [], commands: [], repairAttempts: 0, completion: 'in_progress',
    proposal: { proposalHash: f.proposal.proposalHash, approvalState: 'pending', operations: [], expectedVerification: [] },
  };
  const next = await approveEngineeringTask(task, async () => outcome)!.result;
  assert.equal(next.proposal?.approvalState, 'applied');
  assert.equal(next.stage, 'testing'); assert.equal(next.completion, 'in_progress');
  assert.match(next.commands[2]!.outputHead!, /original workspace passed/);
});

test('declining original execution preserves approved apply and enables separately consented retry', async t => {
  const f = await fixture(t); originalDecision = async () => undefined;
  const outcome = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.');
  assert.equal(outcome.applied, true); assert.equal(outcome.workspaceVerification?.status, 'declined');
  assert.deepEqual(outcome.workspaceVerification?.records, []);
  originalDecision = async () => 'Run original check';
  const retry = await native.verifyAppliedChangesetVscode(f.root, outcome.proposal!);
  assert.equal(retry.status, 'passed');
  assert.equal(candidateGit(f.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
});

test('cancelling unanswered original consent does not turn a completed apply into a refusal', async t => {
  const f = await fixture(t); const controller = new AbortController();
  originalDecision = () => { controller.abort(); return new Promise(() => {}); };
  const outcome = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.', controller.signal);
  assert.equal(outcome.applied, true); assert.equal(outcome.workspaceVerification?.status, 'cancelled');
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
});

test('dirty editor appearing during original consent refuses execution without reverting applied files', async t => {
  const f = await fixture(t);
  originalDecision = async () => {
    stub.workspace.textDocuments.push({ isDirty: true, uri: { scheme: 'file', fsPath: join(f.root, 'tests/value.test.js') } });
    return 'Run original check';
  };
  const outcome = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.');
  assert.equal(outcome.applied, true); assert.equal(outcome.workspaceVerification?.status, 'unavailable');
  assert.match(outcome.workspaceVerification!.message, /editor changes/);
  assert.deepEqual(outcome.workspaceVerification?.records, []);
});

test('untrusted original workspace and selection cancellation are explicit and run nothing', async t => {
  const f = await fixture(t); originalDecision = async () => undefined;
  const applied = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.');
  stub.workspace.isTrusted = false;
  const refused = await native.verifyAppliedChangesetVscode(f.root, applied.proposal!);
  assert.equal(refused.status, 'unavailable'); assert.match(refused.message, /Trust this workspace/);
  stub.workspace.isTrusted = true;
  const pick = stub.window.showQuickPick;
  stub.window.showQuickPick = async () => undefined;
  t.after(() => { stub.window.showQuickPick = pick; });
  const declined = await native.verifyAppliedChangesetVscode(f.root, applied.proposal!);
  assert.equal(declined.status, 'declined'); assert.deepEqual(declined.records, []);
});

test('real original failure after a passing candidate retains applied state and failed evidence', async t => {
  const f = await fixture(t, true);
  const outcome = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.');
  assert.equal(outcome.applied, true); assert.equal(outcome.records?.at(-1)?.passed, true);
  assert.equal(outcome.workspaceVerification?.status, 'failed');
  assert.equal(outcome.workspaceVerification?.records[0]?.exitCode, 1);
  assert.match(outcome.workspaceVerification!.records[0]!.stdout, /original environment/);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
});

test('trust revoked while original consent is open refuses execution after a successful apply', async t => {
  const f = await fixture(t);
  originalDecision = async () => { stub.workspace.isTrusted = false; return 'Run original check'; };
  const outcome = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.');
  assert.equal(outcome.applied, true); assert.equal(outcome.workspaceVerification?.status, 'unavailable');
  assert.match(outcome.workspaceVerification!.message, /Trust this workspace/);
  assert.deepEqual(outcome.workspaceVerification?.records, []);
});

test('missing original checks are explicitly unavailable, not mistaken for a selection decline', async t => {
  const f = await fixture(t); originalDecision = async () => undefined;
  const outcome = await native.validateAndApplyChangeset(f.client, f.root, f.proposal, 'Return two.');
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ type: 'module', scripts: { start: 'node src/value.js' } }));
  const result = await native.verifyAppliedChangesetVscode(f.root, outcome.proposal!);
  assert.equal(result.status, 'unavailable'); assert.match(result.message, /No declared validation script/);
  assert.deepEqual(result.records, []);
});
