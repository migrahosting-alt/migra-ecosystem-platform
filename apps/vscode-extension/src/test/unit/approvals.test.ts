import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTION_STATES,
  type ActionOp,
  type ActionState,
  canApply,
  isTerminal,
} from '@migrapilot/pilot-client';
import { ApprovalsClient, approveResumeAndReconcile, reconcileRun } from '@migrapilot/pilot-client';
import { PilotApiClient } from '@migrapilot/pilot-client';
import { PilotError } from '@migrapilot/pilot-client';
import { type MockPilotApi, startMockPilotApi } from '../support/mockPilotApi.js';

// ── state-transition matrix (pure) ───────────────────────────────────────────

test('canApply: approve/reject only from PENDING; resume only from APPROVED', () => {
  const ops: ActionOp[] = ['approve', 'reject', 'resume'];
  for (const state of ACTION_STATES) {
    for (const op of ops) {
      const expected =
        (op === 'approve' || op === 'reject') ? state === 'PENDING' : state === 'APPROVED';
      assert.equal(canApply(op, state).ok, expected, `${op} from ${state}`);
    }
  }
});

test('terminal states are terminal; PENDING/APPROVED/EXECUTING are not', () => {
  for (const s of ['EXECUTED', 'REJECTED', 'DENIED', 'EXPIRED', 'CONSUMED'] as ActionState[]) {
    assert.equal(isTerminal(s), true, s);
  }
  for (const s of ['PENDING', 'APPROVED', 'EXECUTING'] as ActionState[]) {
    assert.equal(isTerminal(s), false, s);
  }
});

// ── mock-backed lifecycle ────────────────────────────────────────────────────

function approvalsFor(url: string): ApprovalsClient {
  return new ApprovalsClient(
    new PilotApiClient({
      baseUrl: () => url,
      token: () => 'jwt',
      authMode: () => 'bearer',
      timeoutMs: () => 2000,
      log: () => {},
    }),
  );
}

async function withMock(
  opts: Parameters<typeof startMockPilotApi>[0],
  fn: (m: MockPilotApi, a: ApprovalsClient) => Promise<void>,
): Promise<void> {
  const m = await startMockPilotApi(opts);
  try {
    await fn(m, approvalsFor(m.url));
  } finally {
    await m.close();
  }
}

const NOW = { sleep: async () => {} }; // no real delay in reconcile

test('discovery: list returns seeded pending action', async () => {
  await withMock({}, async (_m, a) => {
    const items = await a.list();
    assert.equal(items.length, 1);
    assert.equal(items[0]?.state, 'PENDING');
  });
});

test('approve moves PENDING → APPROVED with a server-issued approvalId', async () => {
  await withMock({}, async (m, a) => {
    const res = await a.approve('a1', 'req-approve-1');
    assert.equal(res.state, 'APPROVED');
    assert.ok(res.approvalId, 'approvalId issued');
    assert.equal(m.getAction('a1')?.state, 'APPROVED'); // assert STORE, not ok
    assert.equal(m.executionCount('a1'), 0, 'approve does not execute');
  });
});

test('reject moves PENDING → REJECTED, no execution', async () => {
  await withMock({}, async (m, a) => {
    const res = await a.reject('a1', 'req-reject-1');
    assert.equal(res.state, 'REJECTED');
    assert.equal(m.getAction('a1')?.state, 'REJECTED');
    assert.equal(m.executionCount('a1'), 0);
  });
});

test('approve → resume executes the exact action exactly once', async () => {
  await withMock({}, async (m, a) => {
    const approved = await a.approve('a1', 'req-a');
    const resumed = await a.resume('a1', approved.approvalId!, 'req-r');
    assert.equal(resumed.actionId, 'a1');
    assert.equal(resumed.runId, 'r1');
    assert.equal(m.getAction('a1')?.state, 'EXECUTED');
    assert.equal(m.executionCount('a1'), 1, 'executed exactly once');
  });
});

test('resume without approval is refused (INVALID_STATE), no execution', async () => {
  await withMock({}, async (m, a) => {
    await assert.rejects(
      () => a.resume('a1', 'apr-a1', 'req-r'),
      (e: unknown) => e instanceof PilotError && e.code === 'INVALID_STATE',
    );
    assert.equal(m.executionCount('a1'), 0);
  });
});

test('resume with WRONG approvalId is refused, no execution', async () => {
  await withMock({}, async (m, a) => {
    await a.approve('a1', 'req-a');
    await assert.rejects(
      () => a.resume('a1', 'not-the-approval', 'req-r'),
      (e: unknown) => e instanceof PilotError && e.code === 'INVALID_STATE',
    );
    assert.equal(m.executionCount('a1'), 0);
  });
});

test('duplicate approve with same requestId is idempotent (single approval)', async () => {
  await withMock({}, async (m, a) => {
    const first = await a.approve('a1', 'req-dup');
    const second = await a.approve('a1', 'req-dup');
    assert.equal(first.approvalId, second.approvalId);
    assert.equal(m.getAction('a1')?.state, 'APPROVED');
  });
});

test('duplicate resume with same requestId does not double-execute', async () => {
  await withMock({}, async (m, a) => {
    const approved = await a.approve('a1', 'req-a');
    await a.resume('a1', approved.approvalId!, 'req-r');
    await a.resume('a1', approved.approvalId!, 'req-r'); // idempotent replay
    assert.equal(m.executionCount('a1'), 1);
  });
});

test('replay refusal: resume after EXECUTED (new requestId) is INVALID_STATE, still one execution', async () => {
  await withMock({}, async (m, a) => {
    const approved = await a.approve('a1', 'req-a');
    await a.resume('a1', approved.approvalId!, 'req-r1');
    await assert.rejects(
      () => a.resume('a1', approved.approvalId!, 'req-r2'),
      (e: unknown) => e instanceof PilotError && e.code === 'INVALID_STATE',
    );
    assert.equal(m.executionCount('a1'), 1);
  });
});

test('approve after terminal (REJECTED) is refused', async () => {
  await withMock({}, async (m, a) => {
    await a.reject('a1', 'req-reject');
    await assert.rejects(
      () => a.approve('a1', 'req-approve'),
      (e: unknown) => e instanceof PilotError && e.code === 'INVALID_STATE',
    );
    assert.equal(m.getAction('a1')?.state, 'REJECTED');
  });
});

test('reconcile: waits through in-progress polls, reports completed once terminal', async () => {
  await withMock({ runProgressPolls: 3 }, async (m, a) => {
    const approved = await a.approve('a1', 'req-a');
    const resumed = await a.resume('a1', approved.approvalId!, 'req-r'); // EXECUTING
    assert.equal(resumed.state, 'EXECUTING');
    const outcome = await reconcileRun(a, 'r1', 'a1', NOW);
    assert.equal(outcome.status, 'completed');
    assert.equal(outcome.action.state, 'EXECUTED');
    assert.equal(m.executionCount('a1'), 1, 'reconcile does not re-execute');
  });
});

test('SSE drop → watchExecution throws NETWORK, reconcile is the authority', async () => {
  await withMock({ dropExecStream: true }, async (m, a) => {
    const approved = await a.approve('a1', 'req-a');
    await a.resume('a1', approved.approvalId!, 'req-r'); // triggers execution
    // The progress stream drops mid-way:
    await assert.rejects(
      async () => {
        for await (const _ of a.watchExecution('a1')) {
          /* consume until it drops */
        }
      },
      (e: unknown) => e instanceof PilotError && e.code === 'NETWORK',
    );
    // Dropped SSE must NOT be read as failure — reconcile via runId:
    const outcome = await reconcileRun(a, 'r1', 'a1', NOW);
    assert.equal(outcome.status, 'completed');
    assert.equal(m.executionCount('a1'), 1);
  });
});

test('reconnect after "host restart": a fresh client reconciles without replaying', async () => {
  await withMock({ runProgressPolls: 2 }, async (m, a) => {
    const approved = await a.approve('a1', 'req-a');
    await a.resume('a1', approved.approvalId!, 'req-r');
    // Simulate a brand-new client (Extension Host restarted) reconciling.
    const fresh = approvalsFor(m.url);
    const outcome = await reconcileRun(fresh, 'r1', 'a1', NOW);
    assert.equal(outcome.status, 'completed');
    assert.equal(m.executionCount('a1'), 1, 'no re-execution on reconnect');
  });
});

test('approveResumeAndReconcile end-to-end executes exactly once', async () => {
  await withMock({ runProgressPolls: 2 }, async (m, a) => {
    const outcome = await approveResumeAndReconcile(a, 'a1');
    assert.equal(outcome.status, 'completed');
    assert.equal(m.executionCount('a1'), 1);
  });
});
