/**
 * What MigraPilot may say about the limits of a spreadsheet.
 *
 * 🚨 CAUGHT IN PRODUCTION, AND IT WAS OUR WORDING THAT CAUSED IT. The structured
 * summary was correct and the model closed it with:
 *
 *   "No text content within cells is accessible to MigraPilot, as it cannot
 *    process or interpret text within spreadsheet cells."
 *
 * That is false, and demonstrably so in the same reply: the summary named the
 * columns, the sheet and the labels "North" and "South" — all of them text read
 * out of cells. The model was paraphrasing a directive we wrote ("MigraPilot
 * cannot search the text inside a spreadsheet"), and a directive stated as a
 * capability denial gets restated as a bigger one.
 *
 * The real limit is narrower and worth stating precisely: cell text is READ,
 * structurally. What does not exist yet is prose retrieval — document-style text
 * search across a workbook's contents, the thing the approved index does for a
 * PDF. So the copy below draws that line, and `deniesCellText` is the standing
 * assertion that neither the model nor a future edit crosses back over it.
 */

/**
 * The one sentence. Appended deterministically by the route — never left to the
 * model, which is how the false claim got out in the first place.
 */
export const SPREADSHEET_CAPABILITY_STATEMENT =
  'MigraPilot can analyze structured spreadsheet data such as sheets, columns, ' +
  'labels, and numeric values, but general document-style text search inside ' +
  'spreadsheets is not available yet.'

/** Stated when a reply has already denied reading cell text, to contradict it in place. */
export const CELL_TEXT_CORRECTION =
  'Correction: the labels and values above were read from this workbook’s cells.'

/** Sentences, plus adjacent pairs, so a claim split across two is still seen. */
function windows(text: string): string[] {
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const pairs = sentences.slice(0, -1).map((s, i) => `${s} ${sentences[i + 1]}`)
  return [...sentences, ...pairs]
}

/** The subject has to actually be the spreadsheet, not some column of free text. */
const SPREADSHEET_SUBJECT = /\bcells?\b|\bspreadsheets?\b|\bworkbooks?\b|\bexcel\b|\bxlsx\b|\bsheets?\b/i

/** And the claim has to be about its text, not about a number. */
const TEXT_NOUN = /\btext\b|\bcontents?\b|\bprose\b|\bwords\b|\blabels?\b|\bstrings?\b/i

/**
 * Denials of READING. Deliberately excludes `search`: "general document-style
 * text search is not available yet" is the true statement and must not trip its
 * own guard.
 *
 * Every verb carries (?:s|es|ed|d|able) because the natural way to write this
 * denial is PASSIVE — "cannot be accessed", "could not be processed". An
 * earlier version alternated `access(?:es)?`, whose trailing \b then refused to
 * match "accessed", so the whole passive voice walked straight through the
 * guard. `understood` is the irregular participle and belongs in the same list,
 * behind the negation — standing alone it matched "MigraPilot understood the
 * sheet structure", flagging a statement that is both positive and true.
 *
 * `unavailable` is deliberately absent for the same reason `search` is: "text
 * search inside spreadsheets is unavailable" is the TRUE statement, and a guard
 * that fires on it would force the correction onto every correct reply.
 */
const NEGATION =
  /(?:cannot|can(?:'|’)?t|could\s+not|couldn(?:'|’)?t|unable\s+to|not\s+able\s+to|does\s+not|doesn(?:'|’)?t|do\s+not|don(?:'|’)?t|is\s+not|are\s+not|isn(?:'|’)?t|aren(?:'|’)?t|was\s+not|were\s+not|no\s+ability\s+to|lacks?\s+the\s+ability\s+to)/
    .source

const READING_DENIALS = [
  new RegExp(
    `\\b(?:${NEGATION})\\b[^.!?]{0,80}?\\b(?:read|process|interpret|access|extract|understand|understood|parse|see|retriev|ingest)(?:s|es|ed|d|able)?\\b`,
    'i',
  ),
  /\b(?:no|none|not|never|nothing)\b[^.!?]{0,80}?\b(?:accessible|readable|interpretable|legible|visible\s+to|exposed\s+to)\b/i,
  /\b(?:inaccessible|unreadable|uninterpretable|illegible)\b/i,
  /*
   * The negation carried by the DETERMINER, with no auxiliary to catch:
   * "No text within the spreadsheet cells was read." Nothing above sees this —
   * there is no "cannot", and "read" is a verb rather than an adjective.
   */
  new RegExp(
    `\\b(?:no|none|nothing)\\b[^.!?]{0,80}?\\b(?:was|were|is|are|can\\s+be|could\\s+be|has\\s+been|have\\s+been)\\s+(?:read|processed|interpreted|accessed|extracted|understood|parsed|retrieved|ingested)\\b`,
    'i',
  ),
]

/**
 * FORBIDDING the claim is not making it.
 *
 * The evidence prompt has to name the false statement in order to rule it out,
 * and a reply may legitimately reject it too. Reading the denial's grammatical
 * frame is the difference between a guard and a word filter: without this, the
 * guard fired on the one sentence written to prevent the defect.
 */
const PROHIBITED =
  /\b(?:never|do\s+not|don(?:'|’)?t|must\s+not|should\s+not|avoid|it\s+is\s+false\s+to|wrong\s+to)\s+(?:say(?:ing)?|claim(?:ing)?|state|stating|tell(?:ing)?|suggest(?:ing)?|report(?:ing)?|conclude|concluding|imply(?:ing)?|writ(?:e|ing))\b/i

/**
 * Exclusivity claims. "Only numeric data can be processed" denies cell text by
 * omission rather than by a verb, so no READING_DENIALS pattern can ever see
 * it — but it tells the reader exactly the false thing we are guarding against.
 *
 * 🚨 IT MUST BE A CLAIM ABOUT CAPABILITY, NOT A DESCRIPTION OF THE DATA. A live
 * run flagged "The sheet contains only structured data with labels and numeric
 * values" — true, and it names the labels as present. Without the capability
 * verb below, the guard appended a correction to a correct reply, which is its
 * own kind of wrong answer.
 */
const NUMERIC = /(?:numeric|numerical|numbers?|figures?|quantitative)/.source

/** "only numeric values" — ambiguous alone, so it needs the capability verb below. */
const NUMERIC_ONLY_CLAIM = new RegExp(`\\bonly\\b[^.!?]{0,40}?\\b(?:${NUMERIC})\\b`, 'i')

/**
 * "limited to numeric data" — capability framing in itself, and nothing else. No
 * one describes a spreadsheet's contents as "restricted to numbers"; that is a
 * statement about the reader, so it needs no second signal.
 */
const NUMERIC_LIMITED = new RegExp(
  `\\b(?:limited|restricted|confined)\\s+to\\b[^.!?]{0,40}?\\b(?:${NUMERIC})\\b`,
  'i',
)

/** The capability framing a bare exclusivity claim needs before it means anything. */
const CAPABILITY_VERB =
  /\b(?:analy[sz]|process|read|interpret|handl|support|extract|comput|access|understand|ingest)/i

/**
 * Naming text as PRESENT is incompatible with denying it was read.
 *
 * "labels and numeric values" lists the cell text among the contents, so no
 * reading of that window is the claim under guard, whatever else it says.
 */
const TEXT_CREDITED =
  /\b(?:labels?|text|strings?|names?)\b[^.!?]{0,25}\band\b[^.!?]{0,25}\b(?:numeric|numerical|numbers?|values?)\b|\b(?:numeric|numerical|numbers?|values?)\b[^.!?]{0,25}\band\b[^.!?]{0,25}\b(?:labels?|text|strings?|names?)\b/i

/**
 * The exact text the route appends to a workbook description.
 *
 * Extracted from the route so it can be asserted directly. The correction
 * branch only fires when a model has denied reading cell text, which no test
 * can make a live model do on demand — leaving the one branch that exists for
 * the production defect as the one branch nothing checked.
 */
export function workbookDisclosureFor(answer: string): string {
  return deniesCellText(answer)
    ? `${CELL_TEXT_CORRECTION} ${SPREADSHEET_CAPABILITY_STATEMENT}`
    : SPREADSHEET_CAPABILITY_STATEMENT
}

/**
 * Does this text claim spreadsheet cell text is wholly inaccessible?
 *
 * The regression assertion Bonex asked for, in one place so the unit suite, the
 * live matrix and the running route all ask the same question.
 */
export function deniesCellText(text: string): boolean {
  return windows(text).some((w) => {
    if (!SPREADSHEET_SUBJECT.test(w)) return false
    // A sentence that rules the claim OUT is not the claim.
    if (PROHIBITED.test(w)) return false
    // Nor is one that names the cell text among what IS there.
    if (TEXT_CREDITED.test(w)) return false
    // An exclusivity claim needs no text noun — "only numeric data can be
    // processed" is already the assertion that nothing else was read — but it
    // does need to be about processing rather than about the data.
    if (NUMERIC_LIMITED.test(w)) return true
    if (NUMERIC_ONLY_CLAIM.test(w) && CAPABILITY_VERB.test(w)) return true
    return TEXT_NOUN.test(w) && READING_DENIALS.some((re) => re.test(w))
  })
}
