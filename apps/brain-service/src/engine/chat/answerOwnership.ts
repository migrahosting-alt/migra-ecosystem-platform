/**
 * WHO WROTE THIS ANSWER — the capability, or the model?
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE PRINCIPLE
 *
 * A language model should reason where reasoning is needed. It should never be
 * asked to regenerate a fact the system already knows exactly.
 *
 * Everything that went wrong in owner acceptance came from ignoring that. The
 * capability knew, deterministically, that a message carried two attachments
 * and what they were called. It then handed those facts to an 8B model to write
 * a sentence about — and got, across runs: an invented filename, a list with
 * its first entry missing, and a flat refusal. Retrieval was correct every
 * time. The re-authoring was not.
 *
 * The fix is not a stricter gate, and it is certainly not a looser one. It is
 * that a fact the system holds as typed data must reach the user as typed data
 * rendered by code — never as prose a model reconstructed from it.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE CAPABILITY DECIDES, NOT THE PROMPT
 *
 * Ownership is a property of the RESULT, not of how the question was phrased.
 * An attachment listing is authoritative whatever a person typed to obtain it;
 * an open question about what a document means is not. Keying this off prompt
 * wording would put the decision back in the place that cannot know the answer.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THIS IS NOT AN EMAIL FEATURE
 *
 * The same rule is owed to Drive filenames, calendar events, issue metadata,
 * database rows, invoice totals and account values. The contract below is
 * capability-generic on purpose: a capability supplies typed facts and the text
 * it renders from them, and chat learns nothing about what kind of facts they
 * are.
 */

/** Who owns the words the user reads. */
export type AnswerMode =
  /** The capability's own text IS the answer. No model call, nothing to rewrite. */
  | 'capability'
  /** Ordinary generation, verified by the shared gate afterwards. */
  | 'model'
  /** A verified payload the model may write around but never inside. */
  | 'hybrid';

/**
 * The typed facts an answer was rendered from.
 *
 * Extended per capability, never widened in place — a renderer that met an
 * unknown shape would have to guess, and guessing is the thing being removed.
 */
export type StructuredFacts =
  | {
      kind: 'attachment-list';
      subject: string;
      from: string;
      providerMessageId: string;
      attachments: ReadonlyArray<{ filename: string; mimeType?: string; sizeBytes?: number }>;
    }
  | {
      kind: 'file-contents';
      filename: string;
      /** Exactly what the extractor produced. Never re-typed, never trimmed. */
      text: string;
      /** False when the extractor stopped short of the whole document. */
      complete: boolean;
    }
  | {
      kind: 'email-summary';
      summary: string;
      /** False when any source was a preview. */
      complete: boolean;
      sources: ReadonlyArray<{ subject: string; from: string; sentAt: string; providerMessageId: string }>;
    };

export interface AnswerCitation {
  /** How the source names itself to a reader. */
  cite: string;
  /** The handle for going and opening it. Opaque; meaningful with `kind`. */
  locator: string;
  kind: 'email' | 'file';
}

export interface CapabilityAnswer {
  mode: AnswerMode;
  /**
   * 🚨 THE EXACT TEXT THE CAPABILITY OWNS. Rendered from {@link structuredFacts}
   * by code. It is not a suggestion to the model and it is not re-verified: it
   * was never generated, so there is nothing in it to be unsupported.
   */
  groundedText: string;
  structuredFacts: StructuredFacts;
  citations: AnswerCitation[];
  /** The caveat this answer must carry, if any. Attached, never requested. */
  disclosure: string | null;
  /**
   * 🚨 FALSE MEANS THE WORDS ARE FINAL. Not a hint — the route must not send
   * this text through a model, and a test asserts no second generation call is
   * made for a capability-owned answer.
   */
  allowModelRewrite: boolean;
}

/* ------------------------------------------------------------------ *
 * Renderers — typed facts in, exact text out
 * ------------------------------------------------------------------ */

/**
 * An attachment list.
 *
 * 🚨 EVERY NAME COMES FROM METADATA. Not one character of a filename is
 * produced by a model, which is what makes an invented name impossible rather
 * than merely unlikely.
 *
 * 🚨 ZERO IS STATED, NOT IMPLIED. "No attachments" is a fact the listing proved
 * — `attachmentsKnown` makes it a proven absence — and leaving a model to
 * phrase an empty result is how "there don't appear to be any" gets written
 * about a message nobody opened.
 */
export function renderAttachmentList(facts: Extract<StructuredFacts, { kind: 'attachment-list' }>): string {
  if (facts.attachments.length === 0) {
    return `Attachments (0): this message has no attachments.`;
  }
  const lines = facts.attachments.map((a, i) => {
    const detail = [a.mimeType, formatBytes(a.sizeBytes)].filter(Boolean).join(', ');
    return `${i + 1}. ${a.filename}${detail ? ` — ${detail}` : ''}`;
  });
  return [`Attachments (${facts.attachments.length}):`, ...lines].join('\n');
}

/**
 * Sizes are shown only when the provider gave one.
 *
 * A missing size renders as nothing at all rather than as `0 B`, which would be
 * a measurement the product never took.
 */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * A grounded summary.
 *
 * 🚨 THE SUMMARISER'S OWN PROSE, PASSED THROUGH. It was written from the
 * retrieved bodies, checked against them, and had its disclosure attached
 * before it ever reached here. Handing it to a second model to "say it nicely"
 * would put every one of those guarantees back at risk for no gain — and that
 * second pass is exactly what was turning true summaries into refusals.
 */
export function renderEmailSummary(facts: Extract<StructuredFacts, { kind: 'email-summary' }>): string {
  return facts.summary.trim();
}

/**
 * A document's extracted contents.
 *
 * 🚨 THE BYTES SPEAK FOR THEMSELVES. Every figure here came out of the file
 * through the canonical extractor; a model asked to restate them can only
 * introduce a difference. Live, it never produced a WRONG value — but one run
 * in eight refused to produce any, which is the same unreliability wearing a
 * safe face.
 */
export function renderFileContents(facts: Extract<StructuredFacts, { kind: 'file-contents' }>): string {
  const head = `From ${facts.filename}:`;
  const body = facts.text.trim();
  return [head, '', body].join('\n');
}

/** The text a capability owns for these facts. */
export function renderFacts(facts: StructuredFacts): string {
  if (facts.kind === 'attachment-list') return renderAttachmentList(facts);
  if (facts.kind === 'file-contents') return renderFileContents(facts);
  return renderEmailSummary(facts);
}

/**
 * The most extracted text worth putting in front of a person as the answer.
 *
 * 🚨 A BOUND, NOT A PREFERENCE. A short document shown exactly beats any
 * paraphrase of it. A long one pasted whole is not an answer — it is the
 * document — so beyond this the model selects and the gate checks its
 * selection, which is the division of labour those two are for.
 */
export const MAX_RENDERED_FILE_CHARS = 2000;
