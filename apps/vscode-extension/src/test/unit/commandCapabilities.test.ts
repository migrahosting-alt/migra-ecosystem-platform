import assert from 'node:assert/strict';
import test from 'node:test';
import { type ResolvedBackend } from '../../services/backendRouter.js';
import { CONSERVATIVE_CAPABILITIES, type PilotCapabilities } from '@migrapilot/pilot-client';
import {
  CAP_DIAGNOSTICS_SYNC,
  CAP_EXPLAIN_SELECTION,
  CAP_FIX_DIAGNOSTICS,
  CAP_PROPOSED_EDITS,
  evaluateCapability,
} from '../../services/commandCapabilities.js';
import { verifyEditsApplied } from '../../services/editVerification.js';
import { PilotApiClient, type PilotApiConfig } from '@migrapilot/pilot-client';
import { PilotError } from '@migrapilot/pilot-client';
import { type MockPilotApi, startMockPilotApi } from '../support/mockPilotApi.js';

function remote(operationClasses: string[], streaming = true): ResolvedBackend {
  const caps: PilotCapabilities = {
    ...CONSERVATIVE_CAPABILITIES,
    protocolVersion: 1,
    chatTransport: 'sse',
    streaming,
    operationClasses,
  };
  return { kind: 'remote', caps };
}

// ── capability mapping ───────────────────────────────────────────────────────

test('local backend → local decision for every command', () => {
  for (const req of [CAP_EXPLAIN_SELECTION, CAP_FIX_DIAGNOSTICS, CAP_PROPOSED_EDITS, CAP_DIAGNOSTICS_SYNC]) {
    assert.equal(evaluateCapability({ kind: 'local' }, req).mode, 'local');
  }
});

test('remote with all caps → remote decision', () => {
  const backend = remote(['chat', 'proposed-edits', 'workspace.read']);
  assert.equal(evaluateCapability(backend, CAP_EXPLAIN_SELECTION).mode, 'remote');
  assert.equal(evaluateCapability(backend, CAP_FIX_DIAGNOSTICS).mode, 'remote');
  assert.equal(evaluateCapability(backend, CAP_DIAGNOSTICS_SYNC).mode, 'remote');
});

test('fix denied (CAPABILITY_MISSING) when proposed-edits absent', () => {
  const backend = remote(['chat', 'workspace.read']); // no proposed-edits
  const decision = evaluateCapability(backend, CAP_FIX_DIAGNOSTICS);
  assert.equal(decision.mode, 'denied');
  if (decision.mode === 'denied') {
    assert.ok(decision.error instanceof PilotError);
    assert.equal(decision.error.code, 'CAPABILITY_MISSING');
  }
});

test('explain denied when streaming unsupported even if chat class present', () => {
  const backend = remote(['chat'], /* streaming */ false);
  const decision = evaluateCapability(backend, CAP_EXPLAIN_SELECTION);
  assert.equal(decision.mode, 'denied');
  if (decision.mode === 'denied') {
    assert.equal(decision.error.code, 'CAPABILITY_MISSING');
  }
});

test('remote-unavailable → denied with the stored error (no local fallback)', () => {
  const err = new PilotError('AUTH_REQUIRED', 'nope');
  const decision = evaluateCapability({ kind: 'remote-unavailable', error: err }, CAP_FIX_DIAGNOSTICS);
  assert.equal(decision.mode, 'denied');
  if (decision.mode === 'denied') {
    assert.equal(decision.error.code, 'AUTH_REQUIRED');
  }
});

// ── remote command path: proposed-edits fetch preserves correlation ──────────

async function withMock(
  opts: Parameters<typeof startMockPilotApi>[0],
  fn: (m: MockPilotApi) => Promise<void>,
): Promise<void> {
  const m = await startMockPilotApi(opts);
  try {
    await fn(m);
  } finally {
    await m.close();
  }
}

test('remote proposed-edits fetch returns edits + runId + actionId', async () => {
  await withMock({ capabilities: 'ok' }, async (m) => {
    const cfg: PilotApiConfig = {
      baseUrl: () => m.url,
      token: () => 'jwt',
      authMode: () => 'bearer',
      timeoutMs: () => 2000,
      log: () => {},
    };
    const client = new PilotApiClient(cfg);
    const res = await client.request<{
      runId: string;
      actionId: string;
      proposedEdits: Array<{ path: string; newText: string }>;
    }>('POST', '/api/pilot/proposed-edits', {
      body: { diagnostics: [] },
      requestId: 'req-fix-1',
    });
    assert.equal(res.runId, 'r-edit-1');
    assert.equal(res.actionId, 'a-edit-1');
    assert.equal(res.proposedEdits.length, 1);
    // requestId propagated on the wire.
    const req = m.requests.find((r) => r.path === '/api/pilot/proposed-edits');
    assert.equal(req?.headers['x-request-id'], 'req-fix-1');
  });
});

// ── read-back verification ───────────────────────────────────────────────────

test('verifyEditsApplied: passes when file contains the expected text', async () => {
  const files = new Map([['sample.ts', 'line1\n  return a + b; // fixed by pilot\nline3\n']]);
  const result = await verifyEditsApplied(
    [{ path: 'sample.ts', expectedSubstring: 'fixed by pilot' }],
    async (p) => files.get(p) ?? Promise.reject(new Error('missing')),
  );
  assert.equal(result.verified, true);
  assert.deepEqual(result.failures, []);
});

test('verifyEditsApplied: fails when edit did NOT land (no trust in success response)', async () => {
  const files = new Map([['sample.ts', 'line1\n  return a + b;\nline3\n']]); // unchanged
  const result = await verifyEditsApplied(
    [{ path: 'sample.ts', expectedSubstring: 'fixed by pilot' }],
    async (p) => files.get(p) ?? Promise.reject(new Error('missing')),
  );
  assert.equal(result.verified, false);
  assert.deepEqual(result.failures, ['sample.ts']);
});

test('verifyEditsApplied: unreadable file counts as failure', async () => {
  const result = await verifyEditsApplied(
    [{ path: 'gone.ts', expectedSubstring: 'x' }],
    async () => Promise.reject(new Error('ENOENT')),
  );
  assert.equal(result.verified, false);
});
