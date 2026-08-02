/**
 * Acceptance for the extension-side governed coding client, poller and workflow.
 *
 * The recurring question in every case: can the surface ever tell the user
 * something the durable record does not say? Each test closes one route to that.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CodingRunClient,
  cancellationLabel,
  isTerminalPhase,
  needsApproval,
  type CodingRunSnapshot,
  type FetchLike,
} from '../../services/codingRunClient.js';
import { pollCodingRun } from '../../services/codingRunPoller.js';
import { runCodingWorkflow, requestCodingCancellation, type CodingWorkflowUi, type ScopeApprovalRequest } from '../../services/codingWorkflow.js';

const config = { baseUrl: () => 'http://127.0.0.1:3988', timeoutMs: () => 5_000, log: () => undefined };

function reply(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function clientWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>): { client: CodingRunClient; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url, init) => { calls.push(`${init.method} ${new URL(url).pathname}`); return handler(url, init); };
  return { client: new CodingRunClient(config, fetchImpl), calls };
}

function snapshot(over: Partial<CodingRunSnapshot> = {}): CodingRunSnapshot {
  return {
    runId: 'run_1', revision: 7, state: 'AWAITING_APPROVAL', phase: 'awaiting_scope_approval',
    children: [], blockers: [], statusUrl: '/api/ai/coding/runs/run_1',
    scope: {
      proposedPaths: ['src/a.ts', 'src/b.ts'],
      pathSetHash: 'hash_abc',
      approvalState: 'displayed',
      approvalExpiresAt: '2026-08-01T00:05:00.000Z',
      proposedAt: '2026-08-01T00:00:00.000Z',
      evidence: [{ path: 'src/a.ts', spans: [{ startLine: 1, endLine: 9, excerptHash: 'e1' }] }],
      rationales: [{ path: 'src/a.ts', rationale: 'computes the total' }],
      excluded: [{ path: 'src/fmt.ts', reason: 'display only' }],
    },
    ...over,
  };
}

// ── response classification ──────────────────────────────────────────────────

test('every response class is distinguishable, never a flattened error string', async () => {
  const cases: Array<[number, unknown, string]> = [
    [200, snapshot(), 'ok'],
    [400, { error: 'invalid_request', message: 'expectedRevision must be an integer.' }, 'invalid_request'],
    [403, { error: 'workspace_not_permitted', message: 'outside boundary' }, 'forbidden'],
    [404, {}, 'not_found'],
    [409, { error: 'coding_run_conflict', reason: 'stale_revision', currentRevision: 9, currentState: 'AWAITING_APPROVAL', currentPhase: 'awaiting_scope_approval' }, 'conflict'],
    [422, { error: 'coding_run_unreadable', runId: 'run_1', reason: 'payload_malformed', currentRevision: 3, currentState: 'PLANNING', recoverable: false, detail: 'x' }, 'corrupt'],
    [500, { message: 'boom' }, 'unexpected'],
  ];
  for (const [status, body, expected] of cases) {
    const { client } = clientWith(() => reply(status, body));
    const result = await client.getCodingRun('run_1');
    assert.equal(result.kind, expected, `status ${status} must classify as ${expected}`);
  }
});

test('a 202 start is `accepted`, not `ok` — planning has not finished', async () => {
  const { client } = clientWith(() => reply(202, { runId: 'run_1', revision: 1, state: 'PLANNING', phase: 'planning', statusUrl: '/x' }));
  const result = await client.startCodingRun({ issueText: 'x', workspaceRoot: '/w' });
  assert.equal(result.kind, 'accepted');
  assert.equal(result.kind === 'accepted' && result.value.phase, 'planning');
});

test('a 404 on the capability probe is "feature off", not "run missing"', async () => {
  const { client } = clientWith(() => reply(404, {}));
  assert.equal((await client.getCodingCapability()).kind, 'capability_unavailable');
  assert.equal((await client.getCodingRun('run_1')).kind, 'not_found', 'the same status on a run means something else entirely');
});

test('a conflict without a machine-readable reason is not silently treated as one', async () => {
  const { client } = clientWith(() => reply(409, { error: 'coding_run_conflict' }));
  const result = await client.submitScopeDecision('run_1', { expectedRevision: 1, pathSetHash: 'h', decision: 'approve' });
  assert.equal(result.kind, 'unexpected');
});

test('a user cancellation and a timeout are different outcomes', async () => {
  const controller = new AbortController();
  const { client } = clientWith(async () => { controller.abort(); throw new Error('aborted'); });
  assert.equal((await client.getCodingRun('run_1', controller.signal)).kind, 'cancelled');

  const slow = new CodingRunClient({ ...config, timeoutMs: () => 10 }, async (_u, init) => {
    await new Promise((r) => setTimeout(r, 60));
    (init.signal as AbortSignal).throwIfAborted();
    return reply(200, snapshot());
  });
  assert.equal((await slow.getCodingRun('run_1')).kind, 'timeout');
});

test('transport failure is reported as such, never as a run outcome', async () => {
  const { client } = clientWith(() => { throw new Error('ECONNREFUSED'); });
  const result = await client.getCodingRun('run_1');
  assert.equal(result.kind, 'transport_failure');
  assert.match(result.kind === 'transport_failure' ? result.detail : '', /ECONNREFUSED/);
});

// ── derived labels ───────────────────────────────────────────────────────────

test('cancellation labels come from the durable record, never from a token', () => {
  assert.equal(cancellationLabel(snapshot()), undefined, 'no cancellation, no label');
  assert.equal(cancellationLabel(snapshot({ cancellation: { requestedAt: 't1', status: 'cancelling' } })), 'Cancellation requested');
  assert.equal(
    cancellationLabel(snapshot({ phase: 'terminal', state: 'CANCELLED', cancellation: { requestedAt: 't1', confirmedAt: 't2', status: 'cancelled' } })),
    'Cancelled',
  );
  // Requested, run ended, but NOT cancelled — the work may have finished anyway.
  assert.equal(
    cancellationLabel(snapshot({ phase: 'terminal', state: 'FAILED', cancellation: { requestedAt: 't1', status: 'cancelling' } })),
    'Cancellation could not be confirmed',
  );
});

test('approval is only requested for a live, displayable proposal', () => {
  assert.equal(needsApproval(snapshot()), true);
  assert.equal(needsApproval(snapshot({ scope: { ...snapshot().scope!, approvalState: 'consumed' } })), false);
  assert.equal(needsApproval(snapshot({ phase: 'validating' })), false);
  assert.equal(isTerminalPhase(snapshot({ phase: 'terminal' })), true);
});

// ── polling ──────────────────────────────────────────────────────────────────

test('polling renders only on revision change and never overlaps requests', async () => {
  const revisions = [1, 1, 1, 2, 2, 3];
  let index = 0;
  let inFlight = 0;
  let maxConcurrent = 0;
  const { client } = clientWith(async () => {
    inFlight += 1; maxConcurrent = Math.max(maxConcurrent, inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight -= 1;
    const revision = revisions[Math.min(index++, revisions.length - 1)]!;
    return reply(200, snapshot({ revision, phase: revision === 3 ? 'terminal' : 'validating', state: 'EXECUTING' }));
  });

  const rendered: number[] = [];
  const outcome = await pollCodingRun(client, {
    runId: 'run_1',
    onSnapshot: (s) => rendered.push(s.revision),
    sleep: async () => undefined,
  });
  assert.equal(outcome.reason, 'terminal');
  assert.deepEqual(rendered, [1, 2, 3], 'one render per durable change, not per tick');
  assert.equal(maxConcurrent, 1, 'requests never overlap');
});

test('polling backs off while the revision is static and resets when it moves', async () => {
  const waits: number[] = [];
  let calls = 0;
  const { client } = clientWith(() => {
    calls += 1;
    const revision = calls < 5 ? 1 : 2;
    return reply(200, snapshot({ revision, phase: calls < 6 ? 'validating' : 'terminal', state: 'EXECUTING' }));
  });
  await pollCodingRun(client, { runId: 'run_1', onSnapshot: () => undefined, sleep: async (ms) => { waits.push(ms); } });
  assert.ok(waits[1]! > waits[0]!, 'interval grows while nothing changes');
  const afterChange = waits[4]!;
  assert.ok(afterChange <= waits[0]!, `interval resets on a revision change (got ${afterChange} vs first ${waits[0]})`);
});

test('polling stops on disposal, corruption and a missing run — each with its own reason', async () => {
  const live = clientWith(() => reply(200, snapshot({ phase: 'validating', state: 'EXECUTING' })));
  let ticks = 0;
  const disposed = await pollCodingRun(live.client, {
    runId: 'run_1', onSnapshot: () => undefined, sleep: async () => undefined,
    isDisposed: () => (ticks += 1) > 2,
  });
  assert.equal(disposed.reason, 'disposed');

  const corrupt = clientWith(() => reply(422, { runId: 'run_1', reason: 'payload_malformed', currentRevision: 1, currentState: 'PLANNING', recoverable: false, detail: 'bad' }));
  const corruptOutcome = await pollCodingRun(corrupt.client, { runId: 'run_1', onSnapshot: () => undefined, sleep: async () => undefined });
  assert.equal(corruptOutcome.reason, 'corrupt');
  assert.equal(corrupt.calls.length, 1, 'a record that cannot be read is not retried');

  const missing = clientWith(() => reply(404, {}));
  assert.equal((await pollCodingRun(missing.client, { runId: 'run_1', onSnapshot: () => undefined, sleep: async () => undefined })).reason, 'not_found');
});

test('a transient transport failure does not end the run; a persistent one does', async () => {
  let calls = 0;
  const { client } = clientWith(() => {
    calls += 1;
    if (calls <= 2) throw new Error('ECONNRESET');
    return reply(200, snapshot({ revision: 9, phase: 'terminal', state: 'COMPLETED' }));
  });
  const recovered = await pollCodingRun(client, { runId: 'run_1', onSnapshot: () => undefined, sleep: async () => undefined });
  assert.equal(recovered.reason, 'terminal', 'a dropped packet is not a failed run');

  const dead = clientWith(() => { throw new Error('ECONNREFUSED'); });
  const outcome = await pollCodingRun(dead.client, { runId: 'run_1', onSnapshot: () => undefined, sleep: async () => undefined, maxTransientFailures: 3 });
  assert.equal(outcome.reason, 'transport_failure');
});

test('a polling deadline does not declare the run finished', async () => {
  let clock = 0;
  const { client } = clientWith(() => reply(200, snapshot({ phase: 'repairing', state: 'EXECUTING' })));
  const outcome = await pollCodingRun(client, {
    runId: 'run_1', onSnapshot: () => undefined, sleep: async () => { clock += 1_000; },
    now: () => clock, deadlineMs: 3_000,
  });
  assert.equal(outcome.reason, 'deadline');
  assert.notEqual(outcome.reason, 'terminal', 'elapsed time never implies completion');
  assert.match(outcome.detail ?? '', /still recorded as repairing/);
});

// ── workflow ─────────────────────────────────────────────────────────────────

function ui(decision: (r: ScopeApprovalRequest) => Promise<'approve' | 'reject' | undefined>) {
  const asked: ScopeApprovalRequest[] = [];
  const problems: string[] = [];
  const progress: number[] = [];
  let final: CodingRunSnapshot | undefined;
  const surface: CodingWorkflowUi = {
    requestScopeApproval: async (r) => { asked.push(r); return decision(r); },
    onProgress: (s) => { progress.push(s.revision); },
    onFinalReport: (s) => { final = s; },
    onProblem: (p) => { problems.push(`${p.title}: ${p.detail}`); },
  };
  return { surface, asked, problems, progress, get final() { return final; } };
}

const CAPABILITY_OK = { governedCoding: { available: true, approvalMode: 'scope', progressMode: 'polling', workspaceRootsConfigured: 1 } };

test('the workflow refuses to start when the capability is unavailable', async () => {
  const { client } = clientWith(() => reply(200, { governedCoding: { available: false, approvalMode: 'scope', progressMode: 'polling', workspaceRootsConfigured: 0, unavailableReason: 'disabled by configuration' } }));
  const surface = ui(async () => 'approve');
  const outcome = await runCodingWorkflow(client, { issueText: 'x', workspaceRoot: '/w', ui: surface.surface });
  assert.equal(outcome.kind, 'unavailable');
  assert.equal(surface.asked.length, 0, 'no approval is presented for a capability that does not exist');
});

test('one approval, carried back bound to the exact revision and hash', async () => {
  let phase = 'awaiting';
  let submitted: Record<string, unknown> | undefined;
  const { client } = clientWith((url, init) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/capability')) return reply(200, CAPABILITY_OK);
    if (init.method === 'POST' && p === '/api/ai/coding/runs') return reply(202, { runId: 'run_1', revision: 1, state: 'PLANNING', phase: 'planning', statusUrl: '/x' });
    if (p.endsWith('/scope-decision')) {
      submitted = JSON.parse(String(init.body)) as Record<string, unknown>;
      phase = 'done';
      return reply(200, snapshot({ revision: 8, phase: 'validating', state: 'EXECUTING' }));
    }
    return reply(200, phase === 'awaiting'
      ? snapshot()
      : snapshot({ revision: 12, phase: 'terminal', state: 'COMPLETED', finalReport: { stopReason: 'validated', complete: true, changedFiles: ['src/a.ts'], approvedPaths: ['src/a.ts'], refusedPaths: [], unusedScope: [], unresolvedRisks: [] } }));
  });

  const surface = ui(async () => 'approve');
  const outcome = await runCodingWorkflow(client, { issueText: 'x', workspaceRoot: '/w', ui: surface.surface, poll: pollCodingRun });

  assert.equal(outcome.kind, 'completed');
  assert.equal(surface.asked.length, 1, 'asked exactly once');
  assert.deepEqual(submitted, { expectedRevision: 7, pathSetHash: 'hash_abc', decision: 'approve' });
  assert.equal(surface.asked[0]?.files.length, 2);
  assert.equal(surface.asked[0]?.files[0]?.rationale, 'computes the total');
  assert.equal(surface.asked[0]?.excluded[0]?.path, 'src/fmt.ts');
  assert.ok(surface.final?.finalReport?.complete);
});

test('a stale approval REFRESHES and re-asks rather than retrying blindly', async () => {
  let decided = 0;
  const submissions: Array<Record<string, unknown>> = [];
  const { client } = clientWith((url, init) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/capability')) return reply(200, CAPABILITY_OK);
    if (init.method === 'POST' && p === '/api/ai/coding/runs') return reply(202, { runId: 'run_1', revision: 1, state: 'PLANNING', phase: 'planning', statusUrl: '/x' });
    if (p.endsWith('/scope-decision')) {
      submissions.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      decided += 1;
      if (decided === 1) return reply(409, { error: 'coding_run_conflict', reason: 'scope_hash_mismatch', currentRevision: 11, currentState: 'AWAITING_APPROVAL', currentPhase: 'awaiting_scope_approval' });
      return reply(200, snapshot({ revision: 12, phase: 'terminal', state: 'COMPLETED', finalReport: { stopReason: 'validated', complete: true, changedFiles: [], approvedPaths: [], refusedPaths: [], unusedScope: [], unresolvedRisks: [] } }));
    }
    // After the first conflict the Brain serves a DIFFERENT proposal; after the
    // second decision is accepted it runs to completion.
    if (decided === 0) return reply(200, snapshot());
    if (decided === 1) return reply(200, snapshot({ revision: 11, scope: { ...snapshot().scope!, pathSetHash: 'hash_NEW', proposedPaths: ['src/a.ts', 'src/b.ts', 'src/c.ts'] } }));
    return reply(200, snapshot({ revision: 12, phase: 'terminal', state: 'COMPLETED', finalReport: { stopReason: 'validated', complete: true, changedFiles: [], approvedPaths: [], refusedPaths: [], unusedScope: [], unresolvedRisks: [] } }));
  });

  const surface = ui(async () => 'approve');
  const outcome = await runCodingWorkflow(client, { issueText: 'x', workspaceRoot: '/w', ui: surface.surface });

  assert.equal(outcome.kind, 'completed');
  assert.equal(surface.asked.length, 2, 'the operator was asked again about the CHANGED proposal');
  assert.equal(surface.asked[1]?.pathSetHash, 'hash_NEW');
  assert.equal(surface.asked[1]?.supersededPreviousProposal, true, 'the panel is told it replaced an earlier proposal');
  assert.equal(submissions[1]?.pathSetHash, 'hash_NEW', 'the second decision is bound to what was actually shown');
  assert.notEqual(submissions[0]?.pathSetHash, submissions[1]?.pathSetHash);
});

test('rejection ends the run and never proceeds to execution', async () => {
  const { client } = clientWith((url, init) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/capability')) return reply(200, CAPABILITY_OK);
    if (init.method === 'POST' && p === '/api/ai/coding/runs') return reply(202, { runId: 'run_1', revision: 1, state: 'PLANNING', phase: 'planning', statusUrl: '/x' });
    if (p.endsWith('/scope-decision')) {
      assert.equal(JSON.parse(String(init.body)).decision, 'reject');
      return reply(200, snapshot({ revision: 9, phase: 'terminal', state: 'REJECTED' }));
    }
    return reply(200, snapshot());
  });
  const surface = ui(async () => 'reject');
  const outcome = await runCodingWorkflow(client, { issueText: 'x', workspaceRoot: '/w', ui: surface.surface });
  assert.equal(outcome.kind, 'rejected');
  assert.equal(outcome.kind === 'rejected' && outcome.snapshot.state, 'REJECTED');
});

test('dismissing the approval panel leaves the run untouched', async () => {
  const { client, calls } = clientWith((url, init) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/capability')) return reply(200, CAPABILITY_OK);
    if (init.method === 'POST' && p === '/api/ai/coding/runs') return reply(202, { runId: 'run_1', revision: 1, state: 'PLANNING', phase: 'planning', statusUrl: '/x' });
    return reply(200, snapshot());
  });
  const surface = ui(async () => undefined);
  const outcome = await runCodingWorkflow(client, { issueText: 'x', workspaceRoot: '/w', ui: surface.surface });
  assert.equal(outcome.kind, 'dismissed');
  assert.equal(calls.some((c) => c.includes('scope-decision')), false, 'no decision was submitted');
});

test('a corrupt durable record is surfaced as corruption, not as a missing run', async () => {
  const { client } = clientWith((url, init) => {
    const p = new URL(url).pathname;
    if (p.endsWith('/capability')) return reply(200, CAPABILITY_OK);
    if (init.method === 'POST' && p === '/api/ai/coding/runs') return reply(202, { runId: 'run_1', revision: 1, state: 'PLANNING', phase: 'planning', statusUrl: '/x' });
    return reply(422, { runId: 'run_1', reason: 'payload_malformed', currentRevision: 4, currentState: 'PLANNING', recoverable: false, detail: 'payload failed validation' });
  });
  const surface = ui(async () => 'approve');
  const outcome = await runCodingWorkflow(client, { issueText: 'x', workspaceRoot: '/w', ui: surface.surface });
  assert.equal(outcome.kind, 'problem');
  assert.match(surface.problems.join(' '), /cannot be read/);
});

// ── cancellation ─────────────────────────────────────────────────────────────

test('cancellation reports `requested` until the Brain durably confirms it', async () => {
  const cancelling = clientWith(() => reply(200, snapshot({ cancellation: { requestedAt: 't1', status: 'cancelling' } })));
  assert.equal((await requestCodingCancellation(cancelling.client, 'run_1', 7)).label, 'Cancellation requested');

  const confirmed = clientWith(() => reply(200, snapshot({ phase: 'terminal', state: 'CANCELLED', cancellation: { requestedAt: 't1', confirmedAt: 't2', status: 'cancelled' } })));
  assert.equal((await requestCodingCancellation(confirmed.client, 'run_1', 7)).label, 'Cancelled');

  // Requested, run resolved FAILED: never "Cancelled".
  const unconfirmed = clientWith(() => reply(200, snapshot({ phase: 'terminal', state: 'FAILED', cancellation: { requestedAt: 't1', status: 'cancelling' } })));
  assert.equal((await requestCodingCancellation(unconfirmed.client, 'run_1', 7)).label, 'Cancellation could not be confirmed');
});

test('a stale cancellation re-reads before saying anything', async () => {
  let posted = false;
  const { client } = clientWith((url, init) => {
    if (init.method === 'POST') { posted = true; return reply(409, { error: 'coding_run_conflict', reason: 'stale_revision', currentRevision: 12, currentState: 'EXECUTING', currentPhase: 'validating' }); }
    return reply(200, snapshot({ revision: 12, phase: 'validating', state: 'EXECUTING' }));
  });
  const result = await requestCodingCancellation(client, 'run_1', 7);
  assert.ok(posted);
  assert.equal(result.conflict?.reason, 'stale_revision');
  assert.equal(result.snapshot?.revision, 12, 'the fresh record was read');
  assert.notEqual(result.label, 'Cancelled');
});
