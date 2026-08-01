/**
 * Acceptance for coding-domain restart recovery.
 *
 * The load-bearing claim is narrow and easy to get wrong in either direction: a
 * pending scope approval SURVIVES a restart when its bindings still verify, and
 * is INVALIDATED the moment any of them does not. Getting the first wrong throws
 * away valid operator intent; getting the second wrong presents an approval whose
 * evidence no longer exists.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashExcerpt } from '../src/engine/grounding/evidenceLedger.js';
import { hashPaths } from '../src/engine/coding/editScope.js';
import { classifyInterruptedExecution, recoverPendingScope, type SpanReader } from '../src/engine/coding/codingRecovery.js';
import { initialCodingPayload, type CodingRunPayloadV1 } from '../src/engine/coding/codingRunPayload.js';
import type { DurableAgentRunChild } from '../src/engine/persistence/types.js';

const SERVICE = 'src/services/orderTotalsService.js';
const CONTRACT = 'src/contracts/orderTotals.js';
const SERVICE_TEXT = 'export function total(lines) {\n  return lines.reduce((a, l) => a + l.amount, 0);\n}\n';
const CONTRACT_TEXT = 'export const ORDER_TOTAL_FIELDS = ["total"];\n';

const NOW = Date.parse('2026-08-01T12:00:00.000Z');

function payloadAwaitingApproval(over: Partial<CodingRunPayloadV1> = {}): CodingRunPayloadV1 {
  const paths = [SERVICE, CONTRACT];
  return {
    ...initialCodingPayload('Cancelled lines are still counted.'),
    phase: 'awaiting_scope_approval',
    scope: {
      proposedPaths: paths,
      pathSetHash: hashPaths(paths),
      sourcesByPath: {
        [SERVICE]: [{ path: SERVICE, startLine: 1, endLine: 3, excerptHash: hashExcerpt(SERVICE_TEXT) }],
        [CONTRACT]: [{ path: CONTRACT, startLine: 1, endLine: 1, excerptHash: hashExcerpt(CONTRACT_TEXT) }],
      },
      proposalRevision: 3,
      proposedAt: '2026-08-01T11:58:00.000Z',
      approvalExpiresAt: '2026-08-01T12:05:00.000Z',
      approvalState: 'displayed',
    },
    ...over,
  };
}

const unchangedTree: SpanReader = async (path) => (path === SERVICE ? SERVICE_TEXT : path === CONTRACT ? CONTRACT_TEXT : undefined);

// ── the approval survives ────────────────────────────────────────────────────

test('a pending approval whose every cited span still verifies REMAINS awaiting approval', async () => {
  const result = await recoverPendingScope({ payload: payloadAwaitingApproval(), readSpan: unchangedTree, now: NOW });
  assert.equal(result.outcome, 'still_valid');
  assert.equal(result.approvalLifecycle, undefined, 'the lifecycle is left alone — this is the case command policy would have destroyed');
  assert.equal(result.verifiedSpans, 2, 'every span was actually re-read, not assumed');
  assert.deepEqual(result.findings, []);
});

test('trailing-whitespace-only drift still verifies, because the excerpt hash normalises it', async () => {
  const reader: SpanReader = async (path) => (path === SERVICE ? SERVICE_TEXT.replace(/\n/g, '   \n') : CONTRACT_TEXT);
  const result = await recoverPendingScope({ payload: payloadAwaitingApproval(), readSpan: reader, now: NOW });
  assert.equal(result.outcome, 'still_valid');
});

// ── the approval is invalidated ──────────────────────────────────────────────

test('a changed cited span invalidates the approval and names what moved', async () => {
  const reader: SpanReader = async (path) => (path === SERVICE ? SERVICE_TEXT.replace('a + l.amount', 'a + l.amount * 2') : CONTRACT_TEXT);
  const result = await recoverPendingScope({ payload: payloadAwaitingApproval(), readSpan: reader, now: NOW });

  assert.equal(result.outcome, 'source_changed');
  assert.equal(result.approvalLifecycle, 'INVALIDATED');
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0]?.path, SERVICE);
  assert.ok(result.findings[0]?.actualHash, 'the observed hash is reported, not just the expectation');
  assert.notEqual(result.findings[0]?.actualHash, result.findings[0]?.expectedHash);
  assert.equal(result.verifiedSpans, 1, 'the unaffected span is still reported as verified');
});

test('a missing source file invalidates the approval', async () => {
  const reader: SpanReader = async (path) => (path === CONTRACT ? CONTRACT_TEXT : undefined);
  const result = await recoverPendingScope({ payload: payloadAwaitingApproval(), readSpan: reader, now: NOW });
  assert.equal(result.outcome, 'source_missing');
  assert.equal(result.approvalLifecycle, 'INVALIDATED');
  assert.equal(result.findings[0]?.actualHash, undefined, 'a missing span has no observed hash to report');
});

test('an expired approval expires — and does no file IO to decide it', async () => {
  let reads = 0;
  const counting: SpanReader = async (...args) => { reads += 1; return unchangedTree(...args); };
  const result = await recoverPendingScope({ payload: payloadAwaitingApproval(), readSpan: counting, now: Date.parse('2026-08-01T12:06:00.000Z') });
  assert.equal(result.outcome, 'expired');
  assert.equal(result.approvalLifecycle, 'EXPIRED');
  assert.equal(reads, 0, 'expiry is decided before touching the filesystem');
});

test('a stored path set that no longer matches its own hash is refused', async () => {
  const payload = payloadAwaitingApproval();
  // A third path appears without the hash being recomputed — exactly the shape of
  // a widened scope smuggled past an approval.
  payload.scope!.proposedPaths = [...payload.scope!.proposedPaths, 'src/routes/orderTotalsRoute.js'];
  const result = await recoverPendingScope({ payload, readSpan: unchangedTree, now: NOW });
  assert.equal(result.outcome, 'scope_mismatch');
  assert.equal(result.approvalLifecycle, 'INVALIDATED');
});

test('a scoped path that escapes the repository root fails containment before any read', async () => {
  for (const escape of ['/etc/passwd', '../../secrets.env', 'src/../../outside.ts', 'C:\\Windows\\system.ini']) {
    const paths = [escape];
    const payload = payloadAwaitingApproval();
    payload.scope!.proposedPaths = paths;
    payload.scope!.pathSetHash = hashPaths(paths);
    let reads = 0;
    const result = await recoverPendingScope({
      payload,
      readSpan: async (...args) => { reads += 1; return unchangedTree(...args); },
      now: NOW,
    });
    assert.equal(result.outcome, 'containment_failed', `${escape} must fail containment`);
    assert.equal(result.approvalLifecycle, 'INVALIDATED');
    assert.equal(reads, 0);
  }
});

test('a pending cancellation stops the approval being presented again', async () => {
  const payload = payloadAwaitingApproval({ cancellation: { requestedAt: '2026-08-01T11:59:00.000Z' } });
  const result = await recoverPendingScope({ payload, readSpan: unchangedTree, now: NOW });
  assert.equal(result.outcome, 'cancellation_pending');
  assert.equal(result.approvalLifecycle, 'INVALIDATED');
});

test('a run awaiting approval with no scope at all fails closed', async () => {
  const result = await recoverPendingScope({ payload: { ...initialCodingPayload('x'), phase: 'awaiting_scope_approval' }, readSpan: unchangedTree, now: NOW });
  assert.equal(result.outcome, 'source_missing');
  assert.equal(result.approvalLifecycle, 'INVALIDATED');
});

test('an unreadable expiry is treated as expired, never as live', async () => {
  const payload = payloadAwaitingApproval();
  payload.scope!.approvalExpiresAt = 'whenever';
  const result = await recoverPendingScope({ payload, readSpan: unchangedTree, now: NOW });
  assert.equal(result.outcome, 'expired');
});

// ── interrupted execution ────────────────────────────────────────────────────

function child(over: Partial<DurableAgentRunChild>): DurableAgentRunChild {
  return {
    childId: 'c', runId: 'run_1', kind: 'validation', attempt: 1, state: 'interrupted', required: true,
    revision: 3, createdAt: 1, schemaVersion: 1, updatedAt: 1, terminalCategory: 'interrupted_by_restart', ...over,
  };
}

test('an interrupted APPLY is never replayed and is reported as ambiguous', () => {
  const applied = child({ childId: 'c_apply', kind: 'initial_apply' });
  const result = classifyInterruptedExecution({ children: [applied], interrupted: [applied] });

  assert.equal(result.action, 'requires_mutation_reconciliation');
  assert.equal(result.mutationAmbiguous, true, 'whether files were written is unknown from the record alone');
  assert.equal(result.blockedOperations.length, 1);
  assert.match(result.blockedOperations[0] ?? '', /must not be replayed/);
  assert.match(result.blockedOperations[0] ?? '', /working-tree diff/);
});

test('an apply that never left `created` provably wrote nothing', () => {
  const never = child({ childId: 'c_apply', kind: 'repair_apply', terminalCategory: 'orphaned_before_dispatch' });
  const result = classifyInterruptedExecution({ children: [never], interrupted: [never] });
  assert.equal(result.action, 'requires_mutation_reconciliation');
  assert.equal(result.mutationAmbiguous, false, 'undispatched work cannot have mutated anything');
  assert.deepEqual(result.blockedOperations, []);
});

test('an interrupted VALIDATION requires a new child, never a rewrite of the old one', () => {
  const validation = child({ childId: 'c_val', kind: 'final_validation' });
  const result = classifyInterruptedExecution({ children: [validation], interrupted: [validation] });
  assert.equal(result.action, 'requires_new_validation');
  assert.match(result.detail, /never rewritten as completed/);
  assert.match(result.blockedOperations[0] ?? '', /stays interrupted/);
});

test('mutation reconciliation outranks validation when both were interrupted', () => {
  const apply = child({ childId: 'c_apply', kind: 'initial_apply' });
  const validation = child({ childId: 'c_val', kind: 'validation' });
  const result = classifyInterruptedExecution({ children: [apply, validation], interrupted: [apply, validation] });
  assert.equal(result.action, 'requires_mutation_reconciliation', 'the ambiguous working tree must be settled first');
});

test('an interrupted non-mutating operation is safe to re-attempt as a new child', () => {
  const planning = child({ childId: 'c_plan', kind: 'repository_planning' });
  const result = classifyInterruptedExecution({ children: [planning], interrupted: [planning] });
  assert.equal(result.action, 'safe_to_continue');
  assert.deepEqual(result.blockedOperations, []);
});

test('a run with nothing in flight has nothing to recover', () => {
  const done = child({ childId: 'c1', state: 'completed', terminalCategory: 'observed_success' });
  const result = classifyInterruptedExecution({ children: [done], interrupted: [] });
  assert.equal(result.action, 'nothing_to_recover');
});
