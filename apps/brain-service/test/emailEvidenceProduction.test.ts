/**
 * MAILBOX RESULTS BECOME EVIDENCE — with their completeness and their owner.
 *
 * 🚨 The distinctions that must survive the conversion, because each of them
 * was a defect once:
 *
 *   · a search preview must not become a "complete" source
 *   · `attachmentsKnown` must stay independent of body completeness
 *   · a summary must not outrank the messages it came from
 *   · nothing enters the ledger without a scope and a canonical id
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evidenceFromAttachment, evidenceFromMessage, evidenceFromSearch,
  evidenceFromSummary, evidenceFromThread,
} from '../src/engine/email/emailEvidenceProduction.js';
import { TypedEvidenceLedger } from '../src/engine/grounding/typedEvidenceLedger.js';
import { verifyAnswer } from '../src/engine/grounding/claimVerifier.js';
import { EvidenceLedger } from '../src/engine/grounding/evidenceLedger.js';
import type { EmailMessage } from '../src/engine/email/types.js';

const ALICE = { principalId: 'user:alice', workspaceId: 'personal:alice' };
const ids = () => {
  let n = 0;
  return { nextId: (kind: 'email') => `${kind}_${++n}` };
};

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  providerMessageId: 'pm-1',
  providerThreadId: 'pt-1',
  from: { address: 'billing@hetzner.com' },
  to: [], cc: [],
  subject: 'Invoice 2026-09',
  sentAt: '2026-09-01T10:00:00Z',
  snippet: 'Your September invoice is ready…',
  textBody: 'Your September invoice totals 48273.55 and the breakdown is attached.',
  bodyComplete: true,
  attachmentsKnown: true,
  attachments: [],
  labels: ['INBOX'],
  unread: false,
  retrievedAt: '2026-09-09T00:00:00Z',
  ...over,
});

/* ------------------------------------------------------------------ *
 * 🚨 Completeness travels
 * ------------------------------------------------------------------ */

test('🚨 a SEARCH result is always partial, even when the message object looks complete', () => {
  /*
   * Search asks the provider for metadata, so every result is a preview
   * whatever it looks like. Marking these complete would delete the partiality
   * disclosure at its source.
   */
  const [item] = evidenceFromSearch([message()], ALICE, ids());
  assert.equal(item!.complete, false, 'a search preview claimed to be a complete source');
  assert.equal(item!.kind, 'email');
});

test('a full READ is complete only when a real body came back', () => {
  const full = evidenceFromMessage(message(), ALICE, ids());
  assert.equal(full.complete, true);
  assert.match(full.text, /48273\.55/);

  // No body: the snippet is the text, and it is NOT complete.
  const bodiless = evidenceFromMessage(
    message({ bodyComplete: false, textBody: undefined }), ALICE, ids(),
  );
  assert.equal(bodiless.complete, false);
  assert.equal(bodiless.text, 'Your September invoice is ready…');
});

test('🚨 attachmentsKnown is INDEPENDENT of body completeness', () => {
  /*
   * A message whose MIME tree we inspected can still have a body we could not
   * decode. One flag cannot express both, which is why there are two — and the
   * conversion must not collapse them.
   */
  const treeKnownBodyNot = message({
    bodyComplete: false, textBody: undefined, attachmentsKnown: true,
  });
  const item = evidenceFromMessage(treeKnownBodyNot, ALICE, ids());
  assert.equal(item.complete, false, 'body completeness was taken from the attachment flag');
  assert.equal(treeKnownBodyNot.attachmentsKnown, true, 'the source flag was mutated');
});

test('a THREAD yields one item per message, each with its own completeness', () => {
  /*
   * Not one item for the conversation: a reader needs to know WHICH message
   * said a thing, and a merged blob would let a claim cite "the thread" while
   * resting on a preview inside it.
   */
  const items = evidenceFromThread({
    providerThreadId: 'pt-1',
    subject: 'Invoice 2026-09',
    messages: [message(), message({ providerMessageId: 'pm-2', bodyComplete: false, textBody: undefined })],
  }, ALICE, ids());

  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.complete), [true, false]);
  assert.deepEqual([...new Set(items.map((i) => i.locator.providerThreadId))], ['pt-1']);
  assert.deepEqual(items.map((i) => i.locator.providerMessageId), ['pm-1', 'pm-2']);
});

/* ------------------------------------------------------------------ *
 * 🚨 Attachments carry the stable ref, never the provider id
 * ------------------------------------------------------------------ */

test('🚨 an attachment is identified by OUR ref, and is incomplete until extracted', () => {
  const listed = evidenceFromAttachment({
    providerMessageId: 'pm-1', providerThreadId: 'pt-1',
    attachmentRef: 'ref-abc123', filename: 'invoice.xlsx',
    subject: 'Invoice 2026-09', from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z',
  }, ALICE, ids());

  assert.equal(listed.locator.attachmentRef, 'ref-abc123');
  // A filename is not the contents. An answer resting on this must not read as
  // though the file had been opened.
  assert.equal(listed.complete, false);
  assert.equal(listed.text, 'invoice.xlsx');

  const extracted = evidenceFromAttachment({
    providerMessageId: 'pm-1', providerThreadId: 'pt-1',
    attachmentRef: 'ref-abc123', filename: 'invoice.xlsx',
    subject: 'Invoice 2026-09', from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z',
    extractedText: 'Total 48273.55 | Tax 7319.42 | Net 91504.08',
  }, ALICE, ids());
  assert.equal(extracted.complete, true);
  assert.match(extracted.text, /91504\.08/);
});

/* ------------------------------------------------------------------ *
 * 🚨 A summary may not outrank its sources
 * ------------------------------------------------------------------ */

test('🚨 a summary is emitted WITH its sources, and is marked derived', () => {
  const items = evidenceFromSummary({
    summary: 'Hetzner sent one invoice in September.',
    sources: [{
      providerMessageId: 'pm-1', providerThreadId: 'pt-1', subject: 'Invoice 2026-09',
      from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z', completeness: 'complete',
    }],
  }, ALICE, ids());

  assert.equal(items.length, 2, 'the summary arrived without its sources');
  const summary = items.at(-1)!;
  assert.equal(summary.preGrounded, true);
  assert.deepEqual([...(summary.derivedFrom ?? [])], [items[0]!.id]);
});

test('🚨 a summary of PREVIEWS is partial, whatever the summariser reported', () => {
  /*
   * The summariser's own flag is a claim about its sources; the sources are the
   * fact. A summary of two previews reads exactly like a summary of two full
   * messages, and that is the whole danger.
   */
  const items = evidenceFromSummary({
    summary: 'Two messages about invoices.',
    sources: [
      { providerMessageId: 'pm-1', providerThreadId: 'pt-1', subject: 'A', from: 'a@x.com', sentAt: 'T', completeness: 'complete' },
      { providerMessageId: 'pm-2', providerThreadId: 'pt-1', subject: 'B', from: 'b@x.com', sentAt: 'T', completeness: 'snippet' },
    ],
  }, ALICE, ids());

  assert.equal(items.at(-1)!.complete, false, 'a summary over a preview claimed completeness');
});

test('🚨 a summary cannot support a claim its SOURCES do not', () => {
  /*
   * The invariant with teeth. The summary text mentions a figure; no source
   * does. Without the derived-from check the summary would ground it, and
   * summarising would become a way to launder a claim past the gate.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  for (const item of evidenceFromSummary({
    summary: 'The invoice totals 48273.55 and was paid in October.',
    sources: [{
      providerMessageId: 'pm-1', providerThreadId: 'pt-1', subject: 'Invoice 2026-09',
      from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z', completeness: 'complete',
    }],
  }, ALICE, ids())) ledger.add(item);

  const result = verifyAnswer('The invoice totals 48273.55 and was paid in October.', {
    repo: new EvidenceLedger(), other: ledger,
  });

  // The source item holds only the subject — it cannot carry the figure.
  assert.ok(!result.answer.includes('48273.55'),
    'a summary grounded a claim none of its sources support');
});

test('a summary CAN support what its sources support', () => {
  /*
   * The control: the constraint is on EXCEEDING the sources, not on summaries.
   *
   * 🚨 AND IT SHOWS WHAT A SUMMARY'S SOURCES ACTUALLY HOLD. The summarise result
   * returns header facts and completeness per source, not message text — so a
   * summary grounds claims about subjects, senders and dates, and NOT about
   * body content. That is a real limit, and it is the honest one: the run never
   * retrieved those bodies through this path, so nothing here should read as
   * though it had.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  for (const item of evidenceFromSummary({
    summary: 'Invoice 2026-09 came from billing@hetzner.com.',
    sources: [{
      providerMessageId: 'pm-1', providerThreadId: 'pt-1', subject: 'Invoice 2026-09',
      from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z', completeness: 'complete',
    }],
  }, ALICE, ids())) ledger.add(item);

  const result = verifyAnswer('Invoice 2026-09 from billing@hetzner.com.', {
    repo: new EvidenceLedger(), other: ledger,
  });
  assert.equal(result.refused, false, `a supported summary claim was refused: ${result.answer}`);
});

test('🚨 a summary cannot ground a claim about BODY content its sources never carried', () => {
  /*
   * Stated as a test rather than left implicit, because it is the limit a
   * reader most needs to know: summarising does not retrieve bodies, so a
   * summary alone cannot support what a body said. Reading the message first is
   * what makes such a claim groundable — and that is the correct order anyway.
   */
  const ledger = new TypedEvidenceLedger(ALICE);
  for (const item of evidenceFromSummary({
    summary: 'The invoice totals 48273.55.',
    sources: [{
      providerMessageId: 'pm-1', providerThreadId: 'pt-1', subject: 'Invoice 2026-09',
      from: 'billing@hetzner.com', sentAt: '2026-09-01T10:00:00Z', completeness: 'complete',
    }],
  }, ALICE, ids())) ledger.add(item);

  const result = verifyAnswer('The invoice totals 48273.55.', {
    repo: new EvidenceLedger(), other: ledger,
  });
  assert.ok(!result.answer.includes('48273.55'),
    'a summary grounded a body figure its sources never held');
});

/* ------------------------------------------------------------------ *
 * 🚨 Nothing enters unowned
 * ------------------------------------------------------------------ */

test('🚨 every produced item carries the caller\'s scope and a canonical id', () => {
  const mint = ids();
  const produced = [
    ...evidenceFromSearch([message()], ALICE, mint),
    evidenceFromMessage(message(), ALICE, mint),
    ...evidenceFromThread({ providerThreadId: 'pt-1', subject: 's', messages: [message()] }, ALICE, mint),
    evidenceFromAttachment({
      providerMessageId: 'pm-1', providerThreadId: 'pt-1', attachmentRef: 'r',
      filename: 'f.pdf', subject: 's', from: 'a@x.com', sentAt: 'T',
    }, ALICE, mint),
    ...evidenceFromSummary({
      summary: 'x',
      sources: [{ providerMessageId: 'pm-1', providerThreadId: 'pt-1', subject: 's', from: 'a@x.com', sentAt: 'T', completeness: 'complete' }],
    }, ALICE, mint),
  ];

  for (const item of produced) {
    assert.deepEqual(item.scope, ALICE, 'an item entered without its owner');
    assert.match(item.id, /^email_\d+$/, 'an item entered without a canonical id');
    assert.ok(item.locator.providerMessageId !== undefined);
  }
  // Ids are unique — two items sharing one would make provenance ambiguous.
  assert.equal(new Set(produced.map((i) => i.id)).size, produced.length);
});

test('🚨 a foreign-scoped produced item is still refused by the ledger', () => {
  // Production stamps the scope it is given; the ledger is the second gate.
  const ledger = new TypedEvidenceLedger(ALICE);
  const [bobs] = evidenceFromSearch([message()], { principalId: 'user:bob', workspaceId: 'personal:bob' }, ids());
  assert.equal(ledger.add(bobs!).ok, false);
});
