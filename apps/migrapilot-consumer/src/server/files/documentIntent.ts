import 'server-only'

/**
 * Is this turn asking about a DOCUMENT the conversation does not have?
 *
 * WHY THIS EXISTS. Asked for the rollback marker in an indexed runbook that was
 * never attached to the conversation, MigraPilot answered: "the shell command
 * might be `./rollback.sh` — this script typically undoes the changes made
 * during the cutover". Confident, plausible, and entirely invented. The file
 * existed, it was indexed, the Files page said "Ready", and the turn still ran
 * with no document context at all.
 *
 * That is the worst available outcome. A user checking their own runbook has no
 * way to tell a grounded answer from a fluent guess about their own document,
 * and the more plausible the guess the more damage it does.
 *
 * THE FALSE-POSITIVE DIRECTION IS CHOSEN DELIBERATELY, and it is the opposite of
 * the image classifier's. Refusing a turn that was not really about a document
 * costs the user one clarifying sentence. Answering a document question from
 * nothing costs them a wrong fact they will believe. So this fires only on an
 * explicit reference to a document, and anything vaguer is left to answer
 * normally.
 *
 * Lexical, with the same stated limit as `freshness.ts` and `generationIntent.ts`:
 * a phrasing outside these lists falls through to ordinary conversation.
 */

/** Words that name a document rather than a subject. */
const DOCUMENT_NOUN = String.raw`(file|files|document|documents|doc|docs|attachment|attachments|` +
  String.raw`upload|uploads|pdf|spreadsheet|csv|notes|runbook|report|readme|changelog|manual|` +
  String.raw`transcript|invoice|contract|paper|dataset)`

/**
 * Pointing at a document: "this file", "my notes", "the attached report",
 * "in my files". A possessive or demonstrative is required — "a report" is a
 * topic, "my report" is an artefact.
 */
const REFERS_TO_DOCUMENT: readonly RegExp[] = [
  new RegExp(String.raw`\b(this|that|these|those|the|my|our)\s+(\w+\s+){0,2}${DOCUMENT_NOUN}\b`, 'i'),
  new RegExp(String.raw`\b(in|from|according to)\s+(my|our|the)\s+(\w+\s+){0,2}${DOCUMENT_NOUN}\b`, 'i'),
  /\bthe\s+(attached|uploaded|indexed)\b/i,
  /\bi\s+(just\s+)?(attached|uploaded|shared)\b/i,
]

/**
 * Asking what a document SAYS. Combined with a reference above, this is
 * unmistakably a question that needs the document in hand.
 */
const ASKS_WHAT_IT_SAYS: readonly RegExp[] = [
  /\b(what|which|where|who|when|how many|how much)\b/i,
  /\b(quote|cite|summari[sz]e|extract|list|find|read|show|tell me)\b/i,
  /\b(says?|state[sd]?|mentions?|contains?|includes?)\b/i,
]

/**
 * Turns that merely mention documents while asking something general.
 *
 * "How do I write a runbook" is a question about the craft, not about a file,
 * and refusing it would be a non sequitur.
 */
const GENERAL_NOT_SPECIFIC: readonly RegExp[] = [
  /\bhow (do|can|should|would) (i|we|you)\b/i,
  /\bhow to\b/i,
  /\bwhat (is|are) (a|an)\b/i,
  /\b(explain|define|teach)\b/i,
  /\b(write|create|draft|generate|make)\s+(me\s+)?(a|an)\b/i,
]

const matches = (patterns: readonly RegExp[], text: string): RegExpExecArray | null => {
  for (const re of patterns) {
    const m = re.exec(text)
    if (m) return m
  }
  return null
}

export interface DocumentIntent {
  /** True when the turn asks about a document this conversation does not have. */
  needsAttachedDocument: boolean
  reason: string
  /** The matched phrase, for the trace. Never shown to the user. */
  evidence?: string
}

/**
 * @param prompt      the user's message
 * @param hasGrounding whether the conversation actually has document context
 */
export function assessDocumentIntent(prompt: string, hasGrounding: boolean): DocumentIntent {
  // Nothing to refuse: the documents are here, so the turn can be answered.
  if (hasGrounding) return { needsAttachedDocument: false, reason: 'the conversation has documents' }

  const text = prompt.trim()
  if (!text) return { needsAttachedDocument: false, reason: 'empty prompt' }

  const general = matches(GENERAL_NOT_SPECIFIC, text)
  if (general) {
    return { needsAttachedDocument: false, reason: 'a general question', evidence: general[0] }
  }

  const reference = matches(REFERS_TO_DOCUMENT, text)
  if (!reference) return { needsAttachedDocument: false, reason: 'no document referenced' }

  const asking = matches(ASKS_WHAT_IT_SAYS, text)
  if (!asking) {
    // Naming a document without asking anything of it — e.g. "my notes are a
    // mess". Not a retrieval request.
    return { needsAttachedDocument: false, reason: 'a document is named but nothing is asked of it' }
  }

  return {
    needsAttachedDocument: true,
    reason: 'asks what a document says, and none is attached',
    evidence: reference[0],
  }
}
