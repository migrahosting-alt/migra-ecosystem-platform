/**
 * MAILBOX RESULTS → LEDGER EVIDENCE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE ONLY DOOR INTO THE LEDGER
 *
 * Every `migra.email` result becomes evidence here, and nothing may enter the
 * ledger without a SCOPE and a canonical id. A tool result that slipped in
 * without them would be evidence nobody owns — and the ledger's whole defence
 * against grounding one person's answer in another's mail is that ownership is
 * recorded on the item rather than assumed from context.
 *
 * ---------------------------------------------------------------------------
 * 🚨 COMPLETENESS IS READ FROM THE RESULT, NEVER ASSUMED
 *
 * A search returns previews; a read returns a body. Those are different facts
 * and the capability already reports which — `bodyComplete` for the text and
 * `attachmentsKnown` for the MIME tree, deliberately independent because a
 * message whose tree we inspected can still have a body we could not decode.
 * Collapsing them here would undo the distinction at the last step.
 */

import type { EmailEvidence } from '../grounding/evidenceTypes.js';
import { emailEvidence } from '../grounding/typedEvidenceLedger.js';
import type { EvidenceScope } from '../grounding/evidenceTypes.js';
import type { EmailMessage, EmailThread } from './types.js';

/** Mints ids that are stable within one run and unique across kinds. */
export interface EvidenceIdSource {
  nextId(kind: 'email'): string;
}

/**
 * What a message contributes as text.
 *
 * The full body when we have one, the snippet when we do not — never both, and
 * never a snippet presented as a body. `bodyComplete` is what decides.
 */
function textOf(message: EmailMessage): { text: string; complete: boolean } {
  return message.bodyComplete && typeof message.textBody === 'string' && message.textBody.length > 0
    ? { text: message.textBody, complete: true }
    : { text: message.snippet, complete: false };
}

function fromMessage(
  message: EmailMessage,
  scope: EvidenceScope,
  ids: EvidenceIdSource,
): EmailEvidence {
  const { text, complete } = textOf(message);
  return emailEvidence({
    id: ids.nextId('email'),
    scope,
    providerMessageId: message.providerMessageId,
    providerThreadId: message.providerThreadId,
    subject: message.subject,
    from: message.from.address,
    sentAt: message.sentAt,
    text,
    complete,
  });
}

/**
 * Search results.
 *
 * 🚨 ALWAYS PARTIAL. A search asks the provider for metadata, so every item is
 * a preview whatever it looks like — and an answer drawn from previews has to
 * say so. Marking these complete would delete that disclosure at its source.
 */
export function evidenceFromSearch(
  messages: readonly EmailMessage[],
  scope: EvidenceScope,
  ids: EvidenceIdSource,
): EmailEvidence[] {
  return messages.map((m) => ({ ...fromMessage(m, scope, ids), complete: false }));
}

/** One message, read in full. Complete only when a real body came back. */
export function evidenceFromMessage(
  message: EmailMessage,
  scope: EvidenceScope,
  ids: EvidenceIdSource,
): EmailEvidence {
  return fromMessage(message, scope, ids);
}

/**
 * A thread: one item per message, each carrying its own completeness.
 *
 * Not one item for the conversation. A thread is not a document — a reader
 * needs to know WHICH message said a thing, and a merged blob would let a claim
 * cite "the thread" while resting on a preview inside it.
 */
export function evidenceFromThread(
  thread: EmailThread,
  scope: EvidenceScope,
  ids: EvidenceIdSource,
): EmailEvidence[] {
  return thread.messages.map((m) => fromMessage(m, scope, ids));
}

/**
 * An attachment that was fetched and handed to the canonical file pipeline.
 *
 * 🚨 THE STABLE REF IS THE IDENTITY. The provider's own attachment id is
 * regenerated on every read, so recording it as durable identity would produce
 * provenance that names nothing an hour later.
 *
 * The text is what the pipeline extracted, when it extracted anything. Absent
 * extraction the item is deliberately INCOMPLETE and carries only what the
 * listing knew — a filename is not the contents, and an answer resting on one
 * must not read as though the file had been opened.
 */
export function evidenceFromAttachment(
  input: {
    providerMessageId: string;
    providerThreadId: string;
    attachmentRef: string;
    filename: string;
    subject: string;
    from: string;
    sentAt: string;
    /** Extracted text, when the canonical pipeline produced any. */
    extractedText?: string;
  },
  scope: EvidenceScope,
  ids: EvidenceIdSource,
): EmailEvidence {
  const extracted = typeof input.extractedText === 'string' && input.extractedText.length > 0;
  return emailEvidence({
    id: ids.nextId('email'),
    scope,
    providerMessageId: input.providerMessageId,
    providerThreadId: input.providerThreadId,
    attachmentRef: input.attachmentRef,
    subject: input.subject,
    from: input.from,
    sentAt: input.sentAt,
    text: extracted ? input.extractedText! : input.filename,
    complete: extracted,
  });
}

/**
 * A grounded summary, WITH the messages it was built from.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE SOURCES ARE NOT OPTIONAL
 *
 * Returning the summary alone would leave provenance untraceable and — worse —
 * make the summary a source in its own right. Prose is confident in a way its
 * inputs may not have been: a summary of two previews reads exactly like a
 * summary of two full messages.
 *
 * So the sources go in beside it and the summary records `derivedFrom`, which
 * is what stops it supporting more than they do.
 *
 * ---------------------------------------------------------------------------
 * 🚨 COMPLETENESS IS INHERITED, NOT REPORTED
 *
 * The summariser's own `complete` flag is a claim about its sources; the
 * sources are the fact. One preview among them makes the summary partial,
 * whatever the flag says.
 */
export function evidenceFromSummary(
  input: {
    summary: string;
    sources: ReadonlyArray<{
      providerMessageId: string;
      providerThreadId: string;
      subject: string;
      from: string;
      sentAt: string;
      completeness: 'complete' | 'snippet';
    }>;
  },
  scope: EvidenceScope,
  ids: EvidenceIdSource,
): EmailEvidence[] {
  const sources = input.sources.map((s) => emailEvidence({
    id: ids.nextId('email'),
    scope,
    providerMessageId: s.providerMessageId,
    providerThreadId: s.providerThreadId,
    subject: s.subject,
    from: s.from,
    sentAt: s.sentAt,
    /*
     * 🚨 HEADER FACTS ONLY, AND THAT IS A REAL LIMIT.
     *
     * The summarise result reports each source's sender, subject, date and
     * completeness — not its text. So a summary grounds claims about WHO sent
     * WHAT and WHEN, and not about what a body said. Putting the summary's own
     * prose here instead would make the summary its own source, which is the
     * laundering `derivedFrom` exists to stop.
     *
     * A body claim becomes groundable by READING the message, which is the
     * correct order anyway.
     */
    text: s.subject,
    complete: s.completeness === 'complete',
  }));

  const first = input.sources[0];
  const summary = emailEvidence({
    id: ids.nextId('email'),
    scope,
    providerMessageId: first?.providerMessageId ?? '',
    providerThreadId: first?.providerThreadId ?? '',
    subject: first?.subject ?? '',
    from: first?.from ?? '',
    sentAt: first?.sentAt ?? '',
    text: input.summary,
    // Derived from the SOURCES, never copied from the summariser's flag.
    complete: sources.every((s) => s.complete),
    preGrounded: true,
  });

  return [...sources, { ...summary, derivedFrom: sources.map((s) => s.id) }];
}
