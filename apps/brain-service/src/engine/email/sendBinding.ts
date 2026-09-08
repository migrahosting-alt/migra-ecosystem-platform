/**
 * WHAT AN APPROVAL TO SEND IS AN APPROVAL *OF*.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE FAILURE THIS PREVENTS
 *
 * A user reads a draft addressed to their accountant, approves it, and the
 * message goes to a different recipient — or with a different body — because
 * something changed between the approval and the dispatch. Every step was
 * "authorized": there was a real approval, and a real send.
 *
 * The approval was just never bound to what the user actually saw.
 *
 * So an approval binds a FINGERPRINT of the exact message. Change any bound
 * field and the old approval no longer matches, which the consent store
 * reports as a mismatch rather than silently accepting.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS BOUND, AND WHY EACH ONE
 *
 *   account        sending as a different identity is a different act
 *   to / cc / bcc  the whole point; a changed recipient is a different email
 *   subject        what the reader sees first
 *   body           normalized, so trivial whitespace does not invalidate an
 *                  approval while a real edit does
 *   thread target  a reply grafted onto a different conversation reaches
 *                  people who were never in the one the user was reading
 *
 * ---------------------------------------------------------------------------
 * WHY NORMALIZATION IS NARROW
 *
 * It collapses trailing whitespace and line-ending style, because those change
 * without anyone editing anything and invalidating on them would make approvals
 * fail for no reason a user could see.
 *
 * It does NOT lowercase, strip punctuation, or collapse internal spacing. Those
 * would make genuinely different messages hash the same — and the whole value
 * here is that a changed message fails to match.
 *
 * Addresses ARE lowercased and sorted: `A@x.com` and `a@x.com` are the same
 * mailbox, and recipient ORDER is not a property of the message.
 */

import { createHash } from 'node:crypto';

import type { EmailAddress, EmailDraft } from './types.js';

/** Everything an approval covers. Anything absent here is NOT bound. */
export interface SendBinding {
  /** Which account sends. A different identity is a different act. */
  account: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  inReplyToMessageId?: string;
  threadId?: string;
}

const normalizeAddresses = (addresses: readonly EmailAddress[]): string[] =>
  [...new Set(addresses.map((a) => a.address.trim().toLowerCase()).filter((a) => a.length > 0))].sort();

/**
 * Body normalization: line endings and trailing space only.
 *
 * Deliberately conservative. Every additional normalization is a class of edit
 * that stops invalidating the approval, and the cost of being too lax here is
 * a message the user did not approve.
 */
export function normalizeBody(body: string): string {
  return body
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function bindingFor(account: string, draft: EmailDraft): SendBinding {
  return {
    account: account.trim().toLowerCase(),
    to: normalizeAddresses(draft.to),
    cc: normalizeAddresses(draft.cc),
    bcc: normalizeAddresses(draft.bcc),
    // Subject keeps its case: "URGENT" and "urgent" read differently.
    subject: draft.subject.trim(),
    body: normalizeBody(draft.body),
    ...(draft.inReplyToMessageId ? { inReplyToMessageId: draft.inReplyToMessageId } : {}),
    ...(draft.threadId ? { threadId: draft.threadId } : {}),
  };
}

/**
 * The fingerprint an approval is stored against.
 *
 * Field names are included in the hashed material so that moving a value from
 * one field to another changes the hash — otherwise a recipient shifted from
 * `to` to `bcc` would produce identical input, and that is a materially
 * different email.
 */
export function fingerprint(binding: SendBinding): string {
  const canonical = JSON.stringify({
    account: binding.account,
    to: binding.to,
    cc: binding.cc,
    bcc: binding.bcc,
    subject: binding.subject,
    body: binding.body,
    inReplyToMessageId: binding.inReplyToMessageId ?? null,
    threadId: binding.threadId ?? null,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

/** Convenience: fingerprint straight from an account and a draft. */
export function fingerprintDraft(account: string, draft: EmailDraft): string {
  return fingerprint(bindingFor(account, draft));
}

/**
 * The idempotency key for a send.
 *
 * Derived from the fingerprint, so the SAME approved message re-dispatched is
 * recognised as the same operation — which is what stops a duplicate approval
 * or a retried request producing two emails. A random key per attempt would
 * make every retry a new operation and defeat the primitive entirely.
 */
export function idempotencyKeyFor(binding: SendBinding): string {
  return `email.send:${fingerprint(binding)}`;
}

/**
 * Why an approval no longer applies.
 *
 * Returns the CHANGED FIELDS rather than a boolean, so a refusal can say what
 * changed. "This approval is no longer valid" with no reason is indistinguishable
 * from a bug, and a user cannot tell whether to re-approve or investigate.
 */
export function changedFields(approved: SendBinding, current: SendBinding): string[] {
  const changed: string[] = [];
  const compare = (name: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) changed.push(name);
  };
  compare('account', approved.account, current.account);
  compare('to', approved.to, current.to);
  compare('cc', approved.cc, current.cc);
  compare('bcc', approved.bcc, current.bcc);
  compare('subject', approved.subject, current.subject);
  compare('body', approved.body, current.body);
  compare('inReplyToMessageId', approved.inReplyToMessageId ?? null, current.inReplyToMessageId ?? null);
  compare('threadId', approved.threadId ?? null, current.threadId ?? null);
  return changed;
}
