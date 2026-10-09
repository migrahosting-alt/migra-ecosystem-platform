import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProposeChangesetResponseSchema } from '@migrapilot/protocol';
import { candidateGit, commandRun, observedFailure, workspaceToolMeta } from '@migrapilot/workspace-tools';
import { validateCandidate, verifyAppliedChangeset, candidateOperations, candidateScriptChoices, type CandidateWorkflowOptions } from '../../services/candidateWorkflow.js';
import { MigraAiClient } from '../../services/migraAiClient.js';
import { createWorkspaceToolExecutor } from '../../services/workspaceTools.js';
import { applyApprovedChangeset } from '../../services/changesetApply.js';
import { approveEngineeringTask } from '../../services/engineeringTaskActions.js';
import type { EngineeringTask } from '@migrapilot/shared-types';

function fixture(t: TestContext, script = 'node --test tests/*.test.js') {
  const root = mkdtempSync(join(tmpdir(), 'migrapilot-candidate-unit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src')); mkdirSync(join(root, 'tests'));
  writeFileSync(join(root, 'src/value.js'), 'export const value = 0;\n');
  writeFileSync(join(root, 'tests/value.test.js'), [
    'import {test} from "node:test"; import assert from "node:assert/strict"; import {value} from "../src/value.js";',
    'test("required value", () => assert.equal(value, 2)); test("nonnegative", () => assert.ok(value >= 0));',
  ].join('\n'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', scripts: { test: script } }));
  candidateGit(root, ['init', '-q']);
  candidateGit(root, ['add', '.']);
  candidateGit(root, ['-c', 'user.name=MigraPilot Fixture', '-c', 'user.email=fixture@migrateck.invalid',
    'commit', '-qm', 'Isolated candidate baseline\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>']);
  const client = new MigraAiClient({ baseUrl: () => 'http://127.0.0.1:1', timeoutMs: () => 500, log() {} });
  client.setWorkspaceToolExecutor(createWorkspaceToolExecutor({
    diagnostics: async () => ({ items: [] }), documentSymbols: async () => ({ symbols: [] }),
    requestApproval: async () => { throw new Error('Unexpected duplicate editor approval'); },
  }));
  const propose = async (at: string, value: number, path = 'src/value.js') =>
    ProposeChangesetResponseSchema.parse(await client.runReadOnlyTool('fs.proposeChangeset', {
      rootPath: at, ops: [{ op: 'replace', path, content: `export const value = ${value};\n` }],
    }));
  const options = async (value = 2): Promise<CandidateWorkflowOptions> => ({
    rootPath: root, proposal: await propose(root, value), script: 'test', goal: 'Return the required value of two.',
    requestConsent: async consent => {
      assert.deepEqual(consent.command, ['npm', 'run', 'test']);
      assert.equal(consent.maxRepairs, 2); return true;
    },
  });
  return { root, client, propose, options };
}
test('real candidate checks leave original clean until separate fresh original approval', async t => {
  const f = fixture(t);
  assert.deepEqual(candidateScriptChoices(f.root), ['test']);
  const result = await validateCandidate(f.client, await f.options());
  assert.deepEqual(result.records.map(record => record.passed), [false, true]);
  assert.equal(result.records[1]?.exitCode, 0);
  assert.equal(result.repairAttempts, 0);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 0;\n');
  assert.equal(candidateGit(f.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
  assert.equal(await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, result.proposal.proposalHash, result.proposal.ops), 'applied');
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
});
test('observed failure drives same Engineer interface to one scoped repair and final reviewed bytes', async t => {
  const f = fixture(t);
  let candidate = '';
  f.client.engineerStream = async function* (request) {
    candidate = request.rootPath;
    assert.match(request.task, /not ok/);
    assert.match(request.task, /Expected values/);
    assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 0;\n');
    yield { event: 'proposal', data: { preview: await f.propose(request.rootPath, 2) } };
  };
  const result = await validateCandidate(f.client, await f.options(1));
  assert.deepEqual(result.records.map(record => record.passed), [false, false, true]);
  assert.match(observedFailure(result.records[1]!).summary, /1 failing test/);
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.proposal.ops[0]?.after, 'export const value = 2;\n');
  assert.equal(existsSync(candidate), false);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
});
test('decline creates no candidate and never executes code', async t => {
  const f = fixture(t);
  await assert.rejects(validateCandidate(f.client, { ...await f.options(), requestConsent: async () => false }), /not approved/);
  assert.equal(candidateGit(f.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});
test('dirty or untracked original refuses before consent or execution', async t => {
  const f = fixture(t); const options = await f.options();
  writeFileSync(join(f.root, 'untracked.txt'), 'preserve');
  let asked = false;
  await assert.rejects(validateCandidate(f.client, { ...options, requestConsent: async () => { asked = true; return true; } }), /clean committed/);
  assert.equal(asked, false);
  assert.equal(readFileSync(join(f.root, 'untracked.txt'), 'utf8'), 'preserve');
});
test('changed public preview cannot substitute different candidate code for stored hash', async t => {
  const f = fixture(t); const options = await f.options();
  options.proposal.ops[0]!.after = 'export const value = 999;\n';
  await assert.rejects(validateCandidate(f.client, options), /actual stored proposal/);
});
test('repair outside approved paths is refused and its candidate is cleaned', async t => {
  const f = fixture(t); let root = '';
  f.client.engineerStream = async function* (request) {
    root = request.rootPath;
    yield { event: 'proposal', data: { preview: await f.propose(root, 2, 'tests/value.test.js') } };
  };
  await assert.rejects(validateCandidate(f.client, await f.options(1)), /exceeded approved scope/);
  assert.equal(existsSync(root), false);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
});
test('repeated no-progress candidate stops rather than spending unlimited repair attempts', async t => {
  const f = fixture(t); let attempts = 0;
  f.client.engineerStream = async function* (request) {
    attempts++;
    yield { event: 'proposal', data: { preview: await f.propose(request.rootPath, 1) } };
  };
  await assert.rejects(validateCandidate(f.client, await f.options(1)), /without progress/);
  assert.equal(attempts, 1);
});
test('exit zero without actual test evidence is not a passing test run', async t => {
  const f = fixture(t, 'node -e "console.log(\'no checks\')"');
  await assert.rejects(validateCandidate(f.client, await f.options()), /without observable executed-test evidence/);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
});
test('large real test output retains executed-test footer within bounded records', async t => {
  const f = fixture(t, 'node -e "console.log(\'x\'.repeat(40000))" && node --test tests/*.test.js');
  const result = await validateCandidate(f.client, await f.options());
  assert.equal(result.records[1]?.passed, true);
  assert.ok(result.records[1]!.stdout.length <= 8000);
  assert.match(result.records[1]!.stdout, /# tests 2/);
  assert.equal(result.records[1]?.truncated, true);
});
test('changed validation scripts are refused before executing the changed command', async t => {
  const f = fixture(t);
  const changed = JSON.stringify({ type: 'module', scripts: { test: 'node -e "console.log(\'fake\')"' } });
  const proposal = ProposeChangesetResponseSchema.parse(await f.client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: f.root, ops: [{ op: 'replace', path: 'package.json', content: changed }],
  }));
  await assert.rejects(validateCandidate(f.client, { ...await f.options(), proposal }), /changed the approved validation scripts/);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
});
test('repair cannot weaken pinned tests even when test path is in the initial reviewed scope', async t => {
  const f = fixture(t);
  const proposal = ProposeChangesetResponseSchema.parse(await f.client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: f.root, ops: [
      { op: 'replace', path: 'src/value.js', content: 'export const value = 1;\n' },
      { op: 'replace', path: 'tests/value.test.js', content: readFileSync(join(f.root, 'tests/value.test.js'), 'utf8') },
    ],
  }));
  f.client.engineerStream = async function* (request) {
    yield { event: 'proposal', data: { preview: await f.propose(request.rootPath, 2, 'tests/value.test.js') } };
  };
  await assert.rejects(validateCandidate(f.client, { ...await f.options(), proposal }), /pinned validation assets/);
});
test('newly proposed test files are also pinned against repair weakening', async t => {
  const f = fixture(t);
  const testFile = 'tests/new.test.js';
  const proposal = ProposeChangesetResponseSchema.parse(await f.client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: f.root, ops: [
      { op: 'replace', path: 'src/value.js', content: 'export const value = 1;\n' },
      { op: 'create', path: testFile, content: 'import {test} from "node:test"; test("new",()=>{});\n' },
    ],
  }));
  f.client.engineerStream = async function* (request) {
    yield { event: 'proposal', data: { preview: await f.propose(request.rootPath, 2, testFile) } };
  };
  await assert.rejects(validateCandidate(f.client, { ...await f.options(), proposal }), /pinned validation assets/);
});
test('two unsuccessful changing repairs exhaust budget and never apply the original', async t => {
  const f = fixture(t); let attempts = 0;
  f.client.engineerStream = async function* (request) {
    attempts++;
    yield { event: 'proposal', data: { preview: await f.propose(request.rootPath, attempts + 2) } };
  };
  await assert.rejects(validateCandidate(f.client, await f.options(1)), /after 2 repair attempts/);
  assert.equal(attempts, 2);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
});
test('cancel during validation cleans the candidate and returns no apply material', async t => {
  const f = fixture(t); const controller = new AbortController();
  const options = await f.options();
  await assert.rejects(validateCandidate(f.client, {
    ...options, signal: controller.signal, onRecord: () => controller.abort(),
  }), /cancelled/);
  assert.equal(candidateGit(f.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
});
test('original drift during approved candidate checks is refused without overwriting it', async t => {
  const f = fixture(t);
  const options = await f.options();
  await assert.rejects(validateCandidate(f.client, {
    ...options, onProgress: () => writeFileSync(join(f.root, 'src/value.js'), 'external edit\n'),
  }), /clean committed base|source changed|STALE|source drift/i);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'external edit\n');
});
test('local runner does not inherit ambient values and shares policy refusal/cancellation', async t => {
  const f = fixture(t);
  process.env.MIGRAPILOT_CANDIDATE_TEST_AMBIENT = 'should-not-inherit';
  t.after(() => { delete process.env.MIGRAPILOT_CANDIDATE_TEST_AMBIENT; });
  const result = await commandRun({
    rootPath: f.root, command: ['node', '-e', 'console.log(process.env.MIGRAPILOT_CANDIDATE_TEST_AMBIENT ?? "absent")'],
  }, { PATH: process.env.PATH }, undefined, { inheritEnvironment: false });
  assert.equal(result.stdout.trim(), 'absent');
  await assert.rejects(commandRun({ rootPath: f.root, command: ['npm', 'run', 'deploy'] }), /external-effect/);
  const abort = new AbortController();
  setTimeout(() => abort.abort(), 30);
  await assert.rejects(commandRun({ rootPath: f.root, command: ['node', '-e', 'setTimeout(()=>{},10000)'] },
    { PATH: process.env.PATH }, abort.signal, { inheritEnvironment: false }), /cancelled/);
  assert.equal(workspaceToolMeta('command.run'), undefined, 'model tool surface remains unchanged');
});
test('canonical operation conversion refuses missing bytes rather than inventing a write', () => {
  assert.throws(() => candidateOperations({ proposalHash: 'hash', ops: [{ kind: 'modify', path: 'x' }] }), /exact before\/after/);
});
test('native task records repaired final proposal and candidate checks without claiming original verification', async () => {
  const task: EngineeringTask = {
    taskId: 'candidate-task', workspaceRoot: '/fixture', stage: 'awaiting_approval', checkpoint: 'Proposed',
    observedFiles: [], evidence: [], commands: [], repairAttempts: 0, completion: 'in_progress',
    proposal: { proposalHash: 'initial', approvalState: 'pending', operations: [], expectedVerification: ['test'] },
  };
  const outcome = approveEngineeringTask(task, async () => ({
    applied: true, proposal: { proposalHash: 'repaired', ops: [{ kind: 'modify', path: 'src/value.js', before: 'old', after: 'fixed' }] },
    repairAttempts: 1, records: [{
      id: 'test', stage: 'repair', command: ['npm', 'run', 'test'], cwd: '.', admitted: true,
      startedAt: 0, endedAt: 1, durationMs: 1, exitCode: 0, timedOut: false,
      stdout: '# tests 2\n# pass 2\n', stderr: '', truncated: false, passed: true,
    }],
  }));
  assert.ok(outcome);
  const result = await outcome.result;
  assert.equal(result.proposal?.proposalHash, 'repaired');
  assert.equal(result.proposal?.operations[0]?.after, 'fixed');
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.commands[0]?.status, 'passed');
  assert.equal(result.stage, 'testing'); assert.equal(result.completion, 'in_progress');
  assert.match(result.checkpoint, /Original-workspace checks.*have not run/);
});

test('original check executes real tests on exact applied bytes and preserves the applied changes', async t => {
  const f = fixture(t); const proposal = await f.propose(f.root, 2);
  await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
  const result = await verifyAppliedChangeset({
    rootPath: f.root, proposal, script: 'test', requestConsent: async plan => {
      assert.deepEqual(plan.command, ['npm', 'run', 'test']);
      assert.deepEqual(plan.paths, ['src/value.js']); return true;
    },
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.records[0]?.id, 'workspace.test');
  assert.match(result.records[0]!.stdout, /# tests 2/);
  assert.match(result.message, /Product\/owner acceptance is still required/);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
});

test('real original failure returns observed output without rollback or reapply', async t => {
  const f = fixture(t); const proposal = await f.propose(f.root, 1);
  await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
  const result = await verifyAppliedChangeset({ rootPath: f.root, proposal, script: 'test', requestConsent: async () => true });
  assert.equal(result.status, 'failed');
  assert.equal(result.records[0]?.exitCode, 1);
  assert.match(result.records[0]!.stdout, /not ok/);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 1;\n');
});

test('original execution decline and prior cancellation never run a command', async t => {
  const f = fixture(t); const proposal = await f.propose(f.root, 2);
  await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
  const options = { rootPath: f.root, proposal, script: 'test', requestConsent: async () => false };
  assert.equal((await verifyAppliedChangeset(options)).status, 'declined');
  const controller = new AbortController(); controller.abort();
  const result = await verifyAppliedChangeset({ ...options, signal: controller.signal });
  assert.equal(result.status, 'cancelled'); assert.deepEqual(result.records, []);
});

test('original source drift before consent is refused and does not overwrite external edits', async t => {
  const f = fixture(t); const proposal = await f.propose(f.root, 2); let asked = false;
  writeFileSync(join(f.root, 'src/value.js'), 'external edit\n');
  const result = await verifyAppliedChangeset({
    rootPath: f.root, proposal, script: 'test', requestConsent: async () => { asked = true; return true; },
  });
  assert.equal(result.status, 'unavailable'); assert.equal(asked, false);
  assert.match(result.message, /Applied source changed/);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'external edit\n');
});

test('script and newly added test drift while consent is open cannot authorize different checks', async t => {
  for (const target of ['package.json', 'tests/new.test.js']) {
    const f = fixture(t); const proposal = await f.propose(f.root, 2);
    await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
    const result = await verifyAppliedChangeset({
      rootPath: f.root, proposal, script: 'test', requestConsent: async () => {
        writeFileSync(join(f.root, target), target === 'package.json'
          ? JSON.stringify({ scripts: { test: 'node -e "console.log(\'fake\')"' } })
          : 'import {test} from "node:test"; test("new",()=>{});');
        return true;
      },
    });
    assert.equal(result.status, 'unavailable'); assert.deepEqual(result.records, []);
    assert.match(result.message, /scripts or validation assets changed/);
  }
});

test('original zero-exit test without executed evidence is unavailable rather than qualified', async t => {
  const f = fixture(t, 'node -e "console.log(\'no checks\')"'); const proposal = await f.propose(f.root, 2);
  await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
  const result = await verifyAppliedChangeset({ rootPath: f.root, proposal, script: 'test', requestConsent: async () => true });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.records[0]?.exitCode, 0);
  assert.match(result.message, /without observable executed-test evidence/);
});

test('original checks cannot qualify source they mutate during execution', async t => {
  const f = fixture(t, 'node -e "require(\'fs\').writeFileSync(\'src/value.js\',\'export const value = 9;\\n\')" && node --test tests/*.test.js');
  const proposal = await f.propose(f.root, 2);
  await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
  const result = await verifyAppliedChangeset({ rootPath: f.root, proposal, script: 'test', requestConsent: async () => true });
  assert.equal(result.status, 'unavailable'); assert.equal(result.records.length, 1);
  assert.match(result.message, /Applied source changed/);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 9;\n');
});

test('original cancellation during a real child command keeps applied edits and records no pass', async t => {
  const f = fixture(t, 'node -e "setTimeout(()=>{},10000)"'); const proposal = await f.propose(f.root, 2);
  await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
  const controller = new AbortController();
  const result = await verifyAppliedChangeset({
    rootPath: f.root, proposal, script: 'test', signal: controller.signal, requestConsent: async () => {
      setTimeout(() => controller.abort(), 200); return true;
    },
  });
  assert.equal(result.status, 'cancelled'); assert.equal(result.records[0]?.passed, false);
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 2;\n');
});

test('original check uses minimal environment and private HOME/cache with cleanup', async t => {
  const f = fixture(t, 'node -e "if(process.env.MIGRAPILOT_ORIGINAL_AMBIENT)process.exit(99);console.log(process.env.HOME)" && node --test tests/*.test.js');
  const proposal = await f.propose(f.root, 2);
  await applyApprovedChangeset(req => f.client.executeOperatorTool(req), f.root, proposal.proposalHash, proposal.ops);
  process.env.MIGRAPILOT_ORIGINAL_AMBIENT = 'not-inherited';
  t.after(() => { delete process.env.MIGRAPILOT_ORIGINAL_AMBIENT; });
  const result = await verifyAppliedChangeset({ rootPath: f.root, proposal, script: 'test', requestConsent: async () => true });
  assert.equal(result.status, 'passed');
  const home = result.records[0]!.stdout.split('\n').find(line => line.startsWith('/tmp/migrapilot-validation-home-'));
  assert.ok(home); assert.equal(existsSync(home), false);
});
