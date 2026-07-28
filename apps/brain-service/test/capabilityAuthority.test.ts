import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BENCH_COMMIT,
  DEEP_LOCAL_MODEL,
  ESCALATE_ALWAYS,
  FAST_LOCAL_MODEL,
  MEASURED_GRANTS,
  assertGrantsWellFormed,
  capabilityAuditFields,
  resolveCapability,
  tierOfModel,
} from '../src/engine/capability/capabilityGrants.js';
import {
  TASK_CLASSES,
  capabilityDisclosure,
  parseTaskClass,
  tierAtLeast,
  type CapabilityGrant,
} from '@migrapilot/protocol';

/**
 * Authority must be earned, and the evidence must be the kind that can earn it.
 *
 * The benchmark that produced these grants scored one task by EXECUTION and three by an
 * assistant reading output against criteria the assistant also wrote. That asymmetry is
 * the whole design constraint: reading is sound for refusing authority and unsound for
 * granting it, because the assessor and the assessed are the same class of thing.
 *
 * So the tests here care less about the numbers than about the shape — that an unmeasured
 * pair cannot become a permission, that a reviewed score cannot become autonomy, and that
 * a turn which ran without backing says so.
 */

// ── the rule that cannot be broken by adding a row ───────────────────────────

test('an autonomous grant REQUIRES mechanically-scored evidence', () => {
  const readOnly: CapabilityGrant = {
    model: FAST_LOCAL_MODEL,
    taskClass: 'code-review',
    authority: 'autonomous',
    requiredTier: 'cloud',
    evidence: { benchCommit: 'x', score: 10, maxScore: 10, measuredAt: '2026-07-28', mechanical: false },
  };
  // A perfect score is not enough if a model produced it by reading another model's work.
  assert.throws(() => assertGrantsWellFormed([readOnly]), /non-mechanical scoring/);

  const noEvidence: CapabilityGrant = { ...readOnly, evidence: undefined };
  assert.throws(() => assertGrantsWellFormed([noEvidence]), /has no evidence/);

  // The same grant is fine once the score comes from execution.
  assert.doesNotThrow(() =>
    assertGrantsWellFormed([{ ...readOnly, evidence: { ...readOnly.evidence!, mechanical: true } }]),
  );
});

test('ungoverned is a decision outcome and never a stored grant', () => {
  assert.throws(
    () => assertGrantsWellFormed([{ model: 'm', taskClass: 'refactoring', authority: 'ungoverned', requiredTier: 'fast-local' }]),
    /never a stored grant/,
  );
});

test('the shipped grant set is well formed and only one row is autonomous per model', () => {
  assert.doesNotThrow(() => assertGrantsWellFormed(MEASURED_GRANTS));
  const autonomous = MEASURED_GRANTS.filter((g) => g.authority === 'autonomous');
  // Exactly the typed-implementation rows — the only task the benchmark scored by running
  // the code. Everything else was read, so nothing else can be autonomous.
  assert.deepEqual(
    autonomous.map((g) => `${g.model}/${g.taskClass}`).sort(),
    [`${DEEP_LOCAL_MODEL}/typed-implementation`, `${FAST_LOCAL_MODEL}/typed-implementation`],
  );
  assert.ok(autonomous.every((g) => g.evidence?.mechanical === true));
});

// ── fail closed ──────────────────────────────────────────────────────────────

test('an UNMEASURED pair is denied, not assumed competent', () => {
  const d = resolveCapability({ taskClass: 'refactoring', model: FAST_LOCAL_MODEL });
  assert.equal(d.authority, 'denied');
  assert.equal(d.evidenceBacked, false);
  assert.match(d.reason, /no measured grant/);
  assert.match(d.unverified.join(' '), /never measured/);
});

test('an unrecognised model gets the WEAKEST tier, never inherited authority', () => {
  assert.equal(tierOfModel('some-new-model:70b'), 'fast-local');
  const d = resolveCapability({ taskClass: 'repository-diagnosis', model: 'some-new-model:70b' });
  assert.equal(d.authority, 'denied');
  // A 70B in the name must not buy a deep-tier claim.
  assert.equal(d.routedTier, 'fast-local');
  assert.equal(d.belowRequiredTier, true);
});

test('a malformed task class degrades to unclassified, never to a family', () => {
  for (const bad of ['SECURITY-REVIEW', 'security review', 'anything', '', null, undefined, 7]) {
    assert.equal(parseTaskClass(bad), 'unclassified', `must not honour ${String(bad)}`);
  }
});

test('an undeclared task class is UNGOVERNED — not a permission and not a refusal', () => {
  const d = resolveCapability({ model: FAST_LOCAL_MODEL });
  assert.equal(d.taskClass, 'unclassified');
  assert.equal(d.authority, 'ungoverned');
  assert.equal(d.evidenceBacked, false);
  // The honest statement: the turn is outside the system. Claiming competence OR a refusal
  // would both be inventions, and existing callers omit the field.
  assert.match(d.reason, /no task class was declared/);
  assert.deepEqual(d.unverified, ['task class (caller did not declare one)']);
  assert.equal(d.belowRequiredTier, false, 'undeclared work asserts nothing, so it demands nothing');
});

// ── risk beats score ─────────────────────────────────────────────────────────

test('security review, patch planning and governance escalate regardless of score', () => {
  assert.deepEqual([...ESCALATE_ALWAYS].sort(), ['governance-compliance', 'patch-planning', 'security-review']);
  for (const taskClass of ESCALATE_ALWAYS) {
    for (const model of [FAST_LOCAL_MODEL, DEEP_LOCAL_MODEL]) {
      const d = resolveCapability({ taskClass, model });
      assert.equal(d.authority, 'denied', `${model} must not act on ${taskClass}`);
      assert.match(d.reason, /escalates to/);
      assert.ok(tierAtLeast(d.requiredTier, 'cloud'), `${taskClass} requires cloud or higher`);
    }
  }
});

test('a cloud model satisfies an escalate-always class', () => {
  const d = resolveCapability({ taskClass: 'security-review', model: 'gpt-oss:120b-cloud' });
  assert.equal(d.routedTier, 'cloud');
  // Still not autonomous — no cloud model has been measured on this class either. The
  // point is that the tier requirement is met, so it is refused for a DIFFERENT reason.
  assert.match(d.reason, /no measured grant/);
  assert.ok(!/escalates to/.test(d.reason));
});

// ── the grants match what the benchmark actually found ───────────────────────

test('the grants reproduce the measured verdicts, including the failures', () => {
  const typed7 = resolveCapability({ taskClass: 'typed-implementation', model: FAST_LOCAL_MODEL });
  assert.equal(typed7.authority, 'autonomous');
  assert.match(typed7.reason, /9\/10 on typed-implementation \(mechanical scoring, bench 46806e5a\)/);

  // 14B diagnosed correctly and is still only advisory, because that score was READ.
  const diag14 = resolveCapability({ taskClass: 'repository-diagnosis', model: DEEP_LOCAL_MODEL });
  assert.equal(diag14.authority, 'advisory');
  assert.match(diag14.reason, /reviewed scoring/);
  assert.match(diag14.unverified.join(' '), /advisory only — review required/);

  // Both models are denied code review; neither found the planted SSRF defect.
  for (const model of [FAST_LOCAL_MODEL, DEEP_LOCAL_MODEL]) {
    assert.equal(resolveCapability({ taskClass: 'code-review', model }).authority, 'denied');
  }
});

test('every task class has a required tier, so none can slip through unranked', () => {
  for (const taskClass of TASK_CLASSES) {
    const d = resolveCapability({ taskClass, model: FAST_LOCAL_MODEL });
    assert.ok(d.requiredTier, `${taskClass} has no required tier`);
  }
});

// ── disclosure ───────────────────────────────────────────────────────────────

test('the disclosure states the model, the authority and what was not verified', () => {
  const measured = resolveCapability({ taskClass: 'code-review', model: FAST_LOCAL_MODEL });
  const text = capabilityDisclosure(measured).join('\n');
  assert.match(text, new RegExp(`Capability: ${FAST_LOCAL_MODEL} — denied for code-review`));
  assert.match(text, /Tier: fast-local \(this class requires cloud\)/);
  assert.match(text, /ran below the tier its task class requires/);
  assert.match(text, /Not verified: /);

  // This denial IS evidence-backed — the 7B was measured at 0/10 on code review. A denial
  // for a MEASURED failure and a denial for the absence of any measurement are different
  // operator situations, so the disclosure must not blur them.
  assert.equal(measured.evidenceBacked, true);
  assert.ok(!/No measured capability evidence/.test(text));

  const unmeasured = resolveCapability({ taskClass: 'refactoring', model: FAST_LOCAL_MODEL });
  const unmeasuredText = capabilityDisclosure(unmeasured).join('\n');
  assert.equal(unmeasured.evidenceBacked, false);
  assert.match(unmeasuredText, /No measured capability evidence backs .* for refactoring/);
});

test('an autonomous turn discloses without warnings it has not earned', () => {
  const text = capabilityDisclosure(resolveCapability({ taskClass: 'typed-implementation', model: FAST_LOCAL_MODEL })).join('\n');
  assert.match(text, /autonomous for typed-implementation/);
  assert.ok(!/ran below the tier/.test(text));
  assert.ok(!/No measured capability evidence/.test(text));
  assert.ok(!/Not verified/.test(text), 'a backed autonomous turn has nothing outstanding');
});

test('an ungoverned turn says so rather than implying approval', () => {
  const text = capabilityDisclosure(resolveCapability({ model: DEEP_LOCAL_MODEL })).join('\n');
  assert.match(text, /ungoverned for unclassified/);
  assert.match(text, /Not verified: task class/);
  // It must not read as a grant.
  assert.ok(!/autonomous/.test(text));
  // And it must not claim missing evidence for a class that does not exist.
  assert.ok(!/No measured capability evidence/.test(text), 'no class means nothing to have evidence for');
});

// ── audit ────────────────────────────────────────────────────────────────────

test('the audit record is flat primitives and traces to the bench commit', () => {
  const fields = capabilityAuditFields(resolveCapability({ taskClass: 'patch-planning', model: FAST_LOCAL_MODEL }));
  assert.equal(fields.taskClass, 'patch-planning');
  assert.equal(fields.authority, 'denied');
  assert.equal(fields.requiredTier, 'cloud');
  assert.equal(fields.routedTier, 'fast-local');
  assert.equal(fields.belowRequiredTier, true);
  assert.equal(fields.benchCommit, BENCH_COMMIT);

  // Flat: the audit store collapses nested objects to `[object]`, which silently discarded
  // live-knowledge provenance once already.
  for (const [k, v] of Object.entries(fields)) {
    const flat = v === null || ['string', 'number', 'boolean'].includes(typeof v)
      || (Array.isArray(v) && v.every((x) => typeof x === 'string'));
    assert.ok(flat, `${k} must be a primitive or string[], got ${typeof v}`);
  }
  assert.ok(!JSON.stringify(fields).includes('[object'));
});

test('the audit carries no prompt, no model output and no scoring prose', () => {
  const fields = capabilityAuditFields(resolveCapability({ taskClass: 'repository-diagnosis', model: DEEP_LOCAL_MODEL }));
  const blob = JSON.stringify(fields);
  // The grant NOTES are operator documentation, not audit payload — they describe another
  // model's output and have no place in a durable per-turn record.
  for (const forbidden of ['duplicate inputs', 'root cause exact', 'empty vectors', 'SSRF']) {
    assert.ok(!blob.includes(forbidden), `audit must not carry grant prose: ${forbidden}`);
  }
});
