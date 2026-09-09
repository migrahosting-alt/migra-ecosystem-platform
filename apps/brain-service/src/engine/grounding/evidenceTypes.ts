/**
 * TYPED EVIDENCE — one ledger, many kinds of source.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THE REPO-ONLY MODEL HAD TO GO
 *
 * Evidence used to BE a repository span: `{ path, startLine, endLine, text }`.
 * That shape is not a detail — the whole grounding gate is built on it, so a
 * claim derived from anything else was unverifiable by construction and got
 * stripped as unsupported. Measured live: the model read a real mailbox, wrote
 * a true sentence about it, and the verifier removed the sentence because a
 * message has no line numbers.
 *
 * The tempting shortcut is to let email answers skip verification, since the
 * summariser already returns provenance. That creates two standards — repo
 * claims are checked, email claims are trusted — and the second standard
 * spreads to Drive, Calendar and Web the moment they arrive.
 *
 * So the EVIDENCE MODEL generalises instead of the rules relaxing. Every kind
 * carries its own locator and its own completeness semantics; one verifier
 * interface, type-specific adapters behind it.
 *
 * ---------------------------------------------------------------------------
 * 🚨 EVERY ITEM CARRIES ITS SCOPE
 *
 * A repository span belongs to a workspace on disk. A message belongs to a
 * PERSON. Once both live in one ledger, "whose evidence is this" stops being
 * obvious and has to be recorded — otherwise one turn's mailbox could ground
 * another principal's answer, which is the cross-tenant read this whole
 * subsystem exists to prevent, reached from a new direction.
 */

/** The kinds of source that can ground a claim. Extended, never widened in place. */
export type EvidenceKind = 'repo' | 'email';

/**
 * Whose evidence this is.
 *
 * Present on EVERY item, including repository spans. A repo span's scope is the
 * caller who retrieved it, so a ledger cannot silently serve one principal's
 * retrieval to another's answer.
 */
export interface EvidenceScope {
  principalId: string;
  workspaceId: string;
}

interface EvidenceCommon {
  /** Stable within a run. What a citation names. */
  id: string;
  /** The text a claim may be grounded in — never a summary of it. */
  text: string;
  /**
   * 🚨 Whether {@link text} is the WHOLE source.
   *
   * False means any answer drawing on this must say it worked from a preview.
   * The flag exists at the evidence layer, not the answer layer, because by the
   * time prose is written the distinction is unrecoverable.
   */
  complete: boolean;
  scope: EvidenceScope;
}

/** A range of lines in a file. The original evidence type, unchanged in meaning. */
export interface RepoEvidence extends EvidenceCommon {
  kind: 'repo';
  locator: { path: string; startLine: number; endLine: number };
  /** {@link text} with comments removed — what the code DOES. */
  code?: string;
}

/**
 * A message, a thread, or an attachment's extracted text.
 *
 * The locator is what makes the claim traceable back to something a person can
 * open. `attachmentRef` is OUR stable handle, never the provider's own id —
 * that one is regenerated per read and names nothing an hour later.
 */
export interface EmailEvidence extends EvidenceCommon {
  kind: 'email';
  locator: {
    providerMessageId: string;
    providerThreadId: string;
    attachmentRef?: string;
  };
  subject: string;
  from: string;
  sentAt: string;
  /**
   * Produced by the grounded summariser, which already checked its own sources.
   *
   * 🚨 STILL VERIFIED. Pre-grounded means the TEXT is trustworthy as evidence,
   * not that an answer quoting it may claim anything. The outer gate still
   * confirms the final wording only says what this text supports — otherwise
   * "the summariser said so" becomes a laundering step.
   */
  preGrounded?: boolean;
}

export type EvidenceItem = RepoEvidence | EmailEvidence;

/* ------------------------------------------------------------------ *
 * 🚨 One verifier interface, type-specific adapters
 * ------------------------------------------------------------------ */

/**
 * What the grounding gate needs from a kind of evidence.
 *
 * Deliberately small. A big interface would tempt each adapter to re-implement
 * the verifier's judgement, and the point is that the JUDGEMENT is shared and
 * only the source-specific parts differ.
 */
export interface EvidenceAdapter<E extends EvidenceItem = EvidenceItem> {
  readonly kind: EvidenceKind;
  /** How a citation names this source to a reader. */
  describe(item: E): string;
  /**
   * Could this item be the SOURCE of that claim's vocabulary?
   *
   * 🚨 A CANDIDATE TEST, NOT A VERDICT. Deciding whether a claim actually
   * stands — how much of its vocabulary must appear, whether it is direct
   * evidence or inference, which source it is anchored to — belongs to the
   * verifier, and stays shared across kinds. If an adapter made that decision,
   * every new capability would arrive with its own grounding standard, which is
   * the two-standards problem generalising instead of the model.
   *
   * So this answers only: is this item a plausible source to hand the verifier?
   */
  couldSource(claim: string, item: E): boolean;
  /** The caveat this item forces onto any answer using it, if any. */
  limitation(item: E): string | null;
}

/**
 * 🚨 WHOLE TOKENS, NEVER SUBSTRINGS.
 *
 * `sendInvoice` contains "invoice", so substring matching let a source file
 * about sending invoices look like a plausible source for a claim about an
 * emailed invoice. Caught by a test that put both kinds in one ledger — the
 * repo verifier never had the problem because it ANCHORS to a named file
 * first, and an unanchored ledger has no such protection.
 */
export function tokensOf(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[a-z0-9_.@$-]{2,}/g) ?? [])
      .map(trimEdgePunctuation)
      .filter((t) => t.length >= 2),
  );
}

/**
 * 🚨 A TRAILING SENTENCE PERIOD IS NOT PART OF THE TOKEN.
 *
 * `.` has to be inside the character class — `foo.ts` and `48273.55` are single
 * tokens and splitting them would destroy the two things most worth matching
 * exactly. The cost is that "48273.55." at the end of a sentence captures the
 * full stop, and then never matches the "48273.55" in its own source.
 *
 * That is not a cosmetic mismatch: it silently breaks every claim that ends on
 * a number or a filename, which is most claims worth checking.
 */
function trimEdgePunctuation(token: string): string {
  return token.replace(/^[.\-]+/, '').replace(/[.\-]+$/, '');
}

/** Terms worth matching on: words a claim and its source should share. */
export function significantTerms(text: string): string[] {
  return [...new Set(
    (text.toLowerCase().match(/[a-z0-9_.@$-]{3,}/g) ?? [])
      .map(trimEdgePunctuation)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  )];
}

const STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'for', 'are', 'was', 'were', 'has', 'have',
  'not', 'but', 'its', 'it.', 'into', 'than', 'then', 'they', 'them', 'their', 'there',
  'which', 'when', 'what', 'who', 'whom', 'been', 'being', 'will', 'would', 'can', 'could',
  'should', 'may', 'might', 'must', 'about', 'also', 'any', 'all', 'one', 'two', 'more',
]);

/**
 * The repository adapter — the ORIGINAL rules, unchanged.
 *
 * Preserved deliberately rather than re-derived: repo grounding is qualified
 * behaviour with its own suite, and a generalisation that quietly altered it
 * would be a regression wearing an architecture's clothes.
 */
export const repoAdapter: EvidenceAdapter<RepoEvidence> = {
  kind: 'repo',
  describe: (item) => `${item.locator.path}:${item.locator.startLine}-${item.locator.endLine}`,
  couldSource(claim, item) {
    // Comments are a claim ABOUT code, not code — so the CODE is the haystack
    // when we have it, exactly as the repo verifier already decides.
    const haystack = tokensOf(item.code ?? item.text);
    const terms = significantTerms(claim);
    if (terms.length === 0) return false;
    return terms.some((t) => haystack.has(t));
  },
  limitation: (item) => (item.complete
    ? null
    : 'This is based on part of the file, not the whole file.'),
};

/**
 * The email adapter.
 *
 * Attribution is a MESSAGE, not a line range, and the limitation is the one the
 * mail layer already established: a search returns previews, and a summary
 * drawn from previews has to say so.
 */
export const emailAdapter: EvidenceAdapter<EmailEvidence> = {
  kind: 'email',
  describe(item) {
    const where = item.locator.attachmentRef
      ? `attachment in "${item.subject}"`
      : `message "${item.subject}"`;
    return `${where} from ${item.from}`;
  },
  couldSource(claim, item) {
    /*
     * The message's own text, plus the header facts a reader can see without
     * opening it. A claim naming the sender or the subject is sourced by the
     * message itself — requiring those words in the BODY would reject "the
     * invoice came from billing@example.com", which is exactly true.
     */
    const haystack = tokensOf(`${item.text}\n${item.subject}\n${item.from}\n${item.sentAt}`);
    const terms = significantTerms(claim);
    if (terms.length === 0) return false;
    return terms.some((t) => haystack.has(t));
  },
  limitation: (item) => (item.complete
    ? null
    : 'This is based on message previews, not the full messages.'),
};

const ADAPTERS: Record<EvidenceKind, EvidenceAdapter<never>> = {
  repo: repoAdapter as EvidenceAdapter<never>,
  email: emailAdapter as EvidenceAdapter<never>,
};

/**
 * The adapter for one item.
 *
 * 🚨 THROWS for an unknown kind rather than defaulting. A default adapter would
 * silently verify a new evidence type with rules written for a different one —
 * and the failure would look like grounding working.
 */
export function adapterFor(item: EvidenceItem): EvidenceAdapter<never> {
  const adapter = ADAPTERS[item.kind];
  if (!adapter) throw new Error(`no verification adapter for evidence kind ${JSON.stringify(item.kind)}`);
  return adapter;
}

/** Whether two scopes are the same principal in the same workspace. */
export function sameScope(a: EvidenceScope, b: EvidenceScope): boolean {
  return a.principalId === b.principalId && a.workspaceId === b.workspaceId;
}
