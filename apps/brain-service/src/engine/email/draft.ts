/**
 * COMPOSING A MESSAGE — locally, with no side effect.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THREE THINGS ARE CALLED "DRAFT" AND ONLY ONE IS FREE
 *
 *   composed   held in this process. Nothing has happened.
 *   stored     written into the user's Drafts folder — a MUTATION of their
 *              mailbox, visible on their phone, syncing to every client
 *   sent       irreversible
 *
 * This file builds the first. A user who says "draft a reply" has not asked
 * for something to appear in their Drafts on another device, and doing it
 * anyway is a change to their mailbox they did not request. Provider-side
 * draft persistence, when it exists, is governed like any other mutation.
 *
 * ---------------------------------------------------------------------------
 * THREADING COMES FROM IDS, NEVER FROM SUBJECT
 *
 * "Re: invoice" appears on unrelated conversations. A reply threaded by
 * subject can land in a stranger's conversation and reach its participants —
 * the same failure as guessing a recipient, arriving by a different route.
 */

import { resolveAll, type KnownContact, type RecipientResolution } from './recipients.js';
import type { EmailDraft, EmailMessage } from './types.js';

export type DraftKind = 'new' | 'reply' | 'reply_all' | 'forward';

export type DraftRefusal =
  | { kind: 'recipients_unresolved'; problems: RecipientResolution[] }
  | { kind: 'no_recipients'; detail: string }
  | { kind: 'source_missing'; detail: string };

export type DraftResult = { ok: true; draft: EmailDraft } | { ok: false; refusal: DraftRefusal };

/** The `Re:`/`Fwd:` convention, applied without duplicating an existing prefix. */
function prefixed(subject: string, prefix: 'Re:' | 'Fwd:'): string {
  const trimmed = subject.trim();
  // Case-insensitive so "RE: x" does not become "Re: RE: x".
  const already = new RegExp(`^${prefix}`, 'i').test(trimmed);
  return already ? trimmed : `${prefix} ${trimmed}`;
}

/**
 * Compose a message.
 *
 * Recipients are resolved through the shared refusal rule: ambiguity is asked
 * about, never guessed. That happens HERE rather than at send time so the user
 * sees the question while composing, not after approving something addressed
 * to a person they did not choose.
 */
export function composeDraft(input: {
  kind: DraftKind;
  /** Names or addresses, as the user gave them. */
  to?: readonly string[];
  cc?: readonly string[];
  bcc?: readonly string[];
  subject?: string;
  body: string;
  /** Required for reply, reply_all and forward. */
  source?: EmailMessage;
  contacts: readonly KnownContact[];
  /** The connected account, so a reply-all does not address the user. */
  selfAddress?: string;
}): DraftResult {
  const { kind, source } = input;

  if (kind !== 'new' && !source) {
    return { ok: false, refusal: { kind: 'source_missing', detail: `a ${kind} needs the message it responds to` } };
  }

  /*
   * Recipients for a reply come from the SOURCE MESSAGE, not from the user
   * naming someone — that is what makes a reply a reply. A forward has no
   * implied recipient at all, so the user must supply one.
   */
  let toTerms: string[];
  if (kind === 'reply') {
    toTerms = [source!.from.address];
  } else if (kind === 'reply_all') {
    const everyone = [source!.from.address, ...source!.to.map((a) => a.address), ...source!.cc.map((a) => a.address)];
    // The sender is removed: replying to yourself is never intended, and
    // including it silently doubles the thread for everyone else.
    const self = input.selfAddress?.toLowerCase();
    toTerms = [...new Set(everyone.map((a) => a.toLowerCase()))].filter((a) => a !== self);
  } else {
    toTerms = [...(input.to ?? [])];
  }

  if (toTerms.length === 0) {
    return { ok: false, refusal: { kind: 'no_recipients', detail: 'this message has no recipient' } };
  }

  const resolvedTo = resolveAll(toTerms, input.contacts);
  const resolvedCc = resolveAll(input.cc ?? [], input.contacts);
  const resolvedBcc = resolveAll(input.bcc ?? [], input.contacts);

  /*
   * 🚨 ALL-OR-NOTHING. Composing with the recipients we understood and asking
   * about the rest produces a draft the user might approve without noticing
   * someone is missing — and a message cannot be un-sent to those who got it.
   */
  const problems = [
    ...(resolvedTo.ok ? [] : resolvedTo.problems),
    ...(resolvedCc.ok ? [] : resolvedCc.problems),
    ...(resolvedBcc.ok ? [] : resolvedBcc.problems),
  ];
  if (problems.length > 0) {
    return { ok: false, refusal: { kind: 'recipients_unresolved', problems } };
  }

  const subject =
    kind === 'reply' || kind === 'reply_all'
      ? prefixed(source!.subject, 'Re:')
      : kind === 'forward'
        ? prefixed(source!.subject, 'Fwd:')
        : (input.subject ?? '').trim();

  return {
    ok: true,
    draft: {
      to: (resolvedTo as { addresses: EmailDraft['to'] }).addresses,
      cc: (resolvedCc as { addresses: EmailDraft['cc'] }).addresses ?? [],
      bcc: (resolvedBcc as { addresses: EmailDraft['bcc'] }).addresses ?? [],
      subject,
      body: input.body,
      /*
       * 🚨 THREADING BY ID. A reply carries the message and thread it answers.
       * A FORWARD deliberately does not: it starts a new conversation, and
       * attaching it to the original would put the forwarded copy in front of
       * the original participants.
       */
      ...(kind === 'reply' || kind === 'reply_all'
        ? { inReplyToMessageId: source!.providerMessageId, threadId: source!.providerThreadId }
        : {}),
    },
  };
}

/** What a user is told when composition is refused. Engine-owned wording. */
export function draftRefusalMessage(refusal: DraftRefusal): string {
  switch (refusal.kind) {
    case 'no_recipients':
      return 'Who should this go to?';
    case 'source_missing':
      return 'That reply needs the message it is answering.';
    case 'recipients_unresolved': {
      const ambiguous = refusal.problems.filter((p) => p.kind === 'ambiguous');
      if (ambiguous.length > 0 && ambiguous[0]!.kind === 'ambiguous') {
        const names = ambiguous[0]!.candidates.map((c) => c.address).join(', ');
        return `There is more than one ${ambiguous[0]!.term}: ${names}. Which one?`;
      }
      const unknown = refusal.problems.find((p) => p.kind === 'unknown');
      if (unknown && unknown.kind === 'unknown') {
        return `No email address is known for ${unknown.term}. What address should it go to?`;
      }
      return 'That recipient could not be used.';
    }
  }
}
