/**
 * "THAT EMAIL" — what a later turn is allowed to mean.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS IS NOT BROWSER STATE
 *
 * The obvious implementation is to remember the provider's message id on the
 * client and send it back next turn. Three things break:
 *
 *   · a provider id is not stable — Gmail regenerates attachment ids on every
 *     read, and "list then fetch by id" already returned not_found against the
 *     live mailbox for exactly that reason;
 *   · anything the browser sends is something a browser can INVENT, so "that
 *     email" would become a way to name a message the user was never shown;
 *   · it is capability-specific, so Drive and Calendar would each grow their
 *     own version of the same state.
 *
 * So a turn remembers CANONICAL EVIDENCE IDS, scoped to the principal who
 * retrieved them. A later turn resolves a reference against that record and
 * then RE-RESOLVES the underlying resource through the capability, under the
 * current identity — which is what makes a disconnect take effect between
 * turns rather than after them.
 */

import { sameScope, type EmailEvidence, type EvidenceItem, type EvidenceScope } from '../grounding/evidenceTypes.js';

/** What one turn contributed, kept for the turns that follow it. */
export interface ConversationEvidenceRecord {
  conversationId: string;
  turnId: string;
  scope: EvidenceScope;
  items: readonly EvidenceItem[];
}

export interface ConversationEvidenceStore {
  /** Newest last. Implementations must not return another principal's turns. */
  recent(conversationId: string, scope: EvidenceScope, limit: number): Promise<ConversationEvidenceRecord[]>;
  append(record: ConversationEvidenceRecord): Promise<void>;
}

/**
 * An in-memory store. Real deployments persist; this keeps the CONTRACT
 * honest — every read is scoped, and a scope mismatch returns nothing rather
 * than filtering afterwards.
 */
export class MemoryConversationEvidence implements ConversationEvidenceStore {
  private readonly byConversation = new Map<string, ConversationEvidenceRecord[]>();

  async recent(conversationId: string, scope: EvidenceScope, limit: number): Promise<ConversationEvidenceRecord[]> {
    const all = this.byConversation.get(conversationId) ?? [];
    // 🚨 Scoped at READ time. A conversation id is not a permission.
    return all.filter((r) => sameScope(r.scope, scope)).slice(-Math.max(1, limit));
  }

  async append(record: ConversationEvidenceRecord): Promise<void> {
    const all = this.byConversation.get(record.conversationId) ?? [];
    all.push(record);
    this.byConversation.set(record.conversationId, all);
  }
}

/* ------------------------------------------------------------------ *
 * Recognising a reference
 * ------------------------------------------------------------------ */

export type ReferenceKind = 'email' | 'attachment' | 'thread';

export interface ResolvedReference {
  kind: ReferenceKind;
  /**
   * The canonical evidence the reference points at.
   *
   * Typed as email evidence because that is what backward references currently
   * reach for. Widening it later is a deliberate act, not something a caller
   * discovers by narrowing a union at every use site.
   */
  item: EmailEvidence;
  /** Which phrase was read as the reference. Kept so a plan can be explained. */
  phrase: string;
}

/*
 * Demonstratives that point BACKWARD. A reference needs one of these — "the
 * email from Hetzner" is a fresh search, not a reference to a previous turn,
 * and treating it as one would answer from stale evidence instead of looking.
 */
const BACKWARD = [
  'that email', 'that message', 'this email', 'this message',
  'that thread', 'this thread', 'the thread',
  'that attachment', 'the attachment', 'the spreadsheet', 'that spreadsheet',
  'the xlsx', 'the pdf', 'the file attached', 'attached to it', 'attached to that',
  'it', 'its',
];

/** Which phrase, if any, makes this prompt a backward reference. */
export function referencePhrase(prompt: string): string | null {
  const lower = ` ${prompt.toLowerCase()} `;
  // Longest first: "attached to it" must win over the bare "it" inside it.
  for (const phrase of [...BACKWARD].sort((a, b) => b.length - a.length)) {
    if (lower.includes(` ${phrase} `) || lower.includes(` ${phrase}?`) || lower.includes(` ${phrase}.`)) {
      return phrase;
    }
  }
  return null;
}

/** What KIND of thing the reference is reaching for. */
export function referenceKind(prompt: string): ReferenceKind {
  const lower = prompt.toLowerCase();
  if (/spreadsheet|xlsx|attachment|attached|\bpdf\b|\bfile\b/.test(lower)) return 'attachment';
  if (/thread|conversation/.test(lower)) return 'thread';
  return 'email';
}

/**
 * Resolve a backward reference against what this conversation actually retrieved.
 *
 * 🚨 SCOPED, AND NEWEST-FIRST. Scoped because a conversation id is not a
 * permission; newest-first because "that email" means the one most recently in
 * front of the user, not the first one ever mentioned.
 *
 * Returns null when there is nothing to point at — which the caller must treat
 * as "ask what they meant", never as "search the mailbox and hope".
 */
export function resolveReference(input: {
  prompt: string;
  history: readonly ConversationEvidenceRecord[];
  scope: EvidenceScope;
}): ResolvedReference | null {
  const phrase = referencePhrase(input.prompt);
  if (!phrase) return null;

  const kind = referenceKind(input.prompt);

  // Newest turn first, and within a turn the last item first.
  const candidates: EvidenceItem[] = [];
  for (const record of [...input.history].reverse()) {
    if (!sameScope(record.scope, input.scope)) continue; // belt and braces
    for (const item of [...record.items].reverse()) candidates.push(item);
  }

  for (const item of candidates) {
    if (item.kind !== 'email') continue;
    const isAttachment = Boolean(item.locator.attachmentRef);
    /*
     * An attachment reference may resolve to the MESSAGE that carries it: "the
     * spreadsheet attached to that email" points at an attachment we may not
     * have fetched yet, and the message is what lets us go and find it.
     */
    if (kind === 'attachment') return { kind, item, phrase };
    if (!isAttachment) return { kind, item, phrase };
  }
  return null;
}
