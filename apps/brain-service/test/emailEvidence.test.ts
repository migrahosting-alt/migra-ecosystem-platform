/**
 * EMAIL EVIDENCE — where "this is a preview, not the message" becomes
 * enforceable rather than advisory.
 *
 * The failure: a search returns snippets, something downstream summarises them,
 * and the result reads as a confident account of a long thread written from
 * three lines of it. Nothing in the output says so. A flag that only DOCUMENTS
 * the difference does not prevent that — the summariser has to be unable to
 * make the claim.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  attachmentEvidence,
  messageEvidence,
  statableFacts,
  summariseFrom,
  threadEvidence,
  SNIPPET_LIMITATION,
} from '../src/engine/email/evidence.js';
import {
  bridgeAttachment,
  extensionOf,
  safeAttachmentName,
  type AttachmentPolicy,
} from '../src/engine/email/attachmentBridge.js';
import type { EmailMessage, EmailThread } from '../src/engine/email/types.js';

const message = (over: Partial<EmailMessage> = {}): EmailMessage => ({
  providerMessageId: 'pm1',
  providerThreadId: 'pt1',
  from: { address: 'hetzner@hetzner.com' },
  to: [{ address: 'owner@migrateck.com' }],
  cc: [],
  subject: 'Invoice 2026-09',
  sentAt: '2026-09-05T10:00:00.000Z',
  snippet: 'Your invoice is attached and due on the…',
  bodyComplete: false,
  attachments: [],
  labels: ['INBOX'],
  unread: true,
  retrievedAt: '2026-09-08T12:00:00.000Z',
  ...over,
});

const complete = (over: Partial<EmailMessage> = {}) =>
  message({ bodyComplete: true, textBody: 'The complete body of the message, every word of it.', ...over });

/* ------------------------------------------------------------------ *
 * 🚨 Snippet vs complete
 * ------------------------------------------------------------------ */

test('a search result is evidence of a SNIPPET, and says so', () => {
  const evidence = messageEvidence(message(), 'test');
  assert.equal(evidence.completeness, 'snippet');
  assert.equal(evidence.text, 'Your invoice is attached and due on the…');
});

test('a full read is evidence of a COMPLETE body', () => {
  const evidence = messageEvidence(complete(), 'test');
  assert.equal(evidence.completeness, 'complete');
  assert.match(evidence.text, /every word of it/);
});

test('🚨 completeness is DERIVED, not taken on trust', () => {
  /*
   * A provider that sets bodyComplete without supplying text would otherwise
   * let a snippet through labelled complete — and every downstream disclosure
   * would then be wrong in the confident direction.
   */
  const lying = message({ bodyComplete: true, textBody: undefined });
  assert.equal(messageEvidence(lying, 'test').completeness, 'snippet');

  const alsoLying = message({ bodyComplete: true, textBody: '' });
  assert.equal(messageEvidence(alsoLying, 'test').completeness, 'snippet');
});

test('🚨 ONE snippet makes the WHOLE summary partial', () => {
  /*
   * A reader cannot tell which sentence came from which message, so
   * "mostly complete" is not a claim that can be made honestly here.
   */
  const full = messageEvidence(complete(), 'test');
  const preview = messageEvidence(message({ providerMessageId: 'pm2' }), 'test');
  const result = summariseFrom({ sourceIds: [full.id, preview.id], available: [full, preview] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.evidence.complete, false);
    assert.equal(result.evidence.limitation, SNIPPET_LIMITATION);
  }
});

test('an all-complete summary carries NO limitation', () => {
  // The control. Without it, a test suite would pass against an implementation
  // that always disclosed, which would train users to ignore the disclosure.
  const a = messageEvidence(complete(), 'test');
  const b = messageEvidence(complete({ providerMessageId: 'pm2' }), 'test');
  const result = summariseFrom({ sourceIds: [a.id, b.id], available: [a, b] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.evidence.complete, true);
    assert.equal(result.evidence.limitation, '');
  }
});

/* ------------------------------------------------------------------ *
 * 🚨 Citation
 * ------------------------------------------------------------------ */

test('🚨 a summary citing an unretrieved message is REFUSED', () => {
  const only = messageEvidence(complete(), 'test');
  const result = summariseFrom({ sourceIds: [only.id, 'msg_never_fetched'], available: [only] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'unknown_source');
});

test('🚨 a THREAD summary may not cite a message outside that thread', () => {
  /*
   * The realistic violation: a message from the SEARCH RESULTS — a real
   * message — presented as part of the conversation being summarised. Every id
   * is genuine; the relationship is invented.
   */
  const inThread = messageEvidence(complete(), 'test');
  const elsewhere = messageEvidence(complete({ providerMessageId: 'other', providerThreadId: 'pt9' }), 'test');
  const thread = threadEvidence(
    { providerThreadId: 'pt1', subject: 'Invoice', messages: [] } as unknown as EmailThread,
    [inThread],
  );

  const result = summariseFrom({
    sourceIds: [inThread.id, elsewhere.id],
    available: [inThread, elsewhere],
    thread,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'not_in_thread');
});

test('a thread summary using only its own messages succeeds', () => {
  const a = messageEvidence(complete(), 'test');
  const b = messageEvidence(complete({ providerMessageId: 'pm2' }), 'test');
  const thread = threadEvidence(
    { providerThreadId: 'pt1', subject: 'Invoice', messages: [] } as unknown as EmailThread,
    [a, b],
  );
  const result = summariseFrom({ sourceIds: [a.id, b.id], available: [a, b], thread });
  assert.equal(result.ok, true);
});

test('a summary with no sources is refused', () => {
  const result = summariseFrom({ sourceIds: [], available: [] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'no_sources');
});

test('🚨 statable facts contain only what was retrieved', () => {
  /*
   * Returned as DATA rather than prose so a caller cannot quietly add a
   * sender, a date, or an attachment that no evidence supports.
   */
  const evidence = messageEvidence(message(), 'test');
  const facts = statableFacts(evidence);
  assert.deepEqual(Object.keys(facts).sort(), ['from', 'sentAt', 'subject', 'text', 'textIsComplete']);
  assert.equal(facts.textIsComplete, false);
  assert.equal(facts.from, 'hetzner@hetzner.com');
});

/* ------------------------------------------------------------------ *
 * Attachment provenance and the bridge
 * ------------------------------------------------------------------ */

const POLICY: AttachmentPolicy = { allowedExtensions: ['pdf', 'xlsx', 'csv', 'txt'], maxBytes: 1000 };
const bytes = (n: number) => new Uint8Array(n);

const attEvidence = (over: { filename?: string; mimeType?: string } = {}) =>
  attachmentEvidence(
    {
      providerAttachmentId: 'pa1',
      filename: over.filename ?? 'invoice.pdf',
      mimeType: over.mimeType ?? 'application/pdf',
      sizeBytes: 500,
    },
    messageEvidence(message(), 'test'),
  );

test('🚨 provenance survives into the canonical handoff', () => {
  /*
   * Once bytes enter the file pipeline they look like any other upload — the
   * point, and the risk. A document answering "what does the invoice say" must
   * still be traceable to the message it arrived in.
   */
  const evidence = attEvidence();
  const result = bridgeAttachment({ evidence, bytes: bytes(500), policy: POLICY });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.handoff.provenance.source, 'email');
    assert.equal(result.handoff.provenance.providerMessageId, 'pm1');
    assert.equal(result.handoff.provenance.providerThreadId, 'pt1');
    assert.equal(result.handoff.provenance.messageEvidenceId, evidence.messageId);
  }
});

test('🚨 the bridge PARSES NOTHING — it produces bytes and a name', () => {
  /*
   * An email-specific reader would duplicate the spreadsheet substrate and
   * then diverge from it. The handoff is deliberately the shape of an upload.
   */
  const result = bridgeAttachment({ evidence: attEvidence(), bytes: bytes(500), policy: POLICY });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.deepEqual(
      Object.keys(result.handoff).sort(),
      ['bytes', 'filename', 'mimeType', 'provenance'],
      'the handoff carries something other than a canonical file — a parser is creeping in',
    );
  }
});

test('supported types pass: pdf, xlsx, text', () => {
  for (const [filename, mime] of [
    ['invoice.pdf', 'application/pdf'],
    ['sales.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['notes.txt', 'text/plain'],
  ]) {
    const result = bridgeAttachment({
      evidence: attEvidence({ filename, mimeType: mime }),
      bytes: bytes(100),
      policy: POLICY,
    });
    assert.equal(result.ok, true, `${filename} was refused`);
  }
});

test('an unsupported type is refused by EXTENSION, matching the upload path', () => {
  /*
   * A provider's declared MIME type is a claim by the sender. Judging by a
   * different rule than the upload path is how a file accepted by email gets
   * refused by upload.
   */
  const result = bridgeAttachment({
    evidence: attEvidence({ filename: 'thing.exe', mimeType: 'application/pdf' }),
    bytes: bytes(100),
    policy: POLICY,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'unsupported_type');
});

test('an oversized attachment is refused with the limit named', () => {
  const result = bridgeAttachment({ evidence: attEvidence(), bytes: bytes(5000), policy: POLICY });
  assert.equal(result.ok, false);
  if (!result.ok && result.refusal.kind === 'too_large') {
    assert.equal(result.refusal.limitBytes, 1000);
    assert.equal(result.refusal.actualBytes, 5000);
  } else {
    assert.fail('an oversized attachment was accepted');
  }
});

test('an EMPTY attachment is distinct from a read failure', () => {
  // The provider returned, and there was nothing in it. Different from "we
  // could not fetch it", which is the caller's to report.
  const result = bridgeAttachment({ evidence: attEvidence(), bytes: bytes(0), policy: POLICY });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'empty');
});

test('🚨 a traversal filename cannot escape, structurally', () => {
  // Attachment names come from whoever sent the mail — untrusted by definition.
  assert.equal(safeAttachmentName('../../etc/passwd'), 'etcpasswd');
  assert.equal(safeAttachmentName('..'), '');
  assert.equal(extensionOf('a/b/c.pdf'), 'pdf');
});

test('a nameless attachment is refused rather than given one', () => {
  const result = bridgeAttachment({
    evidence: attEvidence({ filename: '...' }),
    bytes: bytes(100),
    policy: POLICY,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.refusal.kind, 'unreadable_name');
});

test('policy is INJECTED, so there is one source of truth about limits', () => {
  // Restating the upload rules here would create a second authority that
  // drifts — a file accepted by email and refused by upload, or the reverse.
  const strict: AttachmentPolicy = { allowedExtensions: ['txt'], maxBytes: 10 };
  const result = bridgeAttachment({ evidence: attEvidence(), bytes: bytes(5), policy: strict });
  assert.equal(result.ok, false, 'the bridge used its own policy instead of the one supplied');
});
