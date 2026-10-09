import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProposeChangesetResponseSchema, EditPreviewResponseSchema, EditApplyResponseSchema, type ProposeChangesetResponse } from '@migrapilot/protocol';
import { nodeChangesetFs, contractCompatible } from '@migrapilot/workspace-tools';
import { PilotError } from '@migrapilot/pilot-client';
import { MigraAiClient } from '../../services/migraAiClient.js';
import { createWorkspaceToolExecutor, WorkspaceToolError, type WorkspaceToolHost } from '../../services/workspaceTools.js';
import type { WorkspaceMutationDeps } from '../../services/workspaceToolExecution.js';
import { applyApprovedChangesetDetailed } from '../../services/changesetApply.js';

function setup(t: TestContext, overrides: Partial<WorkspaceToolHost> = {}, deps: WorkspaceMutationDeps = {}) {
  const root = mkdtempSync(join(tmpdir(), 'migrapilot-local-proposal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'a.txt'), 'old\n');
  writeFileSync(join(root, 'b.txt'), 'other\n');
  const prompts: string[] = [];
  const host: WorkspaceToolHost = {
    diagnostics: async () => ({ items: [] }),
    documentSymbols: async () => ({ symbols: [] }),
    requestApproval: async summary => { prompts.push(summary.tool); return true; },
    ...overrides,
  };
  const executor = createWorkspaceToolExecutor(host, deps);
  const logs: string[] = [];
  const client = new MigraAiClient({ baseUrl: () => 'http://127.0.0.1:1', timeoutMs: () => 1000, log: message => logs.push(message) });
  client.setWorkspaceToolExecutor(executor);
  const propose = async () => ProposeChangesetResponseSchema.parse(await client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: root, ops: [{ op: 'replace', path: 'a.txt', content: 'new\n' }],
  }));
  const mint = async (proposal: ProposeChangesetResponse) => {
    const input = { rootPath: root, proposalHash: proposal.proposalHash };
    const result = await client.executeTool({ tool: 'fs.applyChangeset', input });
    if (result.status !== 'approval_required') throw new Error('Expected a no-write approval mint');
    return { input, approvalId: result.approvalId };
  };
  return { root, client, executor, prompts, logs, propose, mint };
}

test('client proposal exposes exact diff/hash, mint writes nothing, confirmed consume applies once locally', async t => {
  const f = setup(t);
  const proposal = await f.propose();
  assert.match(proposal.proposalHash, /^[a-f0-9]{64}$/);
  assert.equal(proposal.ops[0]?.before, 'old\n');
  assert.equal(proposal.ops[0]?.after, 'new\n');
  const approval = await f.mint(proposal);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
  assert.deepEqual(f.prompts, []);
  const applied = await f.client.executeTool({ tool: 'fs.applyChangeset', ...approval });
  assert.equal(applied.status, 'executed');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'new\n');
  assert.deepEqual(f.prompts, ['fs.applyChangeset']);
  await assert.rejects(f.client.executeTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
});

test('native confirmation uses the same handshake without a duplicate editor prompt', async t => {
  const f = setup(t, { requestApproval: async () => { throw new Error('Duplicate prompt'); } });
  const proposal = await f.propose();
  const result = await applyApprovedChangesetDetailed(request => f.client.executeOperatorTool(request), f.root, proposal.proposalHash);
  assert.equal(result.applied, true);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'new\n');
});

test('operator decline is correlated cancellation, never an ok result; rejected token cannot retry', async t => {
  const f = setup(t, { requestApproval: async () => false });
  const approval = await f.mint(await f.propose());
  await assert.rejects(f.client.executeTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'CANCELLED');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
  assert.ok(f.logs.some(message => message.includes('CANCELLED')));
  await assert.rejects(f.client.executeTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
});

test('source drift before mint or after approval refuses every write', async t => {
  const f = setup(t);
  const proposal = await f.propose();
  const approval = await f.mint(proposal);
  writeFileSync(join(f.root, 'a.txt'), 'external\n');
  await assert.rejects(f.client.executeTool({ tool: 'fs.applyChangeset', input: approval.input }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
  await assert.rejects(f.client.executeOperatorTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'external\n');
});

test('approval cannot be redirected to a different root or different proposal', async t => {
  const f = setup(t);
  const other = setup(t);
  const approval = await f.mint(await f.propose());
  for (const input of [{ ...approval.input, rootPath: other.root }, { ...approval.input, proposalHash: 'different' }]) {
    await assert.rejects(f.client.executeOperatorTool({ tool: 'fs.applyChangeset', input, approvalId: approval.approvalId }),
      error => error instanceof PilotError && error.code === 'INVALID_STATE');
  }
  assert.equal(readFileSync(join(other.root, 'a.txt'), 'utf8'), 'old\n');
  assert.equal((await f.client.executeOperatorTool({ tool: 'fs.applyChangeset', ...approval })).status, 'executed');
});

test('raw-operation and model-supplied approval/confirmation bypasses are refused', async t => {
  const f = setup(t);
  const approval = await f.mint(await f.propose());
  for (const input of [
    { rootPath: f.root, ops: [{ op: 'replace', path: 'a.txt', content: 'unreviewed' }] },
    { ...approval.input, ops: [{ op: 'replace', path: 'a.txt', content: 'unreviewed' }] },
    { ...approval.input, approvalId: approval.approvalId, operatorConfirmed: true },
  ]) await assert.rejects(f.executor('fs.applyChangeset', input));
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
});

test('mutating returned proposal content cannot substitute stored content under the original hash', async t => {
  const f = setup(t);
  const preview = await f.client.runReadOnlyTool<ProposeChangesetResponse>('fs.proposeChangeset', {
    rootPath: f.root, ops: [{ op: 'replace', path: 'a.txt', content: 'new\n' }],
  });
  const op = preview.changeset.ops[0];
  if (!op || op.op !== 'replace') throw new Error('Expected replace');
  op.content = 'substituted\n';
  assert.equal((await applyApprovedChangesetDetailed(request => f.client.executeOperatorTool(request), f.root, preview.proposalHash)).applied, true);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'new\n');
});

test('approval and proposal expiration remain explicit and non-mutating', async t => {
  let now = 1000;
  const f = setup(t, {}, { now: () => now });
  const proposal = await f.propose();
  const approval = await f.mint(proposal);
  now += 5 * 60_000;
  await assert.rejects(f.client.executeOperatorTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
  now += 30 * 60_000;
  await assert.rejects(f.client.executeTool({ tool: 'fs.applyChangeset', input: approval.input }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
});

test('Stop during an editor approval cannot apply or leave a reusable token', async t => {
  const abort = new AbortController();
  const f = setup(t, { requestApproval: async () => { abort.abort(); return true; } });
  const approval = await f.mint(await f.propose());
  await assert.rejects(f.client.executeTool({ tool: 'fs.applyChangeset', ...approval }, abort.signal),
    error => error instanceof PilotError && error.code === 'CANCELLED');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
  await assert.rejects(f.client.executeOperatorTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
});

test('Stop resolves while the editor dialog remains unanswered', { timeout: 2000 }, async t => {
  const abort = new AbortController();
  let started!: () => void;
  const asking = new Promise<void>(resolve => { started = resolve; });
  const f = setup(t, { requestApproval: async () => {
    started();
    return new Promise<boolean>(() => {});
  } });
  const approval = await f.mint(await f.propose());
  const consume = f.client.executeTool({ tool: 'fs.applyChangeset', ...approval }, abort.signal);
  await asking;
  abort.abort();
  await assert.rejects(consume, error => error instanceof PilotError && error.code === 'CANCELLED');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
  await assert.rejects(f.client.executeOperatorTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
});

test('dirty editor guard runs even for already confirmed native actions', async t => {
  const f = setup(t, { assertCanApply: () => { throw new WorkspaceToolError('Save local edits first.', 'INVALID_STATE'); } });
  const approval = await f.mint(await f.propose());
  await assert.rejects(f.client.executeOperatorTool({ tool: 'fs.applyChangeset', ...approval }),
    error => error instanceof PilotError && error.code === 'INVALID_STATE');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
});

test('dry-run does not mint, prompt, consume or mutate', async t => {
  const f = setup(t);
  const proposal = await f.propose();
  const input = { rootPath: f.root, proposalHash: proposal.proposalHash };
  assert.equal((await f.client.executeTool({ tool: 'fs.applyChangeset', input, dryRun: true })).status, 'dry_run');
  assert.deepEqual(f.prompts, []);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
  assert.equal((await applyApprovedChangesetDetailed(request => f.client.executeOperatorTool(request), f.root, proposal.proposalHash)).applied, true);
});

test('legacy line edits preview exact contents, mint without writing and apply the stored snapshot', async t => {
  const f = setup(t);
  const input = { rootPath: f.root, changes: [{ path: 'a.txt', startLine: 1, endLine: 1, replacement: 'patched' }] };
  const preview = EditPreviewResponseSchema.parse(await f.client.runReadOnlyTool('edit.preview', input));
  assert.deepEqual(preview.files, [{ path: 'a.txt', before: 'old\n', after: 'patched\n' }]);
  const minted = await f.client.executeTool({ tool: 'edit.apply', input });
  if (minted.status !== 'approval_required') throw new Error('Expected approval');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
  const applied = await f.client.executeOperatorTool({ tool: 'edit.apply', input, approvalId: minted.approvalId });
  if (applied.status !== 'executed') throw new Error('Expected executed');
  assert.deepEqual(EditApplyResponseSchema.parse(applied.result).files, [{ path: 'a.txt', changed: true }]);
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'patched\n');
});

test('multi-file write failure rolls back; false read-back cannot report applied', async t => {
  for (const noOp of [false, true]) {
    const fs = nodeChangesetFs();
    const f = setup(t, {}, { fs: { ...fs, writeFile: (path, content) => {
      if (noOp && content.startsWith('new')) return;
      fs.writeFile(path, content);
      if (!noOp && path.endsWith('b.txt') && content === 'new b\n') throw new Error('Controlled second write failure');
    } } });
    const preview = ProposeChangesetResponseSchema.parse(await f.client.runReadOnlyTool('fs.proposeChangeset', {
      rootPath: f.root, ops: [
        { op: 'replace', path: 'a.txt', content: 'new a\n' },
        { op: 'replace', path: 'b.txt', content: 'new b\n' },
      ],
    }));
    await assert.rejects(applyApprovedChangesetDetailed(request => f.client.executeOperatorTool(request), f.root, preview.proposalHash),
      error => error instanceof PilotError && error.code === 'SERVER_ERROR');
    assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'old\n');
    assert.equal(readFileSync(join(f.root, 'b.txt'), 'utf8'), 'other\n');
  }
});

test('create, patch and explicitly allowed delete use the same canonical apply', async t => {
  const f = setup(t);
  const preview = ProposeChangesetResponseSchema.parse(await f.client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: f.root, allowDelete: true, ops: [
      { op: 'create', path: 'new/c.txt', content: 'created' },
      { op: 'patch', path: 'a.txt', startLine: 1, endLine: 1, replacement: 'patched' },
      { op: 'delete', path: 'b.txt' },
    ],
  }));
  assert.equal((await applyApprovedChangesetDetailed(request => f.client.executeOperatorTool(request), f.root, preview.proposalHash)).applied, true);
  assert.equal(readFileSync(join(f.root, 'new/c.txt'), 'utf8'), 'created');
  assert.equal(readFileSync(join(f.root, 'a.txt'), 'utf8'), 'patched\n');
  assert.equal(existsSync(join(f.root, 'b.txt')), false);
});

test('rollback never removes a pre-existing directory', async t => {
  const fs = nodeChangesetFs();
  const f = setup(t, {}, { fs: { ...fs, writeFile: (path, content) => {
    fs.writeFile(path, content);
    if (content === 'fault') throw new Error('Controlled failure after create');
  } } });
  mkdirSync(join(f.root, 'kept'));
  const preview = ProposeChangesetResponseSchema.parse(await f.client.runReadOnlyTool('fs.proposeChangeset', {
    rootPath: f.root, ops: [{ op: 'mkdir', path: 'kept' }, { op: 'create', path: 'kept/new.txt', content: 'fault' }],
  }));
  await assert.rejects(applyApprovedChangesetDetailed(request => f.client.executeOperatorTool(request), f.root, preview.proposalHash));
  assert.equal(existsSync(join(f.root, 'kept')), true);
  assert.equal(existsSync(join(f.root, 'kept/new.txt')), false);
});

test('native apply cannot fall back to the remote Brain without a local executor', async () => {
  const client = new MigraAiClient({ baseUrl: () => 'http://127.0.0.1:1', timeoutMs: () => 1000, log: () => {} });
  await assert.rejects(client.executeOperatorTool({ tool: 'fs.applyChangeset', input: { rootPath: '/local', proposalHash: 'h' } }),
    error => error instanceof PilotError && error.code === 'CAPABILITY_MISSING');
  assert.equal(contractCompatible('1.0.0').compatible, false);
});
