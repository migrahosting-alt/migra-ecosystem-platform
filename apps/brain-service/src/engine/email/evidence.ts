/**
 * EMAIL EVIDENCE — and the rule that a preview cannot be summarised as a message.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY `bodyComplete` IS ENFORCED HERE RATHER THAN TRUSTED
 *
 * A search returns snippets. Somebody, somewhere downstream, will pass those
 * to a summariser — not maliciously, but because a message object with a
 * `snippet` field looks like a message. The result reads as a confident
 * account of a long thread written from three lines of it, and nothing in the
 * output says so.
 *
 * A flag that only DOCUMENTS the difference does not prevent that. So the
 * summariser cannot be handed evidence without also being told what kind it
 * is: `summariseFrom` refuses to describe a snippet-derived set as complete,
 * and the disclosure is part of the returned value rather than something a
 * caller may forget to add.
 *
 * ---------------------------------------------------------------------------
 * THE CITATION RULE, SAME AS SEARCH
 *
 * A summary may only reference messages that were actually retrieved. The
 * realistic violation is not invention: it is a thread summary that mentions a
 * message from the SEARCH RESULTS which is not in the thread that was read.
 * Both are real messages. The linkage is fiction.
 */

import type { EmailAttachment, EmailMessage, EmailQuery, EmailThread } from './types.js';

/** One search, as issued. The criteria travel so a result can be re-derived. */
export interface EmailQueryEvidence {
  id: string;
  query: EmailQuery;
  /** Which account was searched. Scope, never a bare address for display. */
  accountScope: string;
  provider: string;
  issuedAt: string;
  /** Absent on success. Present and specific on failure. */
  failureKind?: string;
}

/**
 * One message we hold.
 *
 * `completeness` is the whole point of this type existing separately from
 * `EmailMessage`: it records HOW we obtained the body, so a downstream summary
 * cannot silently treat a list preview as the message.
 */
export interface EmailMessageEvidence {
  id: string;
  /** Which query produced it, when it came from a search. */
  queryId?: string;
  providerMessageId: string;
  providerThreadId: string;
  from: string;
  subject: string;
  sentAt: string;
  completeness: 'snippet' | 'complete';
  /** The text we actually have — a preview or the whole body. */
  text: string;
  retrievedAt: string;
  provider: string;
}

export interface EmailThreadEvidence {
  id: string;
  providerThreadId: string;
  subject: string;
  /** Message evidence ids, in chronological order as read. */
  messageIds: string[];
  retrievedAt: string;
}

export interface EmailAttachmentEvidence {
  id: string;
  /** 🚨 The STABLE handle — see EmailAttachment.ref. Not a provider token. */
  ref: string;
  /** 🚨 The message it came from. Provenance survives the file pipeline. */
  messageId: string;
  providerMessageId: string;
  providerThreadId: string;
  providerAttachmentId: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  /** Set once bytes have been read and handed to the canonical pipeline. */
  canonicalFileId?: string;
}

/** What a summary was written from, and what it may therefore claim. */
export interface EmailSummaryEvidence {
  id: string;
  /** Evidence ids the summary is entitled to reference. */
  sourceMessageIds: string[];
  threadId?: string;
  /**
   * 🚨 TRUE only when every source was a COMPLETE body.
   *
   * One snippet in the set makes the whole summary partial, because a reader
   * cannot tell which sentence came from which message.
   */
  complete: boolean;
  /** The sentence a partial summary must carry. Empty when complete. */
  limitation: string;
}

export interface EmailDraftEvidence {
  id: string;
  /** The message being replied to or forwarded, when there is one. */
  sourceMessageId?: string;
  sourceThreadId?: string;
  recipientCount: number;
  hasAttachments: boolean;
  createdAt: string;
}

export interface EmailDispatchEvidence {
  id: string;
  draftId: string;
  idempotencyKey: string;
  approvalFingerprint: string;
  outcome: 'committed' | 'failed_before_dispatch' | 'outcome_unknown';
  providerMessageId?: string;
  settledAt: string;
}

/* ------------------------------------------------------------------ *
 * Building evidence from provider objects
 * ------------------------------------------------------------------ */

let counter = 0;
const nextId = (prefix: string): string => `${prefix}_${(counter += 1)}`;

/**
 * Turn a provider message into evidence, recording HOW complete it is.
 *
 * `completeness` is derived from `bodyComplete` and the presence of a real
 * body — not taken on trust. A provider that set the flag without supplying
 * text would otherwise let a snippet through labelled complete.
 */
export function messageEvidence(
  message: EmailMessage,
  accountProvider: string,
  queryId?: string,
): EmailMessageEvidence {
  const hasFullBody = message.bodyComplete && typeof message.textBody === 'string' && message.textBody.length > 0;
  return {
    id: nextId('msg'),
    ...(queryId ? { queryId } : {}),
    providerMessageId: message.providerMessageId,
    providerThreadId: message.providerThreadId,
    from: message.from.address,
    subject: message.subject,
    sentAt: message.sentAt,
    completeness: hasFullBody ? 'complete' : 'snippet',
    text: hasFullBody ? message.textBody! : message.snippet,
    retrievedAt: message.retrievedAt,
    provider: accountProvider,
  };
}

export function threadEvidence(thread: EmailThread, messages: readonly EmailMessageEvidence[]): EmailThreadEvidence {
  return {
    id: nextId('thr'),
    providerThreadId: thread.providerThreadId,
    subject: thread.subject,
    // Order as read. `MigraEmail.readThread` already sorted chronologically.
    messageIds: messages.map((m) => m.id),
    retrievedAt: new Date().toISOString(),
  };
}

export function attachmentEvidence(
  attachment: EmailAttachment,
  message: EmailMessageEvidence,
): EmailAttachmentEvidence {
  return {
    id: nextId('att'),
    // 🚨 Linkage captured at creation. An attachment that loses its message is
    // a document with no idea where it came from.
    messageId: message.id,
    providerMessageId: message.providerMessageId,
    providerThreadId: message.providerThreadId,
    ref: attachment.ref,
    providerAttachmentId: attachment.providerAttachmentId,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    ...(attachment.sizeBytes !== undefined ? { sizeBytes: attachment.sizeBytes } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * 🚨 The enforcement
 * ------------------------------------------------------------------ */

export const SNIPPET_LIMITATION =
  'This is based on message previews, not the full messages.';

export type SummaryRefusal =
  | { kind: 'no_sources'; detail: string }
  | { kind: 'unknown_source'; detail: string }
  | { kind: 'not_in_thread'; detail: string };

/**
 * Build summary evidence, or refuse.
 *
 * The refusals are the point. A summariser that accepted any id would happily
 * describe a message from a search result as part of a thread it is not in —
 * every id real, the relationship invented.
 */
export function summariseFrom(input: {
  sourceIds: readonly string[];
  available: readonly EmailMessageEvidence[];
  /** When summarising a thread, the summary may only use ITS messages. */
  thread?: EmailThreadEvidence;
}): { ok: true; evidence: EmailSummaryEvidence } | { ok: false; refusal: SummaryRefusal } {
  if (input.sourceIds.length === 0) {
    return { ok: false, refusal: { kind: 'no_sources', detail: 'a summary needs at least one retrieved message' } };
  }

  const byId = new Map(input.available.map((m) => [m.id, m]));
  const sources: EmailMessageEvidence[] = [];

  for (const id of input.sourceIds) {
    const message = byId.get(id);
    if (!message) {
      return {
        ok: false,
        refusal: { kind: 'unknown_source', detail: `summary cites a message that was never retrieved: ${id}` },
      };
    }
    /*
     * 🚨 A THREAD SUMMARY MAY ONLY USE THAT THREAD'S MESSAGES.
     *
     * The realistic violation: a message from the search results, which is a
     * real message, presented as part of the conversation being summarised.
     */
    if (input.thread && !input.thread.messageIds.includes(id)) {
      return {
        ok: false,
        refusal: { kind: 'not_in_thread', detail: `summary cites a message outside the thread: ${id}` },
      };
    }
    sources.push(message);
  }

  /*
   * ONE snippet makes the WHOLE summary partial. A reader cannot tell which
   * sentence came from which message, so "mostly complete" is not a claim that
   * can be made honestly at this granularity.
   */
  const complete = sources.every((m) => m.completeness === 'complete');

  return {
    ok: true,
    evidence: {
      id: nextId('sum'),
      sourceMessageIds: sources.map((m) => m.id),
      ...(input.thread ? { threadId: input.thread.id } : {}),
      complete,
      limitation: complete ? '' : SNIPPET_LIMITATION,
    },
  };
}

/**
 * Facts a summary is allowed to state about a message.
 *
 * Returned as data rather than prose so a caller cannot quietly add a sender,
 * a date or an attachment that no evidence supports. If it is not here, it was
 * not retrieved.
 */
export function statableFacts(message: EmailMessageEvidence): {
  from: string;
  subject: string;
  sentAt: string;
  text: string;
  textIsComplete: boolean;
} {
  return {
    from: message.from,
    subject: message.subject,
    sentAt: message.sentAt,
    text: message.text,
    textIsComplete: message.completeness === 'complete',
  };
}
