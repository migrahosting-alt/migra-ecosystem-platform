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
import type { EvidenceItem, EvidenceScope, FileEvidence } from '../src/engine/grounding/evidenceTypes.js';

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

/**
 * A spreadsheet that arrived as an attachment and went through the canonical
 * file pipeline. Its text is what the workbook reader produced.
 */
const sheet = (over: Partial<FileEvidence> = {}): FileEvidence => ({
  kind: 'file',
  id: 'file_1',
  scope: ALICE,
  text: '## Sales\nRegion\tRevenue\nSouth\t$156500\nNorth\t$100000',
  complete: true,
  locator: { sha256: 'a'.repeat(64), filename: 'regions.xlsx', mimeType: 'application/vnd.ms-excel' },
  origin: {
    source: 'email-attachment',
    providerMessageId: 'pm-1', providerThreadId: 'pt-1', attachmentRef: 'ref-abc',
  },
  ...over,
});

function withMail(...items: ReturnType<typeof mail>[]): TypedEvidenceLedger {
  const ledger = new TypedEvidenceLedger(ALICE);
  for (const item of items) ledger.add(item);
  return ledger;
}

function typed(scope: EvidenceScope, ...items: EvidenceItem[]): TypedEvidenceLedger {
  const ledger = new TypedEvidenceLedger(scope);
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
  // The handle a reader follows; for email evidence that is the message id.
  assert.equal(cited[0]!.locator, 'pm-1');
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

/* ------------------------------------------------------------------ *
 * 🚨 A wrong citation is a hard failure, not something to rescue
 * ------------------------------------------------------------------ */

test('🚨 non-repo evidence must NEVER rescue a claim whose own CITATION is wrong', () => {
  /*
   * When the model CITES a file and the citation does not support the sentence,
   * that is a wrong reference. Grounding it from a message instead would have
   * the gate quietly correcting the model's citations, and a confident wrong
   * answer would survive with a source that has nothing to do with it.
   *
   * 🚨 WHAT ACTUALLY ENFORCES THIS, stated precisely because I first assumed
   * otherwise: the cited PATH is one of the claim's terms, and the fallback
   * requires every term to appear in one non-repo source. A message never
   * contains a repository path, so a cited sentence can never be rescued.
   *
   * The `anchor === 'derived'` guard in the verifier is belt-and-braces on top
   * of that — removing it does not break this test, and saying so here is
   * better than implying a mutation would catch it.
   */
  const repo = repoLedger();

  // The sentence cites the rate limiter, but says something only the MESSAGE
  // could support. The citation is wrong; the email must not paper over it.
  const raw = 'In `src/rateLimiter.ts:1-3` the September invoice totals 48273.55.';
  const result = verifyAnswer(raw, { repo, other: withMail(mail()) });

  const rescued = result.claims.filter((c) => (c.otherSources?.length ?? 0) > 0);
  assert.equal(rescued.length, 0, 'a wrong citation was rescued by unrelated email evidence');
  assert.ok(!result.answer.includes('48273.55'), 'the wrongly-cited claim survived');
});

test('the same sentence WITHOUT a citation is grounded by the message', () => {
  // The control: it is the wrongness of the CITATION that blocks the fallback,
  // not the sentence being about mail.
  const result = verifyAnswer('The September invoice totals 48273.55.', {
    repo: repoLedger(), other: withMail(mail()),
  });
  assert.equal(result.claims.some((c) => (c.otherSources?.length ?? 0) > 0), true);
});

/* ------------------------------------------------------------------ *
 * 🚨 CASE 9 — THREE KINDS IN ONE LEDGER
 *
 * The two-kind matrix above proved the rules are shared between repo and
 * email. A third kind is where a design either holds or turns out to have been
 * a special case: the file adapter must earn its claims the same way, and
 * neither of the other two may lend it support it has not earned.
 * ------------------------------------------------------------------ */

test('🚨 9a. repo, email and FILE evidence each carry their own claim in one answer', () => {
  const answer = [
    'The throttle function in src/rateLimiter.ts:1-3 returns requests <= MAX_PER_MINUTE.',
    'The September invoice from billing@hetzner.com totals 48273.55.',
    'South revenue is $156500.',
  ].join(' ');

  const verified = verifyAnswer(answer, {
    repo: repoLedger(),
    other: typed(ALICE, mail(), sheet()),
  });

  assert.equal(verified.refused, false, `everything was removed: ${verified.answer}`);
  assert.ok(verified.answer.includes('MAX_PER_MINUTE'), 'the repository claim was removed');
  assert.ok(verified.answer.includes('48273.55'), 'the message claim was removed');
  assert.ok(verified.answer.includes('156500'), 'the spreadsheet claim was removed');

  // 🚨 Each claim cited to the source that actually carries it.
  const kinds = verified.claims.flatMap((c) => (c.otherSources ?? []).map((o) => o.kind));
  assert.deepEqual([...new Set(kinds)].sort(), ['email', 'file']);
  assert.ok(verified.claims.some((c) => c.sources.some((src) => src.path === REPO_PATH)),
    'the repository claim was not anchored to its file');
});

test('🚨 9b. an unsupported claim is removed even while its NEIGHBOURS are supported', () => {
  const answer = [
    'South revenue is $156500.',
    'West revenue is $61250.',
  ].join(' ');

  const verified = verifyAnswer(answer, { repo: repoLedger(), other: typed(ALICE, mail(), sheet()) });

  // The sheet fixture holds South and North. West is a real-looking number that
  // is nowhere in any of the three sources.
  assert.ok(verified.answer.includes('156500'), 'a supported claim was removed with the unsupported one');
  assert.equal(verified.answer.includes('61250'), false, 'a value in none of the sources survived');
});

test('🚨 9c. NO CROSS-TYPE RESCUE — a claim must be carried by ONE source, whole', () => {
  /*
   * Every term of this sentence appears SOMEWHERE: "invoice" and "48273.55" in
   * the message, "revenue" and "$156500" in the spreadsheet. No single source
   * carries all of them.
   *
   * 🚨 A UNION OF SOURCES IS NOT A SOURCE. Grounding a sentence against the
   * pooled vocabulary of everything retrieved is how a fabricated connection
   * between two real documents survives — the most convincing kind of wrong
   * answer, because every piece of it checks out separately.
   */
  const answer = 'The invoice totalling 48273.55 explains the $156500 revenue.';

  const verified = verifyAnswer(answer, { repo: new EvidenceLedger(), other: typed(ALICE, mail(), sheet()) });

  assert.equal(verified.answer.includes('48273.55'), false,
    'a claim spanning two sources was grounded by neither of them alone');
});

test('🚨 9d. a WRONG repository citation is not rescued by a file that shares its words', () => {
  /*
   * The sentence cites a span that does not support it — the cited code says
   * nothing about ceilings or quarters. A file happens to contain every word of
   * it, including the number.
   *
   * 🚨 IT MUST STILL BE REMOVED. A wrong citation is a wrong reference, and a
   * gate that re-attributed it to whatever else matched would be silently
   * correcting the model instead of catching it — leaving a confident sentence
   * on screen pointing at the wrong place.
   */
  const ceiling = sheet({
    id: 'file_ceiling',
    text: 'The quarterly ceiling is $156500.',
  });
  const cited = 'The quarterly ceiling described in src/rateLimiter.ts:1-3 is $156500.';

  const wrongCitation = verifyAnswer(cited, { repo: repoLedger(), other: typed(ALICE, ceiling) });
  assert.equal(wrongCitation.answer.includes('156500'), false,
    'a wrong repository citation was rescued by a file');

  /*
   * And the same sentence WITHOUT the citation is grounded by that same file —
   * which is what proves the removal above came from the citation guard and not
   * from the evidence simply being unusable.
   */
  const uncited = verifyAnswer('The quarterly ceiling is $156500.', {
    repo: repoLedger(), other: typed(ALICE, ceiling),
  });
  assert.ok(uncited.answer.includes('156500'), 'the file could not ground the claim at all');
  assert.equal(uncited.claims[0]?.otherSources?.[0]?.kind, 'file');
});

test('🚨 9e. FILE evidence from another principal REFUSES the answer', () => {
  /*
   * Not filtered out — refused. A ledger holding someone else's evidence is a
   * wiring fault, and quietly dropping the item would let the run continue and
   * produce a confident answer built from whatever was left.
   */
  const verified = verifyAnswer('South revenue is $156500.', {
    repo: new EvidenceLedger(),
    other: typed(BOB, sheet({ scope: BOB })),
  }, { scope: ALICE });

  assert.equal(verified.refused, true, 'another principal\'s file evidence answered a question');
});

test('🚨 9f. a TRUNCATED spreadsheet makes the answer say so', () => {
  const verified = verifyAnswer('South revenue is $156500.', {
    repo: new EvidenceLedger(),
    other: typed(ALICE, sheet({ complete: false })),
  });

  assert.equal(verified.refused, false, `the claim was removed: ${verified.answer}`);
  // "The spreadsheet lists three suppliers" is a different sentence when there
  // were four and the reader stopped at three.
  assert.match(verified.answer, /part of the file/i);
});

test('🚨 9g. a summary of a FILE may not outrank the file — derivedFrom is not email-only', () => {
  /*
   * `derivedFrom` lived on email evidence while email was the only kind that
   * summarised. It is on the common base now, and this is what that has to
   * mean: a summary item claiming something ITS OWN SOURCE does not say is
   * still laundering, whatever kind it is.
   */
  const source = sheet();
  const summary = sheet({
    id: 'file_summary',
    text: 'South revenue is $156500 and West revenue is $61250.',
    preGrounded: true,
    derivedFrom: [source.id],
  });

  const verified = verifyAnswer('West revenue is $61250.', {
    repo: new EvidenceLedger(),
    other: typed(ALICE, source, summary),
  });

  assert.equal(verified.answer.includes('61250'), false,
    'a summary supported a claim its own source does not');
});

test('🚨 9h. naming the FILE is part of quoting it', () => {
  /*
   * "South revenue in regions.xlsx is $156500" says two things, and only one of
   * them is inside the bytes. If the filename were not part of what the file
   * can be quoted on, the sentence identifying WHICH document was read — the
   * one a reader most needs — would be the sentence the gate removes.
   */
  const verified = verifyAnswer('South revenue in regions.xlsx is $156500.', {
    repo: new EvidenceLedger(),
    other: typed(ALICE, sheet()),
  });

  assert.ok(verified.answer.includes('regions.xlsx'),
    'a claim naming the file it read was removed as unsupported');

  // And a file it did NOT read still cannot be named.
  const wrong = verifyAnswer('South revenue in budget.xlsx is $156500.', {
    repo: new EvidenceLedger(),
    other: typed(ALICE, sheet()),
  });
  assert.equal(wrong.answer.includes('budget.xlsx'), false,
    'a claim named a document that was never retrieved');
});
