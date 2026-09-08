/**
 * WHO A MESSAGE GOES TO — and the refusal to guess.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE RULE
 *
 * "Email James" is not an address. If two people named James have ever
 * appeared in this mailbox, the product does not know which one is meant, and
 * picking the more recent, more frequent or first-matching one is a guess that
 * sends a real message to a real stranger.
 *
 * That failure is silent to us and loud to the user: they find out when the
 * wrong person replies, and by then it is irreversible. So ambiguity is
 * REFUSED and named, never resolved by heuristic.
 *
 * ---------------------------------------------------------------------------
 * WHY "MOST RECENT" IS NOT ACCEPTABLE EVEN THOUGH IT IS USUALLY RIGHT
 *
 * Usually-right is the problem. A rule that works nine times in ten trains the
 * user to stop reading the recipient, so the tenth — the one that goes to the
 * wrong James — is the one nobody checks. A refusal that asks costs a moment
 * every time and cannot produce that outcome at all.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAY PROCEED WITHOUT ASKING
 *
 * An explicit address in the prompt. The user typed the mailbox; there is
 * nothing to disambiguate, only to validate.
 */

import type { EmailAddress } from './types.js';

/** A candidate the mailbox has actually seen. Never invented. */
export interface KnownContact {
  address: string;
  /** Display name as some message carried it. */
  name?: string;
  /** How many messages this address appears in. Ranking input ONLY — never a tiebreaker for sending. */
  messageCount: number;
  /** Most recent appearance, RFC-3339. Same restriction. */
  lastSeenAt?: string;
}

export type RecipientResolution =
  /** Exactly one match, or an explicit address. Safe to proceed. */
  | { kind: 'resolved'; address: EmailAddress }
  /** Several plausible matches. The user must choose; we must not. */
  | { kind: 'ambiguous'; term: string; candidates: KnownContact[] }
  /** Nothing matched. Distinct from ambiguous: there is nobody to choose from. */
  | { kind: 'unknown'; term: string }
  /** Present but not usable as an address. */
  | { kind: 'invalid'; term: string; reason: string };

/**
 * A deliberately strict address test.
 *
 * Not RFC 5322 — that grammar admits forms no mail system in practice accepts,
 * and a permissive check here means a malformed address reaches the provider
 * and fails at dispatch, after the user has approved a send.
 *
 * The domain is one-or-more dotted labels, not exactly two. A first attempt
 * allowed a single dot and rejected `first.last+tag@sub.example.com` — a
 * perfectly ordinary address — which is the failure direction that matters:
 * being too strict silently refuses real recipients.
 */
const ADDRESS = /^[^\s@,<>"]+@(?:[^\s@,<>".]+\.)+[^\s@,<>".]{2,}$/;

export function looksLikeAddress(term: string): boolean {
  return ADDRESS.test(term.trim());
}

/**
 * Resolve one term against contacts the mailbox has actually seen.
 *
 * `contacts` must come from observed messages. Synthesising candidates — from
 * a directory, a guess at a company's address format — would put an address
 * nobody has corresponded with in front of a user as though it were known.
 */
export function resolveRecipient(term: string, contacts: readonly KnownContact[]): RecipientResolution {
  const trimmed = term.trim();
  if (trimmed.length === 0) return { kind: 'invalid', term, reason: 'no recipient was given' };

  // An explicit address needs validation, not disambiguation.
  if (trimmed.includes('@')) {
    return looksLikeAddress(trimmed)
      ? { kind: 'resolved', address: { address: trimmed.toLowerCase() } }
      : { kind: 'invalid', term: trimmed, reason: 'that does not look like an email address' };
  }

  const needle = trimmed.toLowerCase();
  const matches = contacts.filter((contact) => {
    const name = contact.name?.toLowerCase() ?? '';
    const local = contact.address.split('@')[0]?.toLowerCase() ?? '';
    // Word-boundary on the name so "Jam" does not match "James", while
    // "James" still matches "James Okafor".
    const nameHit = name.split(/\s+/).some((part) => part === needle);
    return nameHit || local === needle;
  });

  if (matches.length === 0) return { kind: 'unknown', term: trimmed };

  if (matches.length === 1) {
    const only = matches[0]!;
    return {
      kind: 'resolved',
      address: { address: only.address, ...(only.name ? { name: only.name } : {}) },
    };
  }

  /*
   * 🚨 SEVERAL MATCHES: ASK.
   *
   * Candidates are returned sorted by recency and volume so the chooser can
   * present the likeliest first — that is a PRESENTATION aid. It is not a
   * tiebreaker, and nothing here selects one.
   */
  const candidates = [...matches].sort((a, b) => {
    const recency = (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '');
    return recency !== 0 ? recency : b.messageCount - a.messageCount;
  });
  return { kind: 'ambiguous', term: trimmed, candidates };
}

/**
 * Resolve every recipient, and refuse the whole send if ANY is unresolved.
 *
 * All-or-nothing on purpose. Sending to the three recipients we understood and
 * asking about the fourth would deliver a partial message the user never
 * approved — and a message cannot be un-sent to the people who already have it.
 */
export function resolveAll(
  terms: readonly string[],
  contacts: readonly KnownContact[],
): { ok: true; addresses: EmailAddress[] } | { ok: false; problems: RecipientResolution[] } {
  const resolved: EmailAddress[] = [];
  const problems: RecipientResolution[] = [];

  for (const term of terms) {
    const resolution = resolveRecipient(term, contacts);
    if (resolution.kind === 'resolved') resolved.push(resolution.address);
    else problems.push(resolution);
  }

  return problems.length === 0 ? { ok: true, addresses: resolved } : { ok: false, problems };
}
