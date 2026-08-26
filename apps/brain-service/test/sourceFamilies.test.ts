/**
 * The open-source-family coverage map.
 *
 * These tests protect the map's HONESTY, not its optimism: the projection must
 * stay a projection, the legal position must stay conservative, and the gap
 * that still needs a paid provider must stay computed rather than asserted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SOURCE_FAMILIES, familiesFor, uncoveredCategories } from '../src/engine/live/sourceFamilies.js';
import { CATEGORIES } from '../src/engine/live/qualification/battery.js';

test('every family states what it CANNOT do', () => {
  // A capability list without a boundary invites the router to over-reach.
  for (const f of SOURCE_FAMILIES) {
    assert.ok(f.cannotServe.length > 20, `${f.id} does not say what it cannot serve`);
    assert.ok(f.obligations.length > 0, `${f.id} lists no obligations`);
  }
});

test('a family is never marked legally clear without its obligations written out', () => {
  /*
   * "Clear" is the word that would let something ship. It may only appear
   * alongside the specific obligations that make it clear — never as a summary
   * judgment standing on its own.
   */
  for (const f of SOURCE_FAMILIES) {
    if (f.legal === 'clear_with_obligations') {
      assert.ok(f.obligations.length >= 2, `${f.id} claims clarity with too little detail`);
    }
    assert.notEqual(f.legal, 'clear', `${f.id} claims unqualified clearance — none has earned that`);
  }
});

test('unverified families are honestly marked, not optimistically promoted', () => {
  // Four of seven were not fully read. That must be visible, not smoothed over.
  const unverified = SOURCE_FAMILIES.filter((f) => f.legal === 'unverified').map((f) => f.id);
  assert.ok(unverified.includes('official_docs'), 'per-publisher terms were not read');
  assert.ok(unverified.includes('gov_open_data'), 'agency terms were not read');
  assert.ok(unverified.includes('package_registries'), 'registry terms were not read');
});

test('every family is free — that is the entire point of the set', () => {
  for (const f of SOURCE_FAMILIES) assert.equal(f.costPerQueryCents, 0, f.id);
});

test('the gap needing a paid general-web provider is COMPUTED, not claimed', () => {
  /*
   * This number decides whether a paid vendor is necessary at all, so it must
   * fall out of the map rather than being written down by whoever built it.
   */
  const gap = uncoveredCategories(CATEGORIES);
  // The open families are strong on authority and documentation, and by
  // construction cannot do open-ended web discovery or adversarial cases.
  for (const expected of ['correctly_empty', 'contradictory_sources', 'price_or_availability', 'failure_behaviour']) {
    assert.ok(gap.includes(expected as never), `${expected} should be uncovered by open sources`);
  }
  assert.ok(gap.length >= 3, 'a general-web gap genuinely remains');
  assert.ok(gap.length < CATEGORIES.length, 'but open sources cover real ground');
});

test('the strongest coverage is authority, which is where paid search is weakest', () => {
  // The argument for this whole file: for official material, going direct beats
  // paying an API to rank a guess at where it lives.
  assert.ok(familiesFor('primary_technical_docs').length >= 3);
  assert.ok(familiesFor('official_source').length >= 1);
});

test('no family claims to serve a job it cannot reach', () => {
  // arXiv is metadata-only; it must not be offered for anything needing page text.
  const arxiv = SOURCE_FAMILIES.find((f) => f.id === 'arxiv')!;
  assert.equal(arxiv.returns, 'metadata_only');
  assert.ok(
    !arxiv.servesCategories.includes('extraction_after_discovery'),
    'metadata-only cannot satisfy an extraction job',
  );
});
