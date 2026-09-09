/**
 * ONE VERIFIER, MANY KINDS OF SOURCE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT MUST NOT CHANGE
 *
 * Repository verification is qualified behaviour with its own corpus. A
 * generalisation that quietly altered it would be a regression wearing an
 * architecture's clothes — so a repo-only run must reach the same verdict it
 * always did, and the existing suite is left untouched to prove it.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT MUST NOW WORK
 *
 * An email claim has no line range. It is verified by the SAME rules against a
 * different locator: its whole vocabulary must appear in the message it is
 * anchored to, exactly as a repository claim's must appear in its cited span.
 * There is no email branch that skips a rule.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import { verifyAnswer } from '../src/engine/grounding/claimVerifier.js';
import {
  TypedEvidenceLedger, emailEvidence,
} from '../src/engine/grounding/typedEvidenceLedger.js';

const ALICE = { principalId: 'user:alice', workspaceId: 'personal:alice' };
const BOB = { principalId: 'user:bob', workspaceId: 'personal:bob' };

const REPO_PATH = 'src/rateLimiter.ts';
const REPO_TEXT = [
  'export function throttle(requests: number): boolean {',
  '  return requests <= MAX_PER_MINUTE;',
  '}',
].join('\n');

function repoLedger(): EvidenceLedger {
  const ledger = new EvidenceLedger();
  ledger.notePath(REPO_PATH);
  ledger.recordRead(REPO_PATH, 1, 3, REPO_TEXT);
  return ledger;
}

const mail = (over: Partial<Parameters<typeof emailEvidence>[0]> = {}) => emailEvidence({
  id: 'email_1', scope: ALICE,
  providerMessageId: 'pm-1', providerThreadId: 'pt-1',
  subject: 'Invoice 2026-09', from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z',
  text: 'Your September invoice totals 48273.55 and the breakdown is attached.',
  complete: true,
  ...over,
});

function withMail(...items: ReturnType<typeof mail>[]): TypedEvidenceLedger {
  const ledger = new TypedEvidenceLedger(ALICE);
  for (const item of items) ledger.add(item);
  return ledger;
}

/* ------------------------------------------------------------------ *
 * 1. Repository behaviour is untouched
 * ------------------------------------------------------------------ */

test('🚨 1. a repo-only answer reaches the SAME verdict through the new signature', () => {
  const raw = 'The `throttle` function in `src/rateLimiter.ts` compares requests to MAX_PER_MINUTE.';

  const before = verifyAnswer(raw, repoLedger());
  const after = verifyAnswer(raw, { repo: repoLedger() });

  assert.equal(after.refused, before.refused);
  assert.equal(after.answer, before.answer);
  assert.deepEqual(after.claims.map((c) => c.text), before.claims.map((c) => c.text));
  assert.deepEqual(after.rejected.map((r) => r.reason), before.rejected.map((r) => r.reason));
});

test('a repo-only run is unaffected by an EMPTY typed ledger being present', () => {
  const raw = 'The `throttle` function in `src/rateLimiter.ts` compares requests to MAX_PER_MINUTE.';
  const plain = verifyAnswer(raw, repoLedger());
  const withEmpty = verifyAnswer(raw, { repo: repoLedger(), other: new TypedEvidenceLedger(ALICE) });
  assert.equal(withEmpty.answer, plain.answer);
  assert.equal(withEmpty.refused, plain.refused);
});

/* ------------------------------------------------------------------ *
 * 2 + 3. Email claims live or die by the same rules
 * ------------------------------------------------------------------ */

test('🚨 2. a SUPPORTED email claim survives, cited as a message', () => {
  const raw = 'The September invoice totals 48273.55.';
  const result = verifyAnswer(raw, { repo: new EvidenceLedger(), other: withMail(mail()) });

  assert.equal(result.refused, false, `the claim was refused: ${result.answer}`);
  assert.ok(result.answer.includes('48273.55'), 'the supported claim was removed');

  const cited = result.claims.flatMap((c) => c.otherSources ?? []);
  assert.equal(cited.length, 1);
  assert.equal(cited[0]!.kind, 'email');
  assert.equal(cited[0]!.providerMessageId, 'pm-1');
  assert.match(cited[0]!.cite, /message "Invoice 2026-09" from billing@hetzner\.com/);
});

test('🚨 3. an UNSUPPORTED email claim is removed', () => {
  // Every term must be in the message, exactly as rule 3 demands of a file.
  const raw = 'The September invoice totals 48273.55 and was paid by wire transfer.';
  const result = verifyAnswer(raw, { repo: new EvidenceLedger(), other: withMail(mail()) });

  assert.ok(!result.answer.includes('wire transfer'), 'an unsupported claim survived');
});

test('🚨 3b. a claim about a mailbox with NO evidence at all is refused', () => {
  const raw = 'Your inbox contains nothing from Hetzner this month.';
  const result = verifyAnswer(raw, { repo: new EvidenceLedger(), other: new TypedEvidenceLedger(ALICE) });
  assert.equal(result.refused, true, 'an answer was produced with no evidence of any kind');
});

/* ------------------------------------------------------------------ *
 * 🚨 4. Pre-grounded is not a laundering step
 * ------------------------------------------------------------------ */

test('🚨 4. a pre-grounded summary cannot carry a NEW unsupported claim', () => {
  /*
   * `preGrounded` means the summariser checked its own sources — the TEXT is
   * trustworthy as evidence. It does not license the next sentence to say
   * anything, or "the summariser said so" becomes a way to launder a claim
   * past the gate.
   */
  const summary = mail({
    id: 'email_sum', preGrounded: true,
    text: 'Hetzner sent one invoice in September.',
  });
  const raw = 'Hetzner sent one invoice in September. Hetzner also cancelled the contract.';
  const result = verifyAnswer(raw, { repo: new EvidenceLedger(), other: withMail(summary) });

  assert.ok(result.answer.includes('invoice in September'), 'the grounded sentence was removed');
  assert.ok(!result.answer.includes('cancelled the contract'), 'a pre-grounded source laundered a new claim');
});

/* ------------------------------------------------------------------ *
 * 🚨 5. Mixed evidence in one answer
 * ------------------------------------------------------------------ */

test('🚨 5. repo and email evidence support DIFFERENT claims in one answer', () => {
  const raw = [
    'The `throttle` function in `src/rateLimiter.ts` compares requests to MAX_PER_MINUTE.',
    'The September invoice totals 48273.55.',
  ].join(' ');

  const result = verifyAnswer(raw, { repo: repoLedger(), other: withMail(mail()) });

  assert.equal(result.refused, false, `mixed evidence was refused: ${result.answer}`);
  assert.ok(result.answer.includes('MAX_PER_MINUTE'), 'the repository claim was removed');
  assert.ok(result.answer.includes('48273.55'), 'the email claim was removed');

  // Each claim cites its OWN kind — neither borrows the other's authority.
  const repoCited = result.claims.filter((c) => c.sources.length > 0);
  const mailCited = result.claims.filter((c) => (c.otherSources?.length ?? 0) > 0);
  assert.ok(repoCited.length >= 1, 'no claim was anchored to a file');
  assert.ok(mailCited.length >= 1, 'no claim was anchored to a message');
  assert.equal(repoCited.some((c) => (c.otherSources?.length ?? 0) > 0), false,
    'a repository claim borrowed an email citation');
});

/* ------------------------------------------------------------------ *
 * 🚨 6. Foreign scope refuses the answer
 * ------------------------------------------------------------------ */

test('🚨 6. evidence from another principal REFUSES the answer, it is not filtered out', () => {
  /*
   * Filtering would produce an answer built from fewer sources than it was
   * assembled from, with nothing saying so — and the caller would never learn
   * that another account's evidence had been in the run at all.
   */
  const foreign = new TypedEvidenceLedger(BOB);
  foreign.add(mail({ scope: BOB }));

  const result = verifyAnswer('The September invoice totals 48273.55.', {
    repo: new EvidenceLedger(), other: foreign,
  }, { scope: ALICE });

  assert.equal(result.refused, true);
  assert.match(result.answer, /different account/i);
  assert.equal(result.claims.length, 0);
  assert.ok(!result.answer.includes('48273.55'), 'foreign evidence reached the answer');
});

/* ------------------------------------------------------------------ *
 * 🚨 7. Partiality survives to the answer
 * ------------------------------------------------------------------ */

test('🚨 7. one PREVIEW email source makes the final answer partial', () => {
  const preview = mail({ complete: false });
  const result = verifyAnswer('The September invoice totals 48273.55.', {
    repo: new EvidenceLedger(), other: withMail(preview),
  });

  assert.equal(result.refused, false, `the claim was refused: ${result.answer}`);
  assert.match(result.answer, /based on message previews, not the full messages/,
    'a partial answer did not disclose it');
});

test('a COMPLETE email source adds no caveat it does not have', () => {
  const result = verifyAnswer('The September invoice totals 48273.55.', {
    repo: new EvidenceLedger(), other: withMail(mail()),
  });
  assert.doesNotMatch(result.answer, /message previews/);
});

test('an answer that used NO email evidence does not apologise for it', () => {
  // The partial message is in the ledger but nothing was grounded in it.
  const raw = 'The `throttle` function in `src/rateLimiter.ts` compares requests to MAX_PER_MINUTE.';
  const result = verifyAnswer(raw, {
    repo: repoLedger(), other: withMail(mail({ complete: false })),
  });
  assert.doesNotMatch(result.answer, /message previews/,
    'a repository answer carried a caveat about mail it never used');
});

/* ------------------------------------------------------------------ *
 * 🚨 8 + 9. Fail closed, and match whole tokens
 * ------------------------------------------------------------------ */

test('🚨 8. an unknown evidence kind fails HARD rather than being verified by other rules', () => {
  const ledger = new TypedEvidenceLedger(ALICE);
  const rogue = { ...mail(), kind: 'calendar' } as unknown as ReturnType<typeof mail>;
  ledger.add(rogue);

  assert.throws(
    () => verifyAnswer('The September invoice totals 48273.55.', { repo: new EvidenceLedger(), other: ledger }),
    /no verification adapter/,
    'an unknown kind was silently verified by another kind\'s rules',
  );
});

test('🚨 9. whole-token matching is enforced — a substring is not evidence', () => {
  /*
   * `sendInvoice` in a source file is not evidence for a claim about an invoice
   * that arrived by email. The repo verifier never had this problem because it
   * anchors to a named file first; a mixed ledger has no such protection.
   */
  const codeLedger = new EvidenceLedger();
  codeLedger.notePath('src/mailer.ts');
  codeLedger.recordRead('src/mailer.ts', 1, 2, 'export function sendInvoice(id: string) {}');

  const result = verifyAnswer('The invoice totals 48273.55.', {
    repo: codeLedger,
    other: new TypedEvidenceLedger(ALICE),
  });

  assert.equal(result.refused, true, 'a substring match grounded a claim with no real source');
  assert.ok(!result.answer.includes('48273.55'));
});
