// Operational Readiness Slice 4 — approval-gated recovery workflow.
// © MigraTeck LLC.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { RecoveryManager, RecoveryError, type ReverseEntry } from '../src/engine/recovery.js';
import { IncidentManager, LocalAlertSink } from '../src/engine/incidents.js';
import { nodeChangesetFs } from '../src/tools/changesetFs.js';
import { auditStore } from '../src/engine/auditLog.js';

const fs = nodeChangesetFs();

/** Simulate a workspace left in a mixed state by a failed apply: keep.txt was
 * modified (ORIG→NEW) and second.js was newly created; rollback failed. */
function mixedWorkspace(): { root: string; reverse: ReverseEntry[] } {
  const root = mkdtempSync(path.join(tmpdir(), 'recovery-'));
  writeFileSync(path.join(root, 'keep.txt'), 'NEW\n'); // partially applied
  writeFileSync(path.join(root, 'second.js'), 'x\n'); // partially created
  return {
    root,
    reverse: [
      { path: 'keep.txt', previousContent: 'ORIG\n' },
      { path: 'second.js', previousContent: null }, // was created → remove to restore
    ],
  };
}

function managers(): { rec: RecoveryManager; inc: IncidentManager; sink: LocalAlertSink; incidentId: string } {
  const sink = new LocalAlertSink();
  const inc = new IncidentManager(sink.sink, () => 1);
  const { incident } = inc.raiseInconsistentState({ correlationId: 'corr_orig', workspaceIdentityHash: 'ws', proposalHashPrefix: 'p', appliedFileCount: 2, affectedPathCount: 2, rollbackFailureCount: 1, failureStage: 'rollback' });
  const rec = new RecoveryManager(inc, () => 1);
  return { rec, inc, sink, incidentId: incident.incidentId };
}

test('recovery plan is generated with ZERO writes (workspace untouched during planning)', () => {
  const { root, reverse } = mixedWorkspace();
  const { rec } = managers();
  rec.stashReverseMaterial('corr_orig', root, reverse, 'inc1');
  const before = { keep: readFileSync(path.join(root, 'keep.txt'), 'utf8'), second: existsSync(path.join(root, 'second.js')) };
  const plan = rec.plan('corr_orig');
  assert.equal(plan.fileCount, 2);
  assert.ok(plan.approvalToken.startsWith('rec_'));
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), before.keep, 'planning must not write');
  assert.equal(existsSync(path.join(root, 'second.js')), before.second, 'planning must not write');
  // recovery.started + plan_created are audited under the recovery correlation.
  const chain = auditStore.byCorrelation(plan.recoveryCorrelationId).map((r) => r.type);
  assert.ok(chain.includes('recovery.started') && chain.includes('recovery.plan_created'));
});

test('recovery requires EXACT single-use approval; mismatch + replay refused', () => {
  const { root, reverse } = mixedWorkspace();
  const { rec } = managers();
  rec.stashReverseMaterial('corr_orig', root, reverse, 'inc1');
  const plan = rec.plan('corr_orig');
  assert.throws(() => rec.apply(plan.recoveryId, 'rec_WRONG', fs), (e: unknown) => e instanceof RecoveryError && e.code === 'APPROVAL_MISMATCH');
  // Exact token applies once.
  rec.apply(plan.recoveryId, plan.approvalToken, fs);
  // Replay refused.
  assert.throws(() => rec.apply(plan.recoveryId, plan.approvalToken, fs), (e: unknown) => e instanceof RecoveryError && e.code === 'APPROVAL_REPLAYED');
});

test('approved recovery restores the workspace (contained), then verify passes', () => {
  const { root, reverse } = mixedWorkspace();
  const { rec } = managers();
  rec.stashReverseMaterial('corr_orig', root, reverse, 'inc1');
  const plan = rec.plan('corr_orig');
  const res = rec.apply(plan.recoveryId, plan.approvalToken, fs);
  assert.deepEqual(res.modified, ['keep.txt']);
  assert.deepEqual(res.deleted, ['second.js']);
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'ORIG\n'); // restored
  assert.equal(existsSync(path.join(root, 'second.js')), false); // removed
  const evidence = rec.verify(plan.recoveryId, fs);
  assert.equal(evidence.ok, true);
  assert.ok(evidence.checked >= 2);
});

test('simulate previews recovery with zero writes', () => {
  const { root, reverse } = mixedWorkspace();
  const { rec } = managers();
  rec.stashReverseMaterial('corr_orig', root, reverse, 'inc1');
  const plan = rec.plan('corr_orig');
  const sim = rec.simulate(plan.recoveryId, fs);
  assert.equal(sim.fileCount, 2);
  assert.equal(sim.wouldRemove, 1);
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'NEW\n', 'simulate must not write');
});

test('incident CANNOT resolve without passing validation evidence', () => {
  const { root, reverse } = mixedWorkspace();
  const { rec, inc, incidentId } = managers();
  rec.stashReverseMaterial('corr_orig', root, reverse, incidentId);
  const plan = rec.plan('corr_orig');
  rec.apply(plan.recoveryId, plan.approvalToken, fs);
  // No evidence → refused.
  assert.throws(() => rec.resolve(plan.recoveryId, { ok: false, checked: 0 }), (e: unknown) => e instanceof RecoveryError && e.code === 'NO_VALIDATION_EVIDENCE');
  assert.equal(inc.get(incidentId)!.state, 'open'); // still open
  // With passing evidence → resolved + evidence recorded + recovery correlation linked.
  const evidence = rec.verify(plan.recoveryId, fs);
  rec.resolve(plan.recoveryId, evidence);
  const resolved = inc.get(incidentId)!;
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.resolution!.recoveryCorrelationId, plan.recoveryCorrelationId);
  assert.equal(resolved.resolution!.validationEvidence!.ok, true);
});

test('recovery audit chain links to the original incident + execution, no content leaked', () => {
  const { root, reverse } = mixedWorkspace();
  const { rec, incidentId } = managers();
  rec.stashReverseMaterial('corr_orig', root, reverse, incidentId);
  const plan = rec.plan('corr_orig');
  rec.apply(plan.recoveryId, plan.approvalToken, fs);
  rec.resolve(plan.recoveryId, rec.verify(plan.recoveryId, fs));
  const chain = auditStore.byCorrelation(plan.recoveryCorrelationId);
  const types = chain.map((r) => r.type);
  assert.ok(['recovery.started', 'recovery.plan_created', 'recovery.approved', 'recovery.applied', 'recovery.validation_completed', 'recovery.completed'].every((t) => types.includes(t as never)));
  // No file content / raw path in the recovery audit.
  const flat = JSON.stringify(chain);
  assert.ok(!flat.includes('ORIG') && !flat.includes(root));
});

test('recovery tolerates reverse material for a create whose write never landed (delete of an absent file)', () => {
  // The exact INCONSISTENT_STATE case: an apply pushed a `create` to the rollback
  // list, then its write faulted — so the file was never written. Reverse material
  // carries {previousContent:null} for it, but the file does not exist on disk.
  const root = mkdtempSync(path.join(tmpdir(), 'recovery-'));
  writeFileSync(path.join(root, 'keep.txt'), 'DAMAGED\n');
  // NOTE: never.txt is intentionally NOT created on disk.
  const reverse: ReverseEntry[] = [
    { path: 'keep.txt', previousContent: 'ORIG\n' },
    { path: 'never.txt', previousContent: null },
  ];
  const { rec } = managers();
  rec.stashReverseMaterial('corr_orig', root, reverse, 'inc1');
  const plan = rec.plan('corr_orig');
  // simulate prunes the delete of the absent file (would-remove drops to 0).
  const sim = rec.simulate(plan.recoveryId, fs);
  assert.equal(sim.wouldRemove, 0);
  assert.equal(sim.wouldRestore, 1);
  // apply succeeds (no "delete target does not exist") and restores keep.txt.
  const res = rec.apply(plan.recoveryId, plan.approvalToken, fs);
  assert.deepEqual(res.modified, ['keep.txt']);
  assert.deepEqual(res.deleted, []);
  assert.equal(readFileSync(path.join(root, 'keep.txt'), 'utf8'), 'ORIG\n');
  assert.equal(existsSync(path.join(root, 'never.txt')), false);
  // verify still passes: the absent file is already in the desired state.
  assert.equal(rec.verify(plan.recoveryId, fs).ok, true);
});

test('resolveWithEvidence throws without evidence (incident manager guard)', () => {
  const sink = new LocalAlertSink();
  const inc = new IncidentManager(sink.sink, () => 1);
  const { incident } = inc.raiseInconsistentState({ correlationId: 'c', workspaceIdentityHash: 'w', proposalHashPrefix: 'p', appliedFileCount: 1, affectedPathCount: 1, rollbackFailureCount: 1, failureStage: 'rollback' });
  assert.throws(() => inc.resolveWithEvidence(incident.incidentId, { recoveryCorrelationId: '', validationEvidence: { checked: 0, ok: false }, note: 'x' }));
  assert.equal(inc.get(incident.incidentId)!.state, 'open');
});
