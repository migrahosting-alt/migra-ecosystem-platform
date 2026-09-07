// Outcome orchestration: one plan, many authorities, one contract.
//
// The defects these pin are both real and both shipped: a build request answered
// with a description of a screenshot (a child result mistaken for the answer),
// and a surface treated as a capability rather than the authority it presents.

import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchOutcome, type ChildDispatchRecord, type StepExecutor } from '../src/engine/orchestration/outcomeDispatcher.js';
import { planOutcome } from '@migrapilot/shared-types/outcome-plan';
import { NO_AUTHORITY, vscodeWorkspaceAuthority, type ProjectAuthority } from '@migrapilot/shared-types/project-authority';

const OBJECTIVE = 'can you help me build this page';
const buildPlan = () => planOutcome({ objective: OBJECTIVE, intent: 'implement', hasImage: true });

/** An executor that records the objective it was handed and returns a marker. */
const exec = (result: unknown, seen?: string[]): StepExecutor => async (ctx) => {
  seen?.push(ctx.objective);
  return { result, executedBackend: 'backend-x', selectedFamily: 'migra-forge' };
};

const fullExecutors = (seen?: string[]) => ({
  'vision.read': exec({ spec: 'a purple header' }, seen),
  'design.spec': exec({ spec: 'structured' }, seen),
  'engineer.plan': exec({ plan: 'create index.html' }, seen),
  'workspace.inspect': exec({ files: ['index.html'] }, seen),
  'changeset.propose': exec({ ops: 1 }, seen),
  verification: exec({ built: true }, seen),
});

/** A connected repo that may read and propose but never write. */
const READ_ONLY_REPO: ProjectAuthority = {
  kind: 'connected-repo',
  id: 'repo_1',
  label: 'the connected repository',
  canRead: true,
  canPropose: true,
  canApply: false,
};

test('THE REGRESSION: a successful vision read does NOT end a build turn', async () => {
  const res = await dispatchOutcome(buildPlan(), {
    parentTurnId: 't1',
    authority: vscodeWorkspaceAuthority('/ws'),
    executors: fullExecutors(),
  });
  assert.equal(res.completed, true);
  // The answer is the TERMINAL step's result, not the vision read's.
  assert.deepEqual(res.answer, { built: true });
  const steps = res.records.map((r) => r.step);
  assert.deepEqual(steps, ['vision.read', 'design.spec', 'engineer.plan', 'workspace.inspect', 'changeset.propose', 'verification']);
});

test('the ORIGINAL objective reaches every child unchanged', async () => {
  const seen: string[] = [];
  await dispatchOutcome(buildPlan(), {
    parentTurnId: 't2',
    authority: vscodeWorkspaceAuthority('/ws'),
    executors: fullExecutors(seen),
  });
  assert.equal(seen.length, 6);
  // A child result must never overwrite what the user actually asked for.
  assert.deepEqual([...new Set(seen)], [OBJECTIVE]);
});

test('SAME PLAN, DIFFERENT AUTHORITY — the orchestration contract does not change', async () => {
  const plan = buildPlan();
  const runs: Array<[string, ProjectAuthority, boolean]> = [
    ['vscode workspace', vscodeWorkspaceAuthority('/ws'), true],
    ['connected repo (read+propose)', READ_ONLY_REPO, true],
  ];
  for (const [label, authority, shouldComplete] of runs) {
    const res = await dispatchOutcome(plan, { parentTurnId: 't3', authority, executors: fullExecutors() });
    assert.equal(res.completed, shouldComplete, label);
    // Identical step sequence under a different authority — the plan is the
    // contract, the authority is only where the work lands.
    assert.deepEqual(
      res.records.map((r) => r.step),
      ['vision.read', 'design.spec', 'engineer.plan', 'workspace.inspect', 'changeset.propose', 'verification'],
      label,
    );
    // And provenance names WHICH authority actually executed it.
    assert.ok(res.records.every((r) => r.toolAuthority.startsWith(authority.kind)), label);
  }
});

test('SURFACE IS NOT CAPABILITY: no authority stops the run at its exact boundary', async () => {
  const res = await dispatchOutcome(buildPlan(), {
    parentTurnId: 't4',
    authority: NO_AUTHORITY,
    executors: fullExecutors(),
  });
  assert.equal(res.completed, false);
  // It got through the steps that need nothing, and stopped at the first that does.
  assert.equal(res.stoppedAt, 'workspace.inspect');
  assert.match(res.failure ?? '', /no project is connected/);
  // Crucially it did NOT fall through to a weaker workflow or an answer.
  assert.equal(res.answer, undefined);
});

test('a read-only authority fails at PROPOSE, not earlier and not silently', async () => {
  const readOnly: ProjectAuthority = { ...READ_ONLY_REPO, canPropose: false };
  const res = await dispatchOutcome(buildPlan(), {
    parentTurnId: 't5',
    authority: readOnly,
    executors: fullExecutors(),
  });
  assert.equal(res.stoppedAt, 'changeset.propose');
  assert.match(res.failure ?? '', /read-only/);
  // Inspection succeeded before it — the failure is at the true boundary.
  assert.equal(res.records.find((r) => r.step === 'workspace.inspect')?.outcome, 'ok');
});

test('a missing specialist is a named capability gap, never a skipped step', async () => {
  const executors = { ...fullExecutors() } as Record<string, StepExecutor>;
  delete executors['engineer.plan'];
  const res = await dispatchOutcome(buildPlan(), {
    parentTurnId: 't6',
    authority: vscodeWorkspaceAuthority('/ws'),
    executors,
  });
  assert.equal(res.stoppedAt, 'engineer.plan');
  /*
   * The wording moved from "not available in this runtime" to the user-facing
   * "is not available here yet" when capability IDS were removed from copy.
   * What this test protects is unchanged: the gap is NAMED, and named by the
   * step's readable label rather than skipped silently.
   */
  assert.match(res.failure ?? '', /not available here yet/);
  assert.match(res.failure ?? '', /Planning the work/, 'named by its label, not its id');
  assert.doesNotMatch(res.failure ?? '', /engineer\.plan/, 'the capability id must not reach copy');
});

test('every child dispatch is recorded, including the one that failed', async () => {
  const seen: ChildDispatchRecord[] = [];
  const res = await dispatchOutcome(buildPlan(), {
    parentTurnId: 't7',
    authority: NO_AUTHORITY,
    executors: fullExecutors(),
    onRecord: (r) => seen.push(r),
  });
  assert.equal(seen.length, res.records.length);
  const failed = seen.filter((r) => r.outcome === 'failed');
  assert.equal(failed.length, 1);
  for (const r of seen) {
    assert.equal(r.parentTurnId, 't7');
    assert.ok(r.toolAuthority, 'every record names the authority it ran under');
    assert.ok(r.startedAt && r.finishedAt);
  }
  // Requested vs executed stay separate on the successful ones.
  const ok = seen.find((r) => r.outcome === 'ok')!;
  assert.equal(ok.selectedFamily, 'migra-forge');
  assert.equal(ok.executedBackend, 'backend-x');
});

test('a describe intent legitimately terminates at the vision read', async () => {
  const plan = planOutcome({ objective: 'what is in this image?', intent: 'describe', hasImage: true });
  const res = await dispatchOutcome(plan, {
    parentTurnId: 't8',
    authority: NO_AUTHORITY,
    executors: { 'vision.read': exec({ description: 'a purple header' }) },
  });
  assert.equal(res.completed, true);
  assert.deepEqual(res.answer, { description: 'a purple header' });
  // No authority was needed, and none was demanded.
  assert.deepEqual(res.records.map((r) => r.step), ['vision.read']);
});

test('a plan with no terminal step is reported, not answered from the last child', async () => {
  const malformed = { objective: 'x', intent: 'implement' as const, steps: [{ step: 'vision.read' as const, terminal: false }] };
  const res = await dispatchOutcome(malformed, {
    parentTurnId: 't9',
    authority: vscodeWorkspaceAuthority('/ws'),
    executors: { 'vision.read': exec({ text: 'looks nice' }) },
  });
  assert.equal(res.completed, false);
  assert.equal(res.answer, undefined, 'an intermediate result must never be returned as the answer');
  assert.match(res.failure ?? '', /without a terminal step/);
});
