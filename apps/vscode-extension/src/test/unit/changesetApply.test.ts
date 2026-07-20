// The engine approval sequence for applying a build changeset: mint a single-use
// token, then consume it to apply exactly once. This is the "build the app" apply
// step — it must be a genuine two-call handshake, never a blind single write.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyApprovedChangeset, type ExecResult } from '../../services/changesetApply.js';

function recorder(results: ExecResult[]) {
  const calls: Array<{ tool: string; input: unknown; approvalId?: string }> = [];
  let i = 0;
  const execute = async (req: { tool: string; input: unknown; approvalId?: string }): Promise<ExecResult> => {
    calls.push(req);
    return results[Math.min(i++, results.length - 1)]!;
  };
  return { execute, calls };
}

test('mints a token then consumes it — applied exactly once', async () => {
  const { execute, calls } = recorder([
    { status: 'approval_required', approvalId: 'appr_1' },
    { status: 'executed' },
  ]);
  const outcome = await applyApprovedChangeset(execute, '/ws', 'hash_abc');
  assert.equal(outcome, 'applied');
  assert.equal(calls.length, 2, 'exactly two calls: mint + consume');
  assert.equal(calls[0]!.approvalId, undefined, 'first call carries NO token (mints one)');
  assert.equal(calls[1]!.approvalId, 'appr_1', 'second call consumes the minted token');
  assert.deepEqual(calls[1]!.input, { rootPath: '/ws', proposalHash: 'hash_abc' });
});

test('never applies when the mint does not require approval and did not execute', async () => {
  const { execute, calls } = recorder([{ status: 'failed' }]);
  assert.equal(await applyApprovedChangeset(execute, '/ws', 'h'), 'not_applied');
  assert.equal(calls.length, 1, 'no consume call without a minted token');
});

test('an approval_required with no token is treated as not applied (never a blind write)', async () => {
  const { execute, calls } = recorder([{ status: 'approval_required' }]); // token missing
  assert.equal(await applyApprovedChangeset(execute, '/ws', 'h'), 'not_applied');
  assert.equal(calls.length, 1);
});

test('a deployment that applies immediately (no gate) is reported applied', async () => {
  const { execute, calls } = recorder([{ status: 'executed' }]);
  assert.equal(await applyApprovedChangeset(execute, '/ws', 'h'), 'applied');
  assert.equal(calls.length, 1, 'no second call needed when already executed');
});

test('a rejected/failed consume leaves the changeset not applied', async () => {
  const { execute } = recorder([
    { status: 'approval_required', approvalId: 'appr_x' },
    { status: 'failed' },
  ]);
  assert.equal(await applyApprovedChangeset(execute, '/ws', 'h'), 'not_applied');
});
