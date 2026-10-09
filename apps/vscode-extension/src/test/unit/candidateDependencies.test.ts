import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { candidateGit, workspaceToolMeta } from '@migrapilot/workspace-tools';
import { ProposeChangesetResponseSchema } from '@migrapilot/protocol';
import { candidateDependencyPlan, candidateHasDependencies } from '../../services/candidateDependencies.js';
import { validateCandidate, type CandidateWorkflowOptions } from '../../services/candidateWorkflow.js';
import { MigraAiClient } from '../../services/migraAiClient.js';
import { createWorkspaceToolExecutor } from '../../services/workspaceTools.js';

function commit(root: string): void {
  candidateGit(root, ['add', '.']);
  candidateGit(root, ['-c', 'user.name=MigraPilot Fixture', '-c', 'user.email=fixture@migrateck.invalid',
    'commit', '-qm', 'Locked dependency fixture\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>']);
}

async function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'migrapilot-dependencies-unit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['vendor/source', 'src', 'tests', 'fixture-home']) mkdirSync(join(root, path), { recursive: true });
  const env = {
    PATH: process.env.PATH, HOME: join(root, 'fixture-home'), LANG: 'C.UTF-8',
    npm_config_cache: join(root, 'fixture-home/cache'),
    npm_config_userconfig: join(root, 'fixture-home/user.npmrc'),
    npm_config_globalconfig: join(root, 'fixture-home/global.npmrc'),
  };
  writeFileSync(join(root, 'vendor/source/package.json'), JSON.stringify({
    name: 'migrapilot-local-check', version: '1.0.0', type: 'module', exports: './index.js',
    scripts: { postinstall: 'node -e "require(\'fs\').writeFileSync(\'install-hook-ran\',\'yes\')"' },
  }));
  writeFileSync(join(root, 'vendor/source/index.js'), 'export const required = 2;\n');
  execFileSync('npm', ['pack', '--ignore-scripts', '--offline', '--pack-destination', join(root, 'vendor')],
    { cwd: join(root, 'vendor/source'), env, stdio: 'pipe' });
  rmSync(join(root, 'vendor/source'), { recursive: true });
  writeFileSync(join(root, '.gitignore'), 'node_modules/\nfixture-home/\n');
  writeFileSync(join(root, 'src/value.js'), 'export const value = 0;\n');
  writeFileSync(join(root, 'tests/value.test.js'), 'import {test} from "node:test"; import assert from "node:assert/strict"; import {required} from "migrapilot-local-check"; import {value} from "../src/value.js"; test("locked dependency value",()=>assert.equal(value,required));');
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    type: 'module', scripts: {
      test: 'node --test --test-reporter=tap tests/*.test.js',
      preinstall: 'node -e "require(\'fs\').writeFileSync(\'root-install-hook-ran\',\'yes\')"',
    }, devDependencies: { 'migrapilot-local-check': 'file:vendor/migrapilot-local-check-1.0.0.tgz' },
  }));
  execFileSync('npm', ['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit', '--no-fund'], { cwd: root, env, stdio: 'pipe' });
  candidateGit(root, ['init', '-q']); commit(root);
  const client = new MigraAiClient({ baseUrl: () => 'http://127.0.0.1:1', timeoutMs: () => 500, log() {} });
  client.setWorkspaceToolExecutor(createWorkspaceToolExecutor({
    diagnostics: async () => ({ items: [] }), documentSymbols: async () => ({ symbols: [] }),
    requestApproval: async () => { throw new Error('Unexpected duplicate editor approval'); },
  }));
  const proposal = ProposeChangesetResponseSchema.parse(await client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: root, ops: [{ op: 'replace', path: 'src/value.js', content: 'export const value = 2;\n' }],
  }));
  const options: CandidateWorkflowOptions = {
    rootPath: root, proposal, script: 'test', goal: 'Use the required dependency value.',
    prepareDependencies: true, requestConsent: async () => true,
  };
  const changeLock = (change: (lock: { packages: Record<string, { resolved?: string; link?: boolean }> }) => void) => {
    const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    change(lock); writeFileSync(join(root, 'package-lock.json'), JSON.stringify(lock)); commit(root);
  };
  return { root, client, options, changeLock };
}

test('real offline npm ci prepares only the candidate and disables root/dependency install hooks', async t => {
  const f = await fixture(t); let candidate = '';
  assert.equal(candidateHasDependencies(f.root), true);
  f.options.requestConsent = async plan => {
    assert.deepEqual(plan.preparation?.command, ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
    assert.match(plan.preparation!.fingerprint, /^[a-f0-9]{64}$/); return true;
  };
  f.options.onProgress = () => {
    const worktrees = candidateGit(f.root, ['worktree', 'list', '--porcelain']).split('\n');
    candidate = worktrees.filter(line => line.startsWith('worktree ')).at(-1)!.slice(9);
  };
  f.options.onRecord = record => {
    if (record.id !== 'candidate.dependencies') return;
    const worktrees = candidateGit(f.root, ['worktree', 'list', '--porcelain']).split('\n');
    candidate = worktrees.filter(line => line.startsWith('worktree ')).at(-1)!.slice(9);
    assert.equal(existsSync(join(candidate, 'node_modules/migrapilot-local-check/index.js')), true);
    assert.equal(existsSync(join(candidate, 'root-install-hook-ran')), false);
    assert.equal(existsSync(join(candidate, 'node_modules/migrapilot-local-check/install-hook-ran')), false);
  };
  const result = await validateCandidate(f.client, f.options);
  assert.deepEqual(result.records.map(record => record.passed), [true, false, true]);
  assert.equal(result.records[0]?.id, 'candidate.dependencies');
  assert.equal(result.records[0]?.exitCode, 0);
  assert.equal(existsSync(candidate), false);
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
  assert.equal(readFileSync(join(f.root, 'src/value.js'), 'utf8'), 'export const value = 0;\n');
  assert.equal(workspaceToolMeta('command.run'), undefined);
});

test('declined preparation consent runs nothing and creates no candidate', async t => {
  const f = await fixture(t); f.options.requestConsent = async () => false;
  await assert.rejects(validateCandidate(f.client, f.options), /not approved/);
  assert.equal(candidateGit(f.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('missing lock and unsupported v1 lock refuse rather than generate dependency versions', async t => {
  const f = await fixture(t);
  rmSync(join(f.root, 'package-lock.json'));
  assert.throws(() => candidateDependencyPlan(f.root), /requires package-lock/);
  writeFileSync(join(f.root, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1 }));
  assert.throws(() => candidateDependencyPlan(f.root), /v2\/v3/);
});

test('project registry config presence refuses without reading config contents', async t => {
  const f = await fixture(t);
  mkdirSync(join(f.root, '.npmrc'));
  assert.throws(() => candidateDependencyPlan(f.root), /No credentials were read/);
});

test('workspace, linked directory and shrinkwrap preparation refuse explicitly', async t => {
  const f = await fixture(t);
  f.changeLock(lock => { lock.packages['node_modules/migrapilot-local-check']!.link = true; });
  assert.throws(() => candidateDependencyPlan(f.root), /Linked\/local-directory/);
  writeFileSync(join(f.root, 'npm-shrinkwrap.json'), '{}');
  assert.throws(() => candidateDependencyPlan(f.root), /not npm-shrinkwrap/);
  writeFileSync(join(f.root, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
  assert.throws(() => candidateDependencyPlan(f.root), /Workspace\/monorepo/);
});

test('escaping paths, credential URLs and non-HTTPS dependency sources refuse before install', async t => {
  const f = await fixture(t);
  for (const resolved of ['file:../outside.tgz', 'file:%2Ftmp%2Foutside.tgz', 'http://example.invalid/archive.tgz', 'https://untrusted-user@example.invalid/archive.tgz', 'git+https://example.invalid/repo.git']) {
    f.changeLock(lock => { lock.packages['node_modules/migrapilot-local-check']!.resolved = resolved; });
    assert.throws(() => candidateDependencyPlan(f.root), /escapes|Only credential-free/);
  }
});

test('unignored or tracked dependency directories cannot broaden candidate changes', async t => {
  const f = await fixture(t); writeFileSync(join(f.root, '.gitignore'), 'fixture-home/\n');
  assert.throws(() => candidateDependencyPlan(f.root), /Ignore node_modules/);
  mkdirSync(join(f.root, 'node_modules')); writeFileSync(join(f.root, 'node_modules/tracked.js'), 'preserve');
  commit(f.root);
  assert.throws(() => candidateDependencyPlan(f.root), /Tracked node_modules/);
});

test('failed locked install stops before baseline/model repair and preserves original', async t => {
  const f = await fixture(t); let called = false;
  f.client.engineerStream = async function* () { called = true; throw new Error('Must not repair tooling'); };
  writeFileSync(join(f.root, 'package.json'), readFileSync(join(f.root, 'package.json'), 'utf8').replace('1.0.0.tgz', '2.0.0.tgz'));
  commit(f.root); const records: string[] = [];
  f.options.onRecord = record => records.push(record.id);
  await assert.rejects(validateCandidate(f.client, f.options), /Locked dependency preparation failed/);
  assert.deepEqual(records, ['candidate.dependencies']); assert.equal(called, false);
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('cancellation after actual install records its exit but never checks or applies original', async t => {
  const f = await fixture(t); const controller = new AbortController(); const records: string[] = [];
  f.options.signal = controller.signal;
  f.options.onRecord = record => { records.push(record.id); controller.abort(); };
  await assert.rejects(validateCandidate(f.client, f.options), /cancelled/);
  assert.deepEqual(records, ['candidate.dependencies']);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
  assert.equal(candidateGit(f.root, ['worktree', 'list', '--porcelain']).match(/^worktree /gm)?.length, 1);
});

test('committed dependency archive drift during consent cannot authorize different package bytes', async t => {
  const f = await fixture(t);
  f.options.requestConsent = async () => {
    writeFileSync(join(f.root, 'vendor/migrapilot-local-check-1.0.0.tgz'), 'different archive'); commit(f.root); return true;
  };
  await assert.rejects(validateCandidate(f.client, f.options), /local archive changed/);
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('prepared candidate cannot change the installed dependency manifest in its initial proposal', async t => {
  const f = await fixture(t);
  const text = readFileSync(join(f.root, 'package.json'), 'utf8');
  const proposal = ProposeChangesetResponseSchema.parse(await f.client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: f.root, ops: [{ op: 'replace', path: 'package.json', content: text.replace('1.0.0.tgz', '2.0.0.tgz') }],
  }));
  await assert.rejects(validateCandidate(f.client, { ...f.options, proposal }), /manifest, lock or local archive changed/);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
});

const requireCjs = createRequire(__filename);
let preparationChoice = 'Prepare locked dependencies (install scripts disabled)';
let candidateDecision: () => Promise<string | undefined> = async () => 'Run candidate checks';
const prompts: string[] = [];
const stub = {
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  ProgressLocation: { Notification: 15 },
  workspace: { isTrusted: true, textDocuments: [], openTextDocument: async () => ({ uri: {} }) },
  window: {
    showQuickPick: async (choices: string[]) => choices.includes(preparationChoice) ? preparationChoice : choices[0],
    showInformationMessage: async (_message: string, ...actions: string[]) => actions.includes('Apply') ? 'Apply' : undefined,
    showWarningMessage: async (message: string, ...actions: unknown[]) => {
      if (!actions.length) return undefined;
      prompts.push(message);
      return message.includes('ORIGINAL workspace') ? undefined : candidateDecision();
    },
    withProgress: async (_options: unknown, callback: (progress: { report(message: unknown): void }, token: { onCancellationRequested(callback: () => void): { dispose(): void } }) => Promise<unknown>) =>
      callback({ report() {} }, { onCancellationRequested: () => ({ dispose() {} }) }),
  },
  commands: { executeCommand: async () => undefined },
};
const moduleCtor = requireCjs('node:module') as { _load(request: string, parent: unknown, main: boolean): unknown };
const originalLoad = moduleCtor._load.bind(moduleCtor);
moduleCtor._load = (request, parent, main) => request === 'vscode' ? stub : originalLoad(request, parent, main);
const native = requireCjs('../../services/candidateWorkflowVscode.js') as typeof import('../../services/candidateWorkflowVscode.js');
moduleCtor._load = originalLoad;

function resetNative(): void {
  stub.workspace.isTrusted = true; prompts.length = 0;
  preparationChoice = 'Prepare locked dependencies (install scripts disabled)';
  candidateDecision = async () => 'Run candidate checks';
}

test('native preparation choice/consent surfaces exact locked install and preserves original dependency absence', async t => {
  resetNative(); const f = await fixture(t);
  const result = await native.validateAndApplyChangeset(f.client, f.root, f.options.proposal, f.options.goal);
  assert.equal(result.applied, true);
  assert.deepEqual(result.records?.map(record => record.id), ['candidate.dependencies', 'candidate.test', 'candidate.test']);
  assert.match(prompts[0]!, /npm ci --ignore-scripts --no-audit --no-fund/);
  assert.match(prompts[0]!, /no ambient registry credentials/);
  assert.equal(result.workspaceVerification?.status, 'declined');
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('native check-without-preparation preserves previous behavior and never installs implicitly', async t => {
  resetNative(); const f = await fixture(t); preparationChoice = 'Check without dependency preparation';
  f.client.engineerStream = async function* () { yield { event: 'error', data: { message: 'No qualified repair' } }; };
  const result = await native.validateAndApplyChangeset(f.client, f.root, f.options.proposal, f.options.goal);
  assert.equal(result.applied, false);
  assert.ok(result.records?.every(record => record.id !== 'candidate.dependencies'));
  assert.match(prompts[0]!, /No dependency preparation will run/);
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('native decline or cancellation of locked execution never installs or applies', async t => {
  resetNative(); const f = await fixture(t);
  candidateDecision = async () => undefined;
  const declined = await native.validateAndApplyChangeset(f.client, f.root, f.options.proposal, f.options.goal);
  assert.equal(declined.applied, false); assert.deepEqual(declined.records, []);
  const controller = new AbortController();
  candidateDecision = () => { controller.abort(); return new Promise(() => {}); };
  const cancelled = await native.validateAndApplyChangeset(f.client, f.root, f.options.proposal, f.options.goal, controller.signal);
  assert.equal(cancelled.applied, false); assert.deepEqual(cancelled.records, []);
  assert.match(cancelled.message!, /cancelled/);
  assert.equal(candidateGit(f.root, ['status', '--porcelain']), '');
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('native trust revocation before locked execution is rechecked after consent', async t => {
  resetNative(); const f = await fixture(t);
  candidateDecision = async () => { stub.workspace.isTrusted = false; return 'Run candidate checks'; };
  const result = await native.validateAndApplyChangeset(f.client, f.root, f.options.proposal, f.options.goal);
  assert.equal(result.applied, false); assert.deepEqual(result.records, []);
  assert.match(result.message!, /Trust this workspace/);
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('public consent plan mutation cannot replace the actual locked dependency command', async t => {
  const f = await fixture(t);
  f.options.requestConsent = async plan => {
    plan.preparation!.command.splice(0, plan.preparation!.command.length, 'node', '-e', 'process.exit(0)');
    plan.preparation!.fingerprint = 'substituted';
    return true;
  };
  const result = await validateCandidate(f.client, f.options);
  assert.deepEqual(result.records[0]?.command, ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  assert.deepEqual(result.records.map(record => record.passed), [true, false, true]);
  assert.equal(existsSync(join(f.root, 'node_modules')), false);
});

test('lock package entries cannot nominate noncanonical install locations outside node_modules', async t => {
  const f = await fixture(t);
  f.changeLock(lock => { lock.packages['src/injected'] = { resolved: 'https://example.invalid/archive.tgz' }; });
  assert.throws(() => candidateDependencyPlan(f.root), /canonical locations under node_modules/);
});
