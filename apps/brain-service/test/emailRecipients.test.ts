/**
 * RECIPIENT RESOLUTION — and the refusal to guess.
 *
 * "Email James" is not an address. Picking the more recent or more frequent
 * James is a guess that sends a real message to a real stranger, and the user
 * finds out when the wrong person replies. By then it is irreversible.
 *
 * The tempting rule — "use the most recent" — is wrong precisely BECAUSE it is
 * usually right: it trains the user to stop reading the recipient, so the one
 * time it picks wrong is the time nobody checks.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  looksLikeAddress,
  resolveAll,
  resolveRecipient,
  type KnownContact,
} from '../src/engine/email/recipients.js';

const CONTACTS: KnownContact[] = [
  { address: 'james.okafor@example.com', name: 'James Okafor', messageCount: 40, lastSeenAt: '2026-09-01T00:00:00Z' },
  { address: 'james.lee@other.com', name: 'James Lee', messageCount: 3, lastSeenAt: '2026-08-01T00:00:00Z' },
  { address: 'maria@example.com', name: 'Maria Santos', messageCount: 12, lastSeenAt: '2026-09-05T00:00:00Z' },
];

/* ------------------------------------------------------------------ *
 * 🚨 The refusal
 * ------------------------------------------------------------------ */

test('🚨 two people named James is AMBIGUOUS, never resolved', () => {
  const resolution = resolveRecipient('James', CONTACTS);
  assert.equal(resolution.kind, 'ambiguous');
  if (resolution.kind === 'ambiguous') {
    assert.equal(resolution.candidates.length, 2);
  }
});

test('🚨 recency and volume do NOT break the tie', () => {
  /*
   * James Okafor has 40 messages and is more recent. That makes him the
   * likeliest, which is exactly why he must not be chosen automatically —
   * "usually right" is what stops the user reading the recipient at all.
   */
  const resolution = resolveRecipient('James', CONTACTS);
  assert.notEqual(resolution.kind, 'resolved', 'a heuristic picked a recipient');
});

test('candidates are ordered for PRESENTATION, and that is all', () => {
  // Sorting so the chooser can show the likeliest first is a display aid.
  // Nothing here selects one.
  const resolution = resolveRecipient('James', CONTACTS);
  assert.equal(resolution.kind, 'ambiguous');
  if (resolution.kind === 'ambiguous') {
    assert.equal(resolution.candidates[0]!.address, 'james.okafor@example.com');
  }
});

test('exactly one match resolves', () => {
  const resolution = resolveRecipient('Maria', CONTACTS);
  assert.equal(resolution.kind, 'resolved');
  if (resolution.kind === 'resolved') assert.equal(resolution.address.address, 'maria@example.com');
});

test('nobody matching is UNKNOWN, distinct from ambiguous', () => {
  // Different remedies: ambiguous means choose, unknown means there is nobody
  // to choose from and the user must supply an address.
  const resolution = resolveRecipient('Fatima', CONTACTS);
  assert.equal(resolution.kind, 'unknown');
});

/* ------------------------------------------------------------------ *
 * Explicit addresses
 * ------------------------------------------------------------------ */

test('an explicit address proceeds — there is nothing to disambiguate', () => {
  const resolution = resolveRecipient('someone@elsewhere.org', CONTACTS);
  assert.equal(resolution.kind, 'resolved');
  if (resolution.kind === 'resolved') assert.equal(resolution.address.address, 'someone@elsewhere.org');
});

test('an explicit address is still VALIDATED', () => {
  // A permissive check means a malformed address reaches the provider and
  // fails at dispatch — after the user approved the send.
  for (const bad of ['not-an-address@', '@example.com', 'a@b', 'two@@at.com', 'spaces in@x.com']) {
    const resolution = resolveRecipient(bad, CONTACTS);
    assert.equal(resolution.kind, 'invalid', `${bad} was accepted`);
  }
});

test('address validation accepts ordinary real addresses', () => {
  for (const good of ['a@b.co', 'first.last+tag@sub.example.com', 'x_y@example.org']) {
    assert.equal(looksLikeAddress(good), true, `${good} was rejected`);
  }
});

test('an empty recipient is invalid, not unknown', () => {
  assert.equal(resolveRecipient('   ', CONTACTS).kind, 'invalid');
});

/* ------------------------------------------------------------------ *
 * Matching precision
 * ------------------------------------------------------------------ */

test('a partial name does not match', () => {
  // "Jam" matching "James" would resolve a recipient the user never named.
  assert.equal(resolveRecipient('Jam', CONTACTS).kind, 'unknown');
});

test('a surname matches, because it is a whole name part', () => {
  const resolution = resolveRecipient('Okafor', CONTACTS);
  assert.equal(resolution.kind, 'resolved');
});

test('the local part of an address matches exactly', () => {
  const resolution = resolveRecipient('maria', CONTACTS);
  assert.equal(resolution.kind, 'resolved');
});

/* ------------------------------------------------------------------ *
 * 🚨 All-or-nothing
 * ------------------------------------------------------------------ */

test('🚨 ONE unresolved recipient refuses the WHOLE send', () => {
  /*
   * Sending to the three we understood and asking about the fourth delivers a
   * partial message the user never approved — and it cannot be un-sent to the
   * people who already have it.
   */
  const result = resolveAll(['maria@example.com', 'James'], CONTACTS);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.problems.length, 1);
    assert.equal(result.problems[0]!.kind, 'ambiguous');
  }
});

test('all recipients resolving succeeds', () => {
  const result = resolveAll(['Maria', 'someone@elsewhere.org'], CONTACTS);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(result.addresses.map((a) => a.address), ['maria@example.com', 'someone@elsewhere.org']);
  }
});

test('every problem is reported, not just the first', () => {
  // A user fixing one at a time, discovering the next each round, is a worse
  // experience than being told all of them at once.
  const result = resolveAll(['James', 'Fatima', 'bad@'], CONTACTS);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.problems.length, 3);
});

test('🚨 candidates come only from contacts the mailbox has SEEN', () => {
  /*
   * Synthesising an address — from a directory, or by guessing a company's
   * format — would put a mailbox nobody has corresponded with in front of the
   * user as though it were known.
   */
  const resolution = resolveRecipient('James', []);
  assert.equal(resolution.kind, 'unknown', 'a candidate was invented from an empty contact set');
});
