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
export type EvidenceKind = 'repo' | 'email' | 'file';

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
  /**
   * Produced by something that already checked its own sources — a grounded
   * summariser, for instance.
   *
   * 🚨 STILL VERIFIED. Pre-grounded means the TEXT is trustworthy as evidence,
   * not that an answer quoting it may claim anything. The outer gate still
   * confirms the final wording only says what this text supports — otherwise
   * "the summariser said so" becomes a laundering step.
   */
  preGrounded?: boolean;
  /**
   * The evidence this item was DERIVED from — set on summaries.
   *
   * 🚨 A SUMMARY MUST NOT OUTRANK ITS SOURCES. Prose is lossy in one direction
   * and confident in the other: a summary of two previews reads exactly like a
   * summary of two full messages, and a summary of one thread reads exactly
   * like a summary of a mailbox. Left unconstrained, summarising would LAUNDER
   * partial, narrowly-scoped evidence into a source that appears to support
   * more than anything actually retrieved.
   *
   * So a derived item may support a claim only where one of these ids also
   * supports it. Enforced in the verifier, which is the only place that sees
   * the whole ledger — an adapter sees one item and could not check it.
   *
   * 🚨 ON THE COMMON BASE, NOT ON ONE KIND. It lived on email evidence while
   * email was the only kind that summarised. Every kind can be summarised, and
   * a rule that only reaches one of them is a rule with a hole in it.
   */
  derivedFrom?: readonly string[];
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
}

/**
 * A FILE — the bytes themselves, after the canonical file pipeline took them.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY AN ATTACHMENT STOPS BEING EMAIL EVIDENCE HERE
 *
 * A spreadsheet that arrived by mail and the same spreadsheet uploaded from a
 * desktop are the same document, and an answer about them must be verified the
 * same way. Keeping the attachment as email evidence would mean its extracted
 * contents were judged by rules written for message bodies — and would leave
 * the upload path with no evidence type at all, so the first upload question
 * would arrive and find the whole ladder built for mail.
 *
 * The message is not lost: it becomes {@link origin}, which is PROVENANCE. A
 * reader still gets "the spreadsheet attached to Invoice 4471".
 *
 * 🚨 THE DIGEST IS THE IDENTITY, not the filename and not any provider handle.
 * Two people attach `budget.xlsx`; one document has one sha256.
 */
export interface FileEvidence extends EvidenceCommon {
  kind: 'file';
  locator: {
    /** sha256 of the exact bytes the pipeline accepted. */
    sha256: string;
    filename: string;
    mimeType: string;
  };
  /**
   * Where the bytes came from.
   *
   * 🚨 NO PROVIDER ATTACHMENT ID. Gmail regenerates it on every read, so
   * recording it would produce provenance that names nothing an hour later —
   * and, worse, a re-fetch handle that has to be believed rather than checked.
   * `attachmentRef` is ours, derived from the attachment's own properties, and
   * still resolves against a fresh read of the message.
   */
  origin:
    | { source: 'upload' }
    | {
        source: 'email-attachment';
        providerMessageId: string;
        providerThreadId: string;
        attachmentRef: string;
      };
}

export type EvidenceItem = RepoEvidence | EmailEvidence | FileEvidence;

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
  /**
   * EVERYTHING a claim about this item may legitimately quote.
   *
   * 🚨 THE SHAPE, NOT THE STANDARD. The verifier's every-term rule runs against
   * this text for every kind alike; what differs is only which parts of a
   * source a reader can see. A message's sender and subject belong in here —
   * "the invoice came from billing@example.com" is exactly true and its words
   * are nowhere in the body. A file's filename belongs in here for the same
   * reason.
   *
   * It exists because the verifier used to build this string ITSELF, from
   * `subject`/`from`/`sentAt` — fields only email has. Any new kind was
   * therefore unquotable by construction: candidates were offered and then
   * dropped, and every true sentence about them was struck out as unsupported.
   * A capability whose evidence cannot ground anything looks exactly like a
   * capability that retrieved nothing.
   */
  haystack(item: E): string;
  /**
   * The handle a reader follows to open this source. Opaque, and meaningful
   * only alongside {@link kind} — a message id and a content digest are not
   * interchangeable and must never be read as though they were.
   */
  locate(item: E): string;
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
  // Unused by the repository path, which has its own long-qualified matching
  // and keeps it. Stated so the adapter is a complete description of the kind.
  haystack: (item) => item.code ?? item.text,
  locate: (item) => `${item.locator.path}:${item.locator.startLine}`,
  limitation: (item) => (item.complete
    ? null
    : 'This is based on part of the file, not the whole file.'),
};

/**
 * The words that NAME the parts of a message, rather than say anything about
 * them. Deliberately short: every word here is one the gate stops checking, so
 * it holds only the vocabulary of pointing — never a word that could carry a
 * fact about content.
 */
const MESSAGE_STRUCTURE = [
  'email', 'mail', 'message', 'thread', 'inbox',
  'subject', 'line', 'title',
  'sender', 'sent', 'sends', 'from', 'received', 'receive',
  'recipient', 'addressed',
  'date', 'dated', 'time', 'timestamp',
  'body', 'content', 'contents', 'text',
].join(' ');

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
    const haystack = tokensOf(emailAdapter.haystack(item));
    const terms = significantTerms(claim);
    if (terms.length === 0) return false;
    return terms.some((t) => haystack.has(t));
  },
  /*
   * The message's own text, plus the header facts a reader can see without
   * opening it. A claim naming the sender or the subject is sourced by the
   * message itself — requiring those words in the BODY would reject "the
   * invoice came from billing@example.com", which is exactly true.
   *
   * ---------------------------------------------------------------------
   * 🚨 AND THE WORDS THAT NAME THE PARTS OF A MESSAGE.
   *
   * Found live. Asked who sent an email and what its subject line was, the
   * model answered correctly — "sent by migrateck@gmail.com, and the subject
   * line is 'test file'" — and the gate deleted the whole sentence, because
   * `email`, `sent`, `subject` and `line` do not appear INSIDE the message.
   *
   * That is the every-term rule meeting a kind of evidence it was not written
   * for. A repository claim quotes identifiers that really are in the code; a
   * message claim mostly DESCRIBES a message, using words for its parts. Those
   * words are structure, not content, and demanding them in the body rejects
   * exactly the true sentences a person asks for.
   *
   * 🚨 IT COSTS NO DISCRIMINATION, which is why it is safe. "The subject is
   * Invoice 9999" still has to find `9999`; all this permits is the vocabulary
   * for POINTING at a part, never a claim about what the part says. And it is
   * per kind — a repository span has no sender, so nothing here reaches it.
   */
  haystack: (item) => [
    item.text, item.subject, item.from, item.sentAt,
    MESSAGE_STRUCTURE,
  ].join('\n'),
  locate: (item) => item.locator.providerMessageId,
  limitation: (item) => (item.complete
    ? null
    : 'This is based on message previews, not the full messages.'),
};

/** The vocabulary for pointing at part of a document. See MESSAGE_STRUCTURE. */
const FILE_STRUCTURE = [
  'file', 'filename', 'document', 'attachment', 'attached',
  'spreadsheet', 'workbook', 'sheet', 'tab',
  'row', 'rows', 'column', 'columns', 'cell', 'cells', 'header', 'headers',
  'page', 'pages', 'section', 'contents', 'content', 'text', 'value', 'values',
].join(' ');

/**
 * The file adapter.
 *
 * Attribution is a DOCUMENT — a name a person recognises, plus where it came
 * from when that was not their own upload.
 */
export const fileAdapter: EvidenceAdapter<FileEvidence> = {
  kind: 'file',
  describe(item) {
    const name = `"${item.locator.filename}"`;
    return item.origin.source === 'email-attachment'
      ? `${name} attached to a message`
      : name;
  },
  couldSource(claim, item) {
    const haystack = tokensOf(fileAdapter.haystack(item));
    const terms = significantTerms(claim);
    if (terms.length === 0) return false;
    return terms.some((t) => haystack.has(t));
  },
  /*
   * 🚨 THE FILENAME IS PART OF THE SOURCE. "The budget spreadsheet lists
   * 48273.55" names the document and quotes it, and only one of those facts is
   * inside the bytes. Leaving the name out would strike out the sentence that
   * says which file was read — the one sentence a reader most needs.
   *
   * The structural vocabulary is here for the same reason it is on a message:
   * a sentence about a document mostly names its parts, and those words are
   * pointing, not claiming. A figure or a name still has to be in the bytes.
   */
  haystack: (item) => [item.text, item.locator.filename, FILE_STRUCTURE].join('\n'),
  /*
   * 🚨 THE DIGEST, not the filename. It is the only handle that still names
   * these exact bytes after someone attaches a second `budget.xlsx`.
   */
  locate: (item) => item.locator.sha256,
  limitation: (item) => (item.complete
    ? null
    : 'This is based on part of the file, not all of it.'),
};

const ADAPTERS: Record<EvidenceKind, EvidenceAdapter<never>> = {
  repo: repoAdapter as EvidenceAdapter<never>,
  email: emailAdapter as EvidenceAdapter<never>,
  file: fileAdapter as EvidenceAdapter<never>,
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
