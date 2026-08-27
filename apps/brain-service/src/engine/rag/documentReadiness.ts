/**
 * Whether a document can be answered from — as a stored fact, not a UI guess.
 *
 * A scanned book takes minutes to become readable. Everything about that has to
 * survive a closed tab, a reload, and a service restart, so the state lives in
 * the database and every other layer reads it rather than deriving its own.
 *
 * The states are deliberately specific. "Not ready" collapses a file still being
 * read, a file that is locked, and a file that is simply too large into one
 * shrug — and those need three different things from the user.
 */

export type DocumentState =
  /** Uploaded and kept, nothing attempted yet. */
  | 'stored'
  /** A background job is working on it right now; see the stage. */
  | 'processing'
  /** Fully readable and fully placed. */
  | 'ready'
  /**
   * Readable, but some pages could not be placed in the book's sequence.
   *
   * A distinct state rather than a flag on `ready`, because it changes what an
   * answer may claim: content questions are unaffected, ordering questions are
   * not answerable with confidence, and a caller must not have to parse prose to
   * discover that.
   */
  | 'ready_with_unplaced_pages'
  /** No text layer and no OCR available for it. */
  | 'no_text_layer'
  /** OCR ran and could not produce usable text. */
  | 'ocr_failed'
  | 'corrupt'
  | 'encrypted'
  /** Storable, but beyond what the parser may safely load in-process. */
  | 'too_large_to_process';

/**
 * Named steps, not a percentage.
 *
 * A percentage would have to be invented from a duration nobody has measured,
 * and an invented number that drifts is worse than no number. The stage the job
 * is actually in is a fact, and it is what someone waiting actually wants.
 */
export type ProcessingStage =
  | 'uploaded'
  | 'rendering_pages'
  | 'reading_text'
  | 'reconstructing_order'
  | 'indexing'
  | 'ready';

export const STAGE_LABELS: Record<ProcessingStage, string> = {
  uploaded: 'Uploaded',
  rendering_pages: 'Rendering pages',
  reading_text: 'Reading text',
  reconstructing_order: 'Reconstructing order',
  indexing: 'Indexing',
  ready: 'Ready',
};

export interface DocumentReadiness {
  fileName: string;
  state: DocumentState;
  stage?: ProcessingStage;
  /** Free-text detail for the current stage, e.g. "page 18 of 56". */
  detail?: string;
  pagesTotal?: number;
  pagesDone?: number;
  orderedPages?: number;
  unplacedPages?: number;
  /**
   * May a sequence-sensitive answer treat the ordered set as complete?
   *
   * STORED, never inferred. The retrieval layer has to know this before it
   * answers "what comes after section 33", and asking a model to work it out
   * from metadata strings is how a confident wrong order gets shipped.
   */
  sequenceComplete?: boolean;
  failureReason?: string;
  startedAt?: number;
  updatedAt?: number;
}

/** Terminal states: nothing further will happen without the user acting. */
export function isTerminal(state: DocumentState): boolean {
  return state !== 'stored' && state !== 'processing';
}

/** Can this document contribute to an answer at all? */
export function isReadable(state: DocumentState): boolean {
  return state === 'ready' || state === 'ready_with_unplaced_pages';
}

/**
 * What to tell the user, in one sentence they can act on.
 *
 * Kept beside the states so a new state cannot be added without deciding what it
 * says — an unexplained state reaches the user as a blank or a code.
 */
export function describeState(readiness: DocumentReadiness): string {
  switch (readiness.state) {
    case 'stored':
      return 'Stored, not read yet.';
    case 'processing': {
      const label = STAGE_LABELS[readiness.stage ?? 'uploaded'];
      return readiness.detail ? `${label} — ${readiness.detail}` : `${label}…`;
    }
    case 'ready':
      return 'Ready.';
    case 'ready_with_unplaced_pages':
      return `Ready — ${readiness.unplacedPages ?? 0} page(s) could not be placed in the document's sequence.`;
    case 'no_text_layer':
      return 'This PDF has no readable text layer — it looks like a scan or images of pages.';
    case 'ocr_failed':
      return 'The pages were rendered but no readable text could be recovered.';
    case 'corrupt':
      return 'This PDF is damaged and could not be opened.';
    case 'encrypted':
      return 'This PDF is password-protected, so its text cannot be read.';
    case 'too_large_to_process':
      return 'Stored, but too large to process yet.';
  }
}

/**
 * The note a SEQUENCE-SENSITIVE answer must carry when pages are unplaced.
 *
 * Deliberately narrow: it says which capability is limited rather than casting
 * doubt on the whole document, because content questions are entirely unaffected
 * and telling the user otherwise would be its own inaccuracy.
 */
export const UNPLACED_PAGES_NOTE =
  'Some readable pages in this document could not be placed confidently in the book\'s sequence. '
  + 'They can still be used for content questions, but I won\'t use them to determine lesson order.';

/** The tighter form, for an answer that actually depends on ordering. */
export const SEQUENCE_LIMITED_NOTE =
  'I can answer from the ordered pages, but some readable pages are unplaced, '
  + 'so I can\'t guarantee the book\'s complete sequence.';
