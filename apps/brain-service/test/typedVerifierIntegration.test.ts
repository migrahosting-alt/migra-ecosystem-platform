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

/**
 * The answer WITHOUT the gate's explanation of what it removed.
 *
 * 🚨 ASSERTING ON THE WHOLE STRING IS VACUOUS: the removal notice names the
 * terms that failed, so `answer.includes(term)` is TRUE for a claim the gate
 * deleted. This has now bitten twice.
 */
function answerBody(answer: string): string {
  return answer.split('> ⚠️ Grounding gate:')[0]!.trim();
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

/* ------------------------------------------------------------------ *
 * 🚨 Naming a part of a source is not a claim about it
 * ------------------------------------------------------------------ */

test('🚨 11. a true claim that DESCRIBES a message survives', () => {
  /*
   * 🚨 REGRESSION FROM A LIVE FAILURE. Asked who sent an email and what its
   * subject line was, the model answered correctly and the gate deleted the
   * whole sentence — `email`, `sent`, `subject` and `line` are not inside the
   * message. The every-term rule had met a kind of evidence it was not written
   * for: a repository claim quotes identifiers that really are in the code, a
   * message claim mostly DESCRIBES a message.
   */
  const verified = verifyAnswer(
    'The email was sent by billing@hetzner.com, and the subject line is "Invoice 2026-09".',
    { repo: new EvidenceLedger(), other: withMail(mail()) },
  );

  assert.equal(verified.refused, false, `a true description was refused: ${verified.answer}`);
  assert.ok(verified.answer.includes('billing@hetzner.com'), 'the sender claim was removed');
  assert.ok(verified.answer.includes('Invoice 2026-09'), 'the subject claim was removed');
});

test('🚨 11b. and a FALSE claim about the same parts still dies', () => {
  /*
   * The structural words are the vocabulary for POINTING at a part, never a
   * claim about what the part says — which is exactly why permitting them
   * costs no discrimination. The value still has to be there.
   */
  const verified = verifyAnswer(
    'The subject line is "Invoice 9999" and it was sent by payroll@example.com.',
    { repo: new EvidenceLedger(), other: withMail(mail()) },
  );

  assert.equal(verified.answer.includes('9999'), false, 'a fabricated subject survived');
  assert.equal(verified.answer.includes('payroll@example.com'), false, 'a fabricated sender survived');
});

test('🚨 11c. structural vocabulary ALONE grounds nothing', () => {
  /*
   * This is the boundary that makes the permission safe. The words for
   * pointing at a part of a message are no longer required to be inside it —
   * but a sentence built only from them, plus one word that IS a claim, still
   * has to find that word. "Updated" is nowhere in the message.
   *
   * (Repository claims are unaffected for a different reason: a repo span has
   * no sender or subject line, so this vocabulary belongs to a kind they never
   * reach.)
   */
  const verified = verifyAnswer('The message body was updated on Tuesday.', {
    repo: new EvidenceLedger(), other: withMail(mail()),
  });

  assert.equal(verified.answer.includes('updated on Tuesday'), false,
    'a claim made entirely of structural words was grounded');
});

test('🚨 12. a caveat is owed only by the evidence a claim RESTED on', () => {
  /*
   * 🚨 REGRESSION FROM A LIVE ANSWER. A turn listed a message's attachments,
   * opened the spreadsheet, and answered from the COMPLETE workbook — and the
   * answer carried "based on message previews, not the full messages", because
   * the listing item is deliberately incomplete and was still in the ledger.
   * Every figure was exact and the disclosure told the reader to discount them.
   *
   * A false caveat is a false statement, in the direction that looks careful.
   */
  const scope = ALICE;
  const listing = mail({
    id: 'email_listing',
    text: 'regions.xlsx',              // a filename is not contents
    complete: false,
  });
  const opened = sheet();               // the workbook itself, read in full

  const verified = verifyAnswer('South revenue is $156500.', {
    repo: new EvidenceLedger(),
    other: typed(scope, listing, opened),
  });

  assert.ok(verified.answer.includes('156500'), 'the supported claim was removed');
  assert.equal(/previews/i.test(verified.answer), false,
    `a complete source was labelled partial: ${verified.answer}`);
});

test('and the caveat IS attached when the claim rests on the partial item', () => {
  const preview = mail({ id: 'email_preview', text: 'Your September invoice…', complete: false });

  const verified = verifyAnswer('There is a September invoice from billing@hetzner.com.', {
    repo: new EvidenceLedger(), other: typed(ALICE, preview),
  });

  assert.match(verified.answer, /previews/i, 'a preview-sourced claim lost its disclosure');
});

test('🚨 13. naming a file WITHOUT its extension still names that file', () => {
  /*
   * 🚨 REGRESSION FROM OWNER ACCEPTANCE. Tokens are matched exactly, so
   * `migrapilot_email_fixture.pdf` in the evidence did not match a claim
   * saying `migrapilot_email_fixture` — and the gate removed a true sentence
   * about the very document it had just opened and read.
   *
   * The whole name, the stem and the extension all name the same file.
   */
  const doc = sheet({
    id: 'file_named',
    text: 'Sentinel\tMIGRA_EMAIL_SENTINEL_0909',
    locator: { sha256: 'c'.repeat(64), filename: 'migrapilot_email_fixture.pdf', mimeType: 'application/pdf' },
  });

  for (const claim of [
    'MIGRA_EMAIL_SENTINEL_0909 appears in migrapilot_email_fixture.pdf.',
    'MIGRA_EMAIL_SENTINEL_0909 appears in migrapilot_email_fixture.',
    'MIGRA_EMAIL_SENTINEL_0909 appears in the attached pdf.',
  ]) {
    const verified = verifyAnswer(claim, { repo: new EvidenceLedger(), other: typed(ALICE, doc) });
    assert.ok(answerBody(verified.answer).includes('MIGRA_EMAIL_SENTINEL_0909'),
      `a true claim was removed: ${claim}\n${verified.answer}`);
  }

  // And a document that was NOT read still cannot be named.
  const wrong = verifyAnswer('MIGRA_EMAIL_SENTINEL_0909 appears in payroll_export.pdf.', {
    repo: new EvidenceLedger(), other: typed(ALICE, doc),
  });
  assert.equal(answerBody(wrong.answer).includes('payroll_export'), false, 'an unread document was named');

  /*
   * 🚨 AND A TERM THAT IS NOT THERE STILL DIES, which is what makes permitting
   * "appears"/"contains" safe: the verb was never the checkable part.
   */
  const invented = verifyAnswer('MIGRA_EMAIL_SENTINEL_9999 appears in migrapilot_email_fixture.pdf.', {
    repo: new EvidenceLedger(), other: typed(ALICE, doc),
  });
  assert.equal(answerBody(invented.answer).includes('9999'), false, 'a fabricated sentinel survived');
});

/* ------------------------------------------------------------------ *
 * 🚨 14. A grounded summary can carry a body claim — and only as far
 *        as the body its sources actually hold
 * ------------------------------------------------------------------ */

test('🚨 14. a summary of a COMPLETE message can say what the message said', () => {
  /*
   * 🚨 THE OWNER ACCEPTANCE FAILURE, STEP 2. "Summarize that email" refused every
   * single time — and the rule doing it was correct: a summary may support a
   * claim only where one of its own SOURCES does. The sources were the problem.
   * They carried the message's SUBJECT and nothing else, because the summariser
   * dropped the text it had read. So a summary could support nothing about a
   * body, and the most asked-for operation in a mailbox never survived.
   */
  const source = mail({
    id: 'email_src',
    text: 'here s the test files -- 4957 Coconut Creek Pkwy. PHONE: 877-545-5428',
    complete: true,
  });
  const summary = mail({
    id: 'email_sum',
    text: 'The message shares test files and gives a phone number.',
    complete: true,
    preGrounded: true,
  });

  const verified = verifyAnswer('The message shares test files and gives a phone number.', {
    repo: new EvidenceLedger(),
    other: typed(ALICE, source, { ...summary, derivedFrom: [source.id] } as never),
  });

  assert.ok(answerBody(verified.answer).includes('test files'),
    `a summary of a message that was fully read was refused: ${verified.answer}`);
});

test('🚨 14b. and a summary of a PREVIEW still cannot claim the rest of the body', () => {
  /*
   * The limit that makes the above safe. A source read as a preview carries only
   * its preview, so the summary inherits exactly that reach — no more.
   */
  const preview = mail({ id: 'email_prev', text: 'here s the test files…', complete: false });
  const summary = mail({
    id: 'email_sum2',
    text: 'The message gives a phone number of 877-545-5428.',
    complete: false,
    preGrounded: true,
  });

  const verified = verifyAnswer('The message gives a phone number of 877-545-5428.', {
    repo: new EvidenceLedger(),
    other: typed(ALICE, preview, { ...summary, derivedFrom: [preview.id] } as never),
  });

  assert.equal(answerBody(verified.answer).includes('877-545-5428'), false,
    'a summary claimed a detail its preview source never contained');
});

/* ------------------------------------------------------------------ *
 * 🚨 15. An attachment LISTING names its files, and says what it is
 * ------------------------------------------------------------------ */

test('🚨 15. every file in a listing survives, and the list keeps its introduction', () => {
  /*
   * 🚨 OWNER ACCEPTANCE, STEP 3. Asked what attachments a message had, the gate
   * removed the first item and the lead-in and left an answer that began at
   * "2." — because a listing's text IS a filename and only the FILE adapter
   * knew that a name's parts name it, and because `attachment` was in the file
   * vocabulary but not the message one.
   */
  const listing = (filename: string, id: string) => mail({
    id, text: filename, complete: false,
    attachmentRef: `ref-${id}`,
  });
  const ledger = typed(ALICE, listing('migrapilot_email_fixture.pdf', 'email_a'),
    listing('migrapilot_email_fixture (1).xlsx', 'email_b'));

  const verified = verifyAnswer(
    'The email has two attachments:\n\n1. "migrapilot_email_fixture.pdf"\n2. "migrapilot_email_fixture (1).xlsx"',
    { repo: new EvidenceLedger(), other: ledger },
  );

  const body = answerBody(verified.answer);
  assert.ok(body.includes('two attachments'), `the list lost its introduction: ${verified.answer}`);
  assert.ok(body.includes('migrapilot_email_fixture.pdf'), 'the first attachment was removed');
  assert.ok(body.includes('migrapilot_email_fixture (1).xlsx'), 'the second attachment was removed');

  // 🚨 AND A FILE THAT IS NOT THERE STILL DIES.
  const invented = verifyAnswer('The email has one attachment: "migra_test_files_10292020.pdf"', {
    repo: new EvidenceLedger(), other: ledger,
  });
  assert.equal(answerBody(invented.answer).includes('migra_test_files'), false,
    'a fabricated attachment name survived');
});

test('🚨 15b. a listing says it did not OPEN the file, not that it previewed a message', () => {
  const listing = mail({ id: 'email_l', text: 'budget.xlsx', complete: false, attachmentRef: 'ref-1' });

  const verified = verifyAnswer('The email has an attachment: budget.xlsx', {
    repo: new EvidenceLedger(), other: typed(ALICE, listing),
  });
  assert.ok(answerBody(verified.answer).includes('budget.xlsx'),
    `the claim was refused, so no caveat could attach: ${verified.answer}`);

  assert.match(verified.answer, /was not opened/i);
  assert.equal(/message previews/i.test(verified.answer), false,
    'a listing described itself as a message preview');
});

/* ------------------------------------------------------------------ *
 * 🚨 16. A heading whose content was removed goes with it
 * ------------------------------------------------------------------ */

test('🚨 16. an emptied section disappears together with its heading', () => {
  /*
   * 🚨 OWNER ACCEPTANCE, STEP 5. A thread summary came back as a list of bold
   * labels with nothing under most of them — the gate had removed the
   * unsupported lines and left their headings standing. A heading is a promise
   * about what follows; when what followed did not survive, the promise goes
   * too, or the product reads as though it lost the answer rather than declined
   * to invent one.
   */
  const source = mail({ id: 'email_thread', text: 'Fixture Value 1 48273.55', complete: true });
  const raw = [
    '**Sender:**',
    'billing@hetzner.com',
    '**Attachments:**',
    '- invented_report_2019.pdf',
    '**Spreadsheet Values:**',
    '- Fixture Value 1: 48273.55',
  ].join('\n');

  const verified = verifyAnswer(raw, { repo: new EvidenceLedger(), other: typed(ALICE, source) });
  const body = answerBody(verified.answer);

  assert.equal(body.includes('**Attachments:**'), false,
    `an emptied heading survived:\n${body}`);
  assert.equal(body.includes('invented_report_2019'), false, 'the unsupported line survived');
  // Headings that still have content keep it.
  assert.ok(body.includes('**Spreadsheet Values:**'), 'a populated heading was removed');
  assert.ok(body.includes('48273.55'), 'supported content was removed');
});

test('🚨 16b. a dangling list marker left by a removal is not rendered', () => {
  // "1." with its item gone reads as a numbering fault, not as an answer.
  const source = mail({ id: 'email_m', text: 'the September invoice', complete: true });
  const raw = ['1.', '2. The September invoice arrived.'].join('\n');

  const verified = verifyAnswer(raw, { repo: new EvidenceLedger(), other: typed(ALICE, source) });
  const body = answerBody(verified.answer);

  assert.equal(/^1\.\s*$/m.test(body), false, `a bare list marker survived:\n${body}`);
});
