/**
 * Product promise versus implementation choice, tested as two questions.
 *
 * The distinction existed only as an accident of two code paths having
 * different strictness. These pin it as a rule.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isEligible, mayClaimFamily } from '../src/engine/models/eligibilityPolicy.js';

const base = {
  approved: false, allowRemote: false, enforceQualification: false,
  hosting: 'on-device' as const,
};

test('🚨 a governed family requires an approval; internal routing does not', () => {
  const input = { ...base, governedCapability: 'reasoning.deep', approved: false };
  const family = isEligible('product-family', input);
  const routing = isEligible('internal-routing', input);
  assert.equal(family.eligible, false);
  if (!family.eligible) assert.equal(family.reason, 'not_approved');
  // This is the live situation today: the router may use deepseek-r1:32b for a
  // deep turn while Migra Logic correctly reports nothing is approved.
  assert.equal(routing.eligible, true);
});

test('an approved capability satisfies the family gate', () => {
  const v = isEligible('product-family', { ...base, governedCapability: 'reasoning.deep', approved: true });
  assert.equal(v.eligible, true);
});

test('a family declaring NO governed capability falls back to the router bar', () => {
  // How Migra Forge is available on measured task-class grants with no approval.
  const permissive = isEligible('product-family', { ...base, governedCapability: undefined });
  assert.equal(permissive.eligible, true);
  const enforced = isEligible('product-family', {
    ...base, governedCapability: undefined, enforceQualification: true, qualificationState: 'installed',
  });
  assert.equal(enforced.eligible, false);
  if (!enforced.eligible) assert.equal(enforced.reason, 'not_qualified');
});

test('🚨 locality binds BOTH contexts — nobody naming the model does not let bytes leave', () => {
  for (const ctx of ['product-family', 'internal-routing'] as const) {
    const v = isEligible(ctx, { ...base, hosting: 'remote', approved: true, governedCapability: undefined });
    assert.equal(v.eligible, false, `${ctx} allowed a remote model`);
    if (!v.eligible) assert.equal(v.reason, 'remote_not_allowed');
  }
});

test('remote is permitted only when the deployment opts in', () => {
  const v = isEligible('internal-routing', { ...base, hosting: 'remote', allowRemote: true });
  assert.equal(v.eligible, true);
});

test('enforcement still binds internal routing', () => {
  const v = isEligible('internal-routing', {
    ...base, enforceQualification: true, qualificationState: 'installed',
  });
  assert.equal(v.eligible, false);
  if (!v.eligible) assert.equal(v.reason, 'not_qualified');
});

test('🚨 THE INVARIANT: an unapproved turn may be SERVED but never CLAIMED', () => {
  // The boundary is the claim, not the model. Using a capable model for an
  // unnamed turn is an implementation choice; calling that turn "Migra Logic"
  // asserts a promise governance never granted.
  assert.equal(mayClaimFamily('reasoning.deep', false), false);
  assert.equal(mayClaimFamily('reasoning.deep', true), true);
  // A family that promises nothing governed can always be named.
  assert.equal(mayClaimFamily(undefined, false), true);
});
