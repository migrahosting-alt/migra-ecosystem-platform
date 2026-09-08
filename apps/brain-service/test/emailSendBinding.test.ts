/**
 * WHAT AN APPROVAL TO SEND IS AN APPROVAL OF.
 *
 * The failure guarded here: a user reads a draft to their accountant, approves
 * it, and a different message goes out — because the approval was never bound
 * to what they saw. Every step is "authorized"; there is a real approval and a
 * real send. Only the binding was missing.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  bindingFor,
  changedFields,
  fingerprintDraft,
  idempotencyKeyFor,
  normalizeBody,
} from '../src/engine/email/sendBinding.js';
import type { EmailDraft } from '../src/engine/email/types.js';

const ACCOUNT = 'owner@migrateck.com';

const draft = (over: Partial<EmailDraft> = {}): EmailDraft => ({
  to: [{ address: 'james@example.com' }],
  cc: [],
  bcc: [],
  subject: 'Contract review',
  body: 'Attached is the revised contract.\nPlease look at clause 4.',
  ...over,
});

const fp = (d: EmailDraft, account = ACCOUNT) => fingerprintDraft(account, d);

/* ------------------------------------------------------------------ *
 * 🚨 Every bound field invalidates
 * ------------------------------------------------------------------ */

test('🚨 changing the RECIPIENT invalidates the approval', () => {
  // The whole point. A changed recipient is a different email.
  assert.notEqual(fp(draft()), fp(draft({ to: [{ address: 'someone-else@example.com' }] })));
});

test('🚨 changing the BODY invalidates the approval', () => {
  assert.notEqual(fp(draft()), fp(draft({ body: 'Attached is the revised contract.\nIgnore clause 4.' })));
});

test('changing the subject invalidates the approval', () => {
  assert.notEqual(fp(draft()), fp(draft({ subject: 'URGENT: contract review' })));
});

test('changing the sending ACCOUNT invalidates the approval', () => {
  // Sending as a different identity is a different act, even to the same
  // recipient with the same words.
  assert.notEqual(fp(draft()), fp(draft(), 'other@migrateck.com'));
});

test('adding a cc or bcc invalidates the approval', () => {
  assert.notEqual(fp(draft()), fp(draft({ cc: [{ address: 'boss@example.com' }] })));
  assert.notEqual(fp(draft()), fp(draft({ bcc: [{ address: 'legal@example.com' }] })));
});

test('🚨 MOVING a recipient between fields invalidates the approval', () => {
  /*
   * Field names are in the hashed material for this case. Without them,
   * moving an address from `to` to `bcc` produces identical input — and a
   * visible recipient becoming a hidden one is a materially different email.
   */
  const visible = draft({ to: [{ address: 'a@x.com' }, { address: 'b@x.com' }], cc: [] });
  const hidden = draft({ to: [{ address: 'a@x.com' }], bcc: [{ address: 'b@x.com' }] });
  assert.notEqual(fp(visible), fp(hidden));
});

test('changing the thread target invalidates the approval', () => {
  // A reply grafted onto a different conversation reaches people who were
  // never in the one the user was reading.
  assert.notEqual(fp(draft({ threadId: 't1' })), fp(draft({ threadId: 't2' })));
  assert.notEqual(fp(draft({ inReplyToMessageId: 'm1' })), fp(draft({ inReplyToMessageId: 'm2' })));
  assert.notEqual(fp(draft()), fp(draft({ threadId: 't1' })));
});

/* ------------------------------------------------------------------ *
 * Normalization: narrow on purpose
 * ------------------------------------------------------------------ */

test('trailing whitespace and line endings do NOT invalidate', () => {
  // These change without anyone editing anything; invalidating on them makes
  // approvals fail for a reason no user can see.
  const a = draft({ body: 'Line one\nLine two' });
  const b = draft({ body: 'Line one   \r\nLine two\t\r\n' });
  assert.equal(fp(a), fp(b));
});

test('🚨 normalization does NOT collapse case or internal spacing', () => {
  /*
   * Being lax here means genuinely different messages hash the same, and the
   * entire value of the binding is that a changed message fails to match.
   */
  assert.notEqual(fp(draft({ body: 'send the payment' })), fp(draft({ body: 'Send the payment' })));
  assert.notEqual(fp(draft({ body: 'do not pay' })), fp(draft({ body: 'do  not  pay' })));
  assert.notEqual(fp(draft({ subject: 'urgent' })), fp(draft({ subject: 'URGENT' })));
});

test('address case and ORDER are not properties of the message', () => {
  // A@x.com and a@x.com are one mailbox; recipient order is not meaningful.
  const one = draft({ to: [{ address: 'A@x.com' }, { address: 'b@x.com' }] });
  const two = draft({ to: [{ address: 'b@x.com' }, { address: 'a@X.com' }] });
  assert.equal(fp(one), fp(two));
});

test('a display name is not part of the binding', () => {
  // The mailbox is what receives the message. A different rendering of the
  // same address is not a different recipient.
  assert.equal(
    fp(draft({ to: [{ address: 'james@example.com' }] })),
    fp(draft({ to: [{ address: 'james@example.com', name: 'James Okafor' }] })),
  );
});

test('duplicate recipients collapse', () => {
  assert.equal(
    fp(draft({ to: [{ address: 'a@x.com' }] })),
    fp(draft({ to: [{ address: 'a@x.com' }, { address: 'A@x.com' }] })),
  );
});

test('normalizeBody keeps paragraph structure', () => {
  // Collapsing all blank lines would make two visually different messages —
  // one with paragraphs, one a wall of text — hash the same.
  assert.equal(normalizeBody('a\n\nb'), 'a\n\nb');
  assert.equal(normalizeBody('a\n\n\n\n\nb'), 'a\n\nb');
});

/* ------------------------------------------------------------------ *
 * Idempotency key
 * ------------------------------------------------------------------ */

test('🚨 the same approved message yields the SAME idempotency key', () => {
  /*
   * This is what stops a duplicate approval or a retried request producing two
   * emails. A random key per attempt would make every retry a new operation
   * and defeat the primitive entirely.
   */
  const a = idempotencyKeyFor(bindingFor(ACCOUNT, draft()));
  const b = idempotencyKeyFor(bindingFor(ACCOUNT, draft()));
  assert.equal(a, b);
  assert.match(a, /^email\.send:/);
});

test('a different message yields a different idempotency key', () => {
  const a = idempotencyKeyFor(bindingFor(ACCOUNT, draft()));
  const b = idempotencyKeyFor(bindingFor(ACCOUNT, draft({ to: [{ address: 'other@x.com' }] })));
  assert.notEqual(a, b);
});

/* ------------------------------------------------------------------ *
 * Refusals must say what changed
 * ------------------------------------------------------------------ */

test('a refusal names WHICH fields changed', () => {
  // "This approval is no longer valid" with no reason is indistinguishable
  // from a bug, and the user cannot tell whether to re-approve or investigate.
  const approved = bindingFor(ACCOUNT, draft());
  const current = bindingFor(ACCOUNT, draft({ subject: 'Changed', to: [{ address: 'new@x.com' }] }));
  const changed = changedFields(approved, current);
  assert.deepEqual(changed.sort(), ['subject', 'to']);
});

test('an unchanged message reports no changed fields', () => {
  const approved = bindingFor(ACCOUNT, draft());
  assert.deepEqual(changedFields(approved, bindingFor(ACCOUNT, draft())), []);
});
