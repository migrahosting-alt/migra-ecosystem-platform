/**
 * MIXED EVIDENCE — one ledger, one standard, many kinds of source.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE DEFECT THIS REPLACES
 *
 * Evidence WAS a repository span. The grounding gate was built on that shape,
 * so a claim derived from anything else was unverifiable by construction.
 * Measured live: the model read a real mailbox, wrote a true sentence about it,
 * and the verifier removed the sentence because a message has no line numbers.
 *
 * The shortcut — let email answers skip verification because the summariser
 * already returns provenance — would create two standards, and the second
 * spreads to Drive, Calendar and Web the moment they arrive. So the EVIDENCE
 * MODEL generalises and the rules stay shared.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  adapterFor, emailAdapter, repoAdapter, sameScope,
} from '../src/engine/grounding/evidenceTypes.js';
import {
  TypedEvidenceLedger, emailEvidence, repoEvidence,
} from '../src/engine/grounding/typedEvidenceLedger.js';

const ALICE = { principalId: 'user:alice', workspaceId: 'personal:alice' };
const BOB = { principalId: 'user:bob', workspaceId: 'personal:bob' };

const repo = (over: Partial<Parameters<typeof repoEvidence>[0]> = {}) => repoEvidence({
  id: 'repo_1', scope: ALICE, path: 'src/mailer.ts', startLine: 1, endLine: 20,
  text: 'export function sendInvoice(customerId: string) { /* ... */ }',
  ...over,
});

const mail = (over: Partial<Parameters<typeof emailEvidence>[0]> = {}) => emailEvidence({
  id: 'email_1', scope: ALICE,
  providerMessageId: 'pm-1', providerThreadId: 'pt-1',
  subject: 'Invoice 2026-09', from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z',
  text: 'Your September invoice totals 48273.55 and is attached.',
  complete: true,
  ...over,
});

/* ------------------------------------------------------------------ *
 * 🚨 3. Both kinds coexist in one ledger
 * ------------------------------------------------------------------ */

test('🚨 3. repository and email evidence coexist, and both can ground a claim', () => {
  const ledger = new TypedEvidenceLedger(ALICE);
  assert.equal(ledger.add(repo()).ok, true);
  assert.equal(ledger.add(mail()).ok, true);

  assert.deepEqual(ledger.kinds().sort(), ['email', 'repo']);

  // A claim about the code is grounded by the file; a claim about the invoice
  // by the message. Neither borrows the other's authority.
  const code = ledger.candidatesFor('sendInvoice takes a customerId');
  assert.deepEqual(code.map((s: { item: { kind: string } }) => s.item.kind), ['repo']);
  assert.match(code[0]!.cite, /^src\/mailer\.ts:1-20$/);

  const invoice = ledger.candidatesFor('the September invoice totals 48273.55');
  assert.deepEqual(invoice.map((s: { item: { kind: string } }) => s.item.kind), ['email']);
  assert.match(invoice[0]!.cite, /message "Invoice 2026-09" from billing@hetzner\.com/);
});

test('each kind is cited in its OWN vocabulary, not forced into line numbers', () => {
  // A message has no line range, and inventing one would be a false locator.
  assert.equal(repoAdapter.describe(repo()), 'src/mailer.ts:1-20');
  assert.equal(emailAdapter.describe(mail()), 'message "Invoice 2026-09" from billing@hetzner.com');
  assert.equal(
    emailAdapter.describe(mail({ attachmentRef: 'ref-1' })),
    'attachment in "Invoice 2026-09" from billing@hetzner.com',
  );
});

/* ------------------------------------------------------------------ *
 * 🚨 4. An unsupported claim is not grounded
 * ------------------------------------------------------------------ */

test('🚨 4. a claim sharing NOTHING with any source has no candidate at all', () => {
  /*
   * 🚨 THIS LAYER OFFERS CANDIDATES, IT DOES NOT RULE. Whether a claim stands
   * is the shared verifier's decision — keeping that decision here would give
   * every new capability its own grounding standard.
   *
   * What IS guaranteed here: a claim with no vocabulary in common with any
   * retrieved source is handed to the verifier with nothing to stand on.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(mail());

  assert.deepEqual(ledger.candidatesFor('Kubernetes autoscaling was disabled'), []);
  assert.deepEqual(ledger.candidatesFor('the deployment rolled back overnight'), []);

  // A claim made only of stopwords matches nothing, rather than everything.
  assert.deepEqual(ledger.candidatesFor('it has been the one that was'), []);
});

/* ------------------------------------------------------------------ *
 * 🚨 5. Partiality survives the mix
 * ------------------------------------------------------------------ */

test('🚨 5. ONE snippet among complete sources makes the whole answer partial', () => {
  /*
   * A reader cannot tell which sentence came from which source, so "mostly
   * complete" is not a claim that can be made honestly at this granularity.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(mail());
  ledger.add(mail({ id: 'email_2', complete: false, text: 'Your September invoice…' }));

  assert.equal(ledger.complete(), false);
  assert.ok(ledger.limitations().includes('This is based on message previews, not the full messages.'));
});

test('a complete ledger carries no caveat it does not have', () => {
  // A caveat that is not true teaches people to ignore it when it is.
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(mail());
  ledger.add(repo({ complete: true }));
  assert.equal(ledger.complete(), true);
  assert.deepEqual(ledger.limitations(), []);
});

test('the same caveat is stated ONCE however many sources force it', () => {
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(mail({ complete: false }));
  ledger.add(mail({ id: 'email_2', complete: false }));
  ledger.add(mail({ id: 'email_3', complete: false }));
  assert.equal(ledger.limitations().length, 1, 'the same caveat appeared more than once');
});

test('a partial FILE read carries a file-shaped caveat, not an email one', () => {
  // Each kind states its own limitation in its own terms.
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(repo());          // a line range defaults to incomplete
  assert.deepEqual(ledger.limitations(), ['This is based on part of the file, not the whole file.']);
});

/* ------------------------------------------------------------------ *
 * 🚨 9. Scope isolation
 * ------------------------------------------------------------------ */

test('🚨 9. another principal\'s evidence is REFUSED, not silently dropped', () => {
  /*
   * Dropping it would leave an answer citing fewer sources than it was built
   * from, with nothing saying so. Accepting it would let one person's mailbox
   * ground another's answer — the cross-tenant read, reached from a new angle.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  const foreign = ledger.add(mail({ scope: BOB, id: 'email_bob' }));

  assert.equal(foreign.ok, false);
  if (!foreign.ok) assert.equal(foreign.refusal.kind, 'scope_mismatch');
  assert.equal(ledger.isEmpty(), true, 'foreign evidence entered the ledger');
});

test('🚨 9b. the same principal in a DIFFERENT workspace is also refused', () => {
  const ledger = new TypedEvidenceLedger(ALICE);
  const other = ledger.add(mail({ scope: { principalId: ALICE.principalId, workspaceId: 'org:acme' } }));
  assert.equal(other.ok, false);
  assert.equal(ledger.isEmpty(), true);
});

test('🚨 9c. repository evidence is scoped too, not just email', () => {
  // A repo span belongs to whoever retrieved it. Exempting it would leave a
  // path by which one run's retrieval grounds another's answer.
  const ledger = new TypedEvidenceLedger(ALICE);
  assert.equal(ledger.add(repo({ scope: BOB })).ok, false);
  assert.equal(sameScope(ALICE, BOB), false);
  assert.equal(sameScope(ALICE, { ...ALICE }), true);
});

/* ------------------------------------------------------------------ *
 * 🚨 Pre-grounded is not un-verified
 * ------------------------------------------------------------------ */

test('🚨 pre-grounded summariser output is still checked against its own text', () => {
  /*
   * `preGrounded` means the TEXT is trustworthy as evidence — not that an
   * answer quoting it may claim anything. Otherwise "the summariser said so"
   * becomes a laundering step for whatever the model writes next.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(mail({ preGrounded: true, text: 'Hetzner sent one invoice in September.' }));

  assert.deepEqual(ledger.candidatesFor('Hetzner sent an invoice').map((s: { item: { kind: string } }) => s.item.kind), ['email']);
  assert.deepEqual(ledger.candidatesFor('Kubernetes autoscaling was disabled'), [],
    'a pre-grounded source was treated as authorising unrelated claims');
});

test('a preGrounded item still carries its completeness', () => {
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(mail({ preGrounded: true, complete: false }));
  assert.equal(ledger.complete(), false);
  assert.equal(ledger.limitations().length, 1);
});

/* ------------------------------------------------------------------ *
 * 🚨 A new kind cannot be verified by the wrong rules
 * ------------------------------------------------------------------ */

test('🚨 an unknown evidence kind THROWS rather than defaulting to a verifier', () => {
  /*
   * A default adapter would verify a new evidence type with rules written for a
   * different one, and the failure would look like grounding working.
   */
  const rogue = { ...mail(), kind: 'calendar' } as unknown as Parameters<typeof adapterFor>[0];
  assert.throws(() => adapterFor(rogue), /no verification adapter/);
});

test('email attribution accepts header facts a reader can see', () => {
  /*
   * "The invoice came from billing@hetzner.com" is exactly true and appears
   * nowhere in the body. Requiring body-only matches would reject it.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  ledger.add(mail());
  assert.equal(ledger.candidatesFor('it came from billing@hetzner.com').length, 1);
  assert.equal(ledger.candidatesFor('the subject was Invoice 2026-09').length, 1);
});
