/**
 * The preference contract.
 *
 * Every failure mode here is silent. A preference that fails to validate becomes
 * a setting the user believes they chose; a patch that overwrites keys it never
 * mentioned wipes decisions the user made on another screen; a retention value
 * that slips through DELETES conversations on a schedule nobody picked.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_PREFERENCES,
  MAX_CUSTOM_INSTRUCTIONS,
  applyPreferencePatch,
  normalizePreferences,
  turnPreferences,
} from './user-preferences.js';

test('an empty document yields the complete defaults', () => {
  const p = normalizePreferences({});
  assert.deepEqual(p, DEFAULT_PREFERENCES);
  // Every key present: a missing one renders as a blank control.
  for (const key of Object.keys(DEFAULT_PREFERENCES)) {
    assert.ok(key in p, `${key} must always be present`);
  }
});

test('a document from an OLDER build gains new preferences at their defaults', () => {
  // The whole reason the store is one JSON document rather than columns.
  const p = normalizePreferences({ responseStyle: 'concise' });
  assert.equal(p.responseStyle, 'concise', 'what was stored survives');
  assert.equal(p.autonomyLevel, DEFAULT_PREFERENCES.autonomyLevel, 'what is new takes its default');
});

test('a document from a NEWER build does not leak unknown keys onward', () => {
  // The only thing downstream of here is a model prompt.
  const p = normalizePreferences({ responseStyle: 'formal', somethingFromTheFuture: 'ignore me' });
  assert.equal(p.responseStyle, 'formal');
  assert.ok(!('somethingFromTheFuture' in p));
});

test('an invalid value falls back rather than being stored as-is', () => {
  const p = normalizePreferences({
    responseStyle: 'shakespearean',
    detailLevel: 42,
    theme: null,
    saveHistory: 'yes',
  });
  assert.equal(p.responseStyle, DEFAULT_PREFERENCES.responseStyle);
  assert.equal(p.detailLevel, DEFAULT_PREFERENCES.detailLevel);
  assert.equal(p.theme, DEFAULT_PREFERENCES.theme);
  assert.equal(p.saveHistory, DEFAULT_PREFERENCES.saveHistory);
});

test('RETENTION is bounded, because a bad value here deletes conversations', () => {
  assert.equal(normalizePreferences({ retentionDays: -1 }).retentionDays, DEFAULT_PREFERENCES.retentionDays);
  assert.equal(normalizePreferences({ retentionDays: 99999 }).retentionDays, DEFAULT_PREFERENCES.retentionDays);
  assert.equal(normalizePreferences({ retentionDays: NaN }).retentionDays, DEFAULT_PREFERENCES.retentionDays);
  assert.equal(normalizePreferences({ retentionDays: 30 }).retentionDays, 30, 'a sane value is kept');
  assert.equal(normalizePreferences({ retentionDays: 0 }).retentionDays, 0, '0 means keep forever');
});

test('custom instructions are bounded', () => {
  const long = 'x'.repeat(MAX_CUSTOM_INSTRUCTIONS + 500);
  assert.equal(normalizePreferences({ customInstructions: long }).customInstructions.length, MAX_CUSTOM_INSTRUCTIONS);
});

test('a patch touches ONLY the keys it names', () => {
  /*
   * The failure this prevents: a client that knows about three preferences
   * sending its whole object and blanking the twelve it has never heard of.
   */
  const current = { ...DEFAULT_PREFERENCES, responseStyle: 'technical' as const, retentionDays: 30 };
  const { next, changed } = applyPreferencePatch(current, { detailLevel: 'thorough' });

  assert.equal(next.detailLevel, 'thorough');
  assert.equal(next.responseStyle, 'technical', 'untouched key survives');
  assert.equal(next.retentionDays, 30, 'untouched key survives');
  assert.deepEqual(changed, ['detailLevel']);
});

test('a patch that changes nothing reports nothing changed', () => {
  // "Saved" and "changed nothing" are different outcomes, and only the second
  // kind should reach an audit trail.
  const { changed } = applyPreferencePatch(DEFAULT_PREFERENCES, {
    responseStyle: DEFAULT_PREFERENCES.responseStyle,
  });
  assert.deepEqual(changed, []);
});

test('a patch with an invalid value does not report it as changed', () => {
  const { next, changed } = applyPreferencePatch(DEFAULT_PREFERENCES, { theme: 'neon' });
  assert.equal(next.theme, DEFAULT_PREFERENCES.theme);
  assert.deepEqual(changed, [], 'a rejected value is not a change');
});

test('only turn-relevant preferences reach the model', () => {
  /*
   * A preference the model does not need is a preference it cannot leak. Theme
   * and email settings have no business in a prompt.
   */
  const t = turnPreferences({ ...DEFAULT_PREFERENCES, theme: 'dark', securityEmails: false });
  assert.deepEqual(Object.keys(t).sort(), ['customInstructions', 'detailLevel', 'language', 'responseStyle']);
});
