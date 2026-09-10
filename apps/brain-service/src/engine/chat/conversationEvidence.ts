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
  /**
   * Evidence id → the capability that produced it.
   *
   * 🚨 HERE, NOT ON THE EVIDENCE. Which capability ran is orchestration, and
   * putting it on the item would push a chat concern into a type the verifier
   * and the repository planner both share.
   *
   * It exists because resolving "that email" has to re-invoke the capability
   * that produced it, and NOTHING ELSE in the record says which one that was.
   * Guessing from the evidence kind works only while each kind has exactly one
   * producer — an assumption that dies the first time Drive also yields files.
   */
  producedBy: Readonly<Record<string, string>>;
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
   * The capability that retrieved it, which is the one a continuation
   * re-invokes. Read from the record, never inferred from the evidence kind.
   */
  capabilityId: string;
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
];

/**
 * Pronouns that MIGHT point backward, and might just as easily point forward.
 *
 * ---------------------------------------------------------------------------
 * 🚨 SEPARATED FROM THE LIST ABOVE AFTER A LIVE FAILURE
 *
 * `it` used to sit in BACKWARD. Then "search my inbox for the message about the
 * test file and tell me who sent it" arrived — and the turn refused to search,
 * because it read the trailing "it" as pointing at a previous turn and a failed
 * reference must never become a licence to go looking. The user asked a
 * perfectly ordinary question and was told to clarify what "it" meant.
 *
 * The difference is not in the pronoun, it is in the rest of the sentence. "Who
 * sent it" AFTER a search points backward; the same words attached to a fresh
 * request point at what that request is about to find. So a bare pronoun is a
 * reference only when the prompt names nothing else to look for — which the
 * caller knows and this module does not, because it depends on which words the
 * registered capabilities own.
 */
const WEAK = ['it', 'its'];

export interface ReferenceOptions {
  /**
   * True when the prompt names a subject of its own.
   *
   * The caller works this out from the capabilities' declared vocabulary, so a
   * bare pronoun stops being a backward reference exactly when there is
   * something else for the turn to go and find.
   */
  hasFreshSubject?: boolean;
}

/**
 * Which phrase, if any, makes this prompt a backward reference.
 *
 * 🚨 PUNCTUATION IS NORMALISED, NOT ENUMERATED — FOUND LIVE.
 *
 * This used to look for the phrase followed by a space, a `?` or a `.`. Then
 * "who sent that email, and what is its subject line?" arrived: the comma after
 * "that email" matched none of the three, the reference did not resolve, and
 * the turn fell through to a fresh search that found nothing.
 *
 * The answer still came out right, which is the alarming part — the model
 * wrote it from the conversation summary of the previous turn. That is exactly
 * what re-reading exists to prevent: had the mailbox been disconnected in
 * between, the same sentence would have been produced from remembered prose,
 * with nothing checking whether the user could still see it.
 *
 * So every non-word character becomes a separator and the match is on words.
 */
export function referencePhrase(prompt: string, opts: ReferenceOptions = {}): string | null {
  const normalized = ` ${prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const candidates = opts.hasFreshSubject ? BACKWARD : [...BACKWARD, ...WEAK];
  // Longest first: "attached to it" must win over the bare "it" inside it.
  for (const phrase of [...candidates].sort((a, b) => b.length - a.length)) {
    if (normalized.includes(` ${phrase} `)) return phrase;
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
 * The KIND OF FILE a reference names, when it names one.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS IS NOT PROSE ROUTING, AND THE DIFFERENCE MATTERS
 *
 * Nothing here decides an operation or infers intent. It reads one word the
 * user actually said — "spreadsheet", "PDF" — and that word is later matched
 * against the file's OWN DECLARED TYPE, as reported by the provider. The
 * evidence for the choice comes from the attachment, not from the sentence.
 *
 * It exists because the real qualification message carries a PDF and an XLSX.
 * Asked about "the spreadsheet", a turn that refused to choose between two
 * attachments of obviously different kinds was not being careful — it was
 * declining to use a fact it had been given. Refusing to guess between
 * `Q3-budget.xlsx` and `Q3-budget-final.xlsx` is caution; refusing to tell a
 * spreadsheet from a PDF is not.
 */
export type ReferenceFileType = 'spreadsheet' | 'pdf' | 'document';

export function referenceFileType(prompt: string): ReferenceFileType | null {
  const lower = prompt.toLowerCase();
  if (/spreadsheet|xlsx|workbook|\bsheet\b|\bexcel\b/.test(lower)) return 'spreadsheet';
  if (/\bpdf\b/.test(lower)) return 'pdf';
  if (/\bdocx?\b|\bword document\b/.test(lower)) return 'document';
  return null;
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
  hasFreshSubject?: boolean;
}): ResolvedReference | null {
  const phrase = referencePhrase(input.prompt, { hasFreshSubject: input.hasFreshSubject });
  if (!phrase) return null;

  const kind = referenceKind(input.prompt);

  // Newest turn first, and within a turn the last item first.
  const candidates: Array<{ item: EvidenceItem; capabilityId: string }> = [];
  for (const record of [...input.history].reverse()) {
    if (!sameScope(record.scope, input.scope)) continue; // belt and braces
    for (const item of [...record.items].reverse()) {
      const capabilityId = record.producedBy[item.id];
      /*
       * 🚨 UNATTRIBUTED EVIDENCE IS NOT A CANDIDATE. Without a producer there
       * is nothing to re-invoke, and the alternatives are both worse than
       * skipping it: guess a capability, or serve the stored text back — which
       * is the pointer becoming a permission.
       */
      if (!capabilityId) continue;
      candidates.push({ item, capabilityId });
    }
  }

  for (const { item, capabilityId } of candidates) {
    if (item.kind !== 'email') continue;
    const isAttachment = Boolean(item.locator.attachmentRef);
    /*
     * An attachment reference may resolve to the MESSAGE that carries it: "the
     * spreadsheet attached to that email" points at an attachment we may not
     * have fetched yet, and the message is what lets us go and find it.
     */
    if (kind === 'attachment') return { kind, capabilityId, item, phrase };
    if (!isAttachment) return { kind, capabilityId, item, phrase };
  }
  return null;
}
