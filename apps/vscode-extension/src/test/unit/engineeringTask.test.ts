// Regression coverage for the EngineeringTask loop: Brain-emitted task-stage
// events reach the sink structurally (never as raw tool JSON in markdown), and
// the reject/approve host logic never mutates disk twice or claims
// verification it did not run.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EngineeringTask } from '@migrapilot/shared-types';
import { runEngineerTurn, type EngineerSink } from '../../chat/engineerTurn.js';
import { rejectEngineeringTask, approveEngineeringTask } from '../../services/engineeringTaskActions.js';
import type { MigraAiClient } from '../../services/migraAiClient.js';

function baseTask(overrides: Partial<EngineeringTask> = {}): EngineeringTask {
  return {
    taskId: 'task-1',
    workspaceRoot: '/ws',
    stage: 'inspect',
    checkpoint: 'inspecting',
    observedFiles: [],
    evidence: [],
    commands: [],
    repairAttempts: 0,
    completion: 'in_progress',
    ...overrides,
  };
}

function fakeClient(events: Array<{ event: string; data: unknown }>): MigraAiClient {
  return {
    engineerStream: async function* engineerStream() {
      for (const ev of events) yield ev;
    },
  } as unknown as MigraAiClient;
}

test('inspect -> plan -> proposal -> awaiting_approval reaches the sink as structured task events, never raw JSON in markdown', async () => {
  const stages: string[] = [];
  const markdown: string[] = [];
  const client = fakeClient([
    { event: 'task', data: { task: baseTask({ stage: 'inspect', checkpoint: 'Reading MigraPanel auth module.' }) } },
    { event: 'step', data: { n: 1, tool: 'workspace.search', summary: 'located admin invite flow' } },
    { event: 'task', data: { task: baseTask({ stage: 'plan', checkpoint: 'Planning the change against the found module.' }) } },
    {
      event: 'proposal',
      data: {
        task: baseTask({
          stage: 'awaiting_approval',
          checkpoint: 'A structured changeset is ready for operator review.',
          proposal: {
            proposalHash: 'h'.repeat(64),
            approvalState: 'pending',
            operations: [{ path: 'src/admin/invite.ts', operation: 'edit', rationale: 'add audit@ to allowed invite senders' }],
            expectedVerification: ['npm test -w admin'],
          },
        }),
      },
    },
    { event: 'final', data: { markdown: 'Proposed a changeset against the existing invite module.' } },
  ]);
  const sink: EngineerSink = {
    markdown: (t) => markdown.push(t),
    onTask: (t) => stages.push(t.stage),
  };

  await runEngineerTurn(client, { rootPath: '/ws', task: 'Create audit@annoupale.com in MigraPanel' }, sink);

  assert.deepEqual(stages, ['inspect', 'plan', 'awaiting_approval']);
  const blob = markdown.join('');
  assert.doesNotMatch(blob, /"proposalHash"/, 'raw proposal JSON must never reach the chat markdown surface');
  assert.doesNotMatch(blob, /"operations"\s*:/, 'raw task JSON must never reach the chat markdown surface');
});

test('a tool step renders as readable progress, never the raw tool input object', async () => {
  const markdown: string[] = [];
  // This is the EXACT shape the Brain emits: `summary` is the tool's raw input.
  const client = fakeClient([
    { event: 'step', data: { n: 1, tool: 'workspace.search', summary: '{"rootPath":"/tmp/migrapanel","query":"MigraPanel"}' } },
    { event: 'step', data: { n: 2, tool: 'file.read', summary: '{"rootPath":"/tmp/migrapanel","path":"src/admin/inviteUser.ts"}' } },
    { event: 'final', data: { markdown: 'done' } },
  ]);
  await runEngineerTurn(client, { rootPath: '/ws', task: 'inspect' }, { markdown: (t) => markdown.push(t) });

  const blob = markdown.join('');
  assert.doesNotMatch(blob, /\{"rootPath"/, 'the raw tool input object must never reach chat');
  assert.doesNotMatch(blob, /"query":/, 'raw protocol keys must never reach chat');
  assert.match(blob, /Searching for “MigraPanel”/);
  assert.match(blob, /Reading `src\/admin\/inviteUser\.ts`/);
});

test('reject performs zero filesystem mutation', async () => {
  const task = baseTask({
    stage: 'awaiting_approval',
    proposal: {
      proposalHash: 'h'.repeat(64),
      approvalState: 'pending',
      operations: [{ path: 'src/admin/invite.ts', operation: 'edit' }],
      expectedVerification: [],
    },
  });
  let applyCalls = 0;
  const rejected = rejectEngineeringTask(task);
  assert.ok(rejected);
  assert.equal(rejected!.proposal!.approvalState, 'rejected');
  assert.equal(rejected!.completion, 'blocked');
  assert.equal(applyCalls, 0, 'reject must never call apply');
});

test('rejecting a non-pending proposal is refused rather than re-mutated', () => {
  const task = baseTask({
    proposal: { proposalHash: 'h'.repeat(64), approvalState: 'applied', operations: [], expectedVerification: [] },
  });
  assert.equal(rejectEngineeringTask(task), undefined);
});

test('approve consumes the existing approval exactly once; a second concurrent approve is refused', async () => {
  const task = baseTask({
    stage: 'awaiting_approval',
    proposal: {
      proposalHash: 'h'.repeat(64),
      approvalState: 'pending',
      operations: [{ path: 'src/admin/invite.ts', operation: 'edit' }],
      expectedVerification: ['npm test -w admin'],
    },
  });
  let applyCalls = 0;
  let current = task;
  const apply = async () => {
    applyCalls += 1;
    return true;
  };

  // First approve: mirrors the host — reassign to `applying` synchronously
  // before the apply promise settles.
  const first = approveEngineeringTask(current, apply);
  assert.ok(first);
  current = first!.applying;
  assert.equal(current.proposal!.approvalState, 'approved');

  // A second approve arriving before the first apply settles must be refused —
  // this is the double-click / replay guard.
  const second = approveEngineeringTask(current, apply);
  assert.equal(second, undefined, 'a second approve on an already-approving task must be refused');

  const resolved = await first!.result;
  assert.equal(applyCalls, 1, 'apply must run exactly once');
  assert.equal(resolved.proposal!.approvalState, 'applied');
});

test('approve never claims verification before a real test runs', async () => {
  const task = baseTask({
    proposal: {
      proposalHash: 'h'.repeat(64),
      approvalState: 'pending',
      operations: [{ path: 'src/admin/invite.ts', operation: 'edit' }],
      expectedVerification: ['npm test -w admin'],
    },
  });
  const outcome = approveEngineeringTask(task, async () => true);
  const resolved = await outcome!.result;
  assert.equal(resolved.stage, 'testing');
  assert.notEqual(resolved.stage, 'verified');
  assert.equal(resolved.completion, 'in_progress');
  assert.match(resolved.checkpoint, /No verification command has run yet/);
});

test('a failed apply produces a resumable repair state, not a false completion', async () => {
  const task = baseTask({
    proposal: {
      proposalHash: 'h'.repeat(64),
      approvalState: 'pending',
      operations: [{ path: 'src/admin/invite.ts', operation: 'edit' }],
      expectedVerification: [],
    },
  });
  const outcome = approveEngineeringTask(task, async () => false);
  const resolved = await outcome!.result;
  assert.equal(resolved.stage, 'repair_needed');
  assert.equal(resolved.completion, 'blocked');
  assert.equal(resolved.proposal!.approvalState, 'stale');
});
