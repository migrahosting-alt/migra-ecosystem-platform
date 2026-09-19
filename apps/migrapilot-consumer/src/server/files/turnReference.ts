import 'server-only'

import { composeEvidence } from '@/server/evidence/composition'

/**
 * WHAT THIS TURN CAN BE TALKING ABOUT.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY A MODEL AND NOT MORE PATTERNS
 *
 * Every reference defect so far was fixed by telling the turn a fact it already
 * had and had never written down:
 *
 *   "the first document doesn't say anything about cancellation"
 *       — nothing stated which file was first
 *   "the question doesn't specify which sheet to look at"
 *       — nothing carried the sheet the conversation was already working in
 *
 * The tempting fix each time is a pattern for the phrase: `first document`,
 * `that sheet`, `the other spreadsheet`, `the PDF before that`. That list has no
 * end, every entry is a guess about wording, and the day a user says something
 * slightly different the product forgets what it is doing.
 *
 * So this holds the STATE a reference points at — ordered attachments, the sheet
 * in play — and resolution is matching a question against that state. The
 * candidates always come from the FILES THEMSELVES: real filenames, real sheet
 * names. Nothing here contains a list of things people might say.
 *
 * ---------------------------------------------------------------------------
 * 🚨 AND IT NEVER GUESSES
 *
 * A reference that resolves to nothing stays unresolved, and the turn asks. The
 * whole point of holding state is to answer "which one did they mean?" from
 * evidence; inventing an answer when the evidence is absent would be worse than
 * the forgetting it replaces.
 */

export interface AttachmentRef {
  name: string
  /** 1-based, in the order the files were provided. */
  position: number
  uploadedAt?: number
}

export interface TurnReference {
  /** Every file this turn may answer from, oldest attachment first. */
  attachments: AttachmentRef[]
  /**
   * The sheet the conversation is already working in.
   *
   * Null when no workbook is in play, when the workbook has one sheet (nothing
   * to disambiguate), or when no sheet has been named yet — the last of which
   * is a question to ask, never a sheet to pick.
   */
  activeSheet: { file: string; sheet: string } | null
  /** Why each was chosen. For the turn trace; never shown to the user. */
  basis: string[]
}

/**
 * Order the attachments by when they arrived.
 *
 * Upload time rather than array position: the stored grounding list is a set the
 * conversation appends to, and its order is a side effect rather than a record.
 * A file with no timestamp keeps its given position — an unknown time is not a
 * claim that it came first.
 */
export function orderAttachments(
  activeFiles: readonly string[],
  uploadedAt: Readonly<Record<string, number>> = {},
): AttachmentRef[] {
  return [...activeFiles]
    .sort((a, b) => {
      const ta = uploadedAt[a]
      const tb = uploadedAt[b]
      if (ta === undefined || tb === undefined) return 0
      return ta - tb
    })
    .map((name, i) => ({ name, position: i + 1, ...(uploadedAt[name] !== undefined ? { uploadedAt: uploadedAt[name] } : {}) }))
}

/**
 * Which sheet is the conversation working in?
 *
 * 🚨 THE CANDIDATE SET IS THE WORKBOOK'S OWN SHEET NAMES. The recent turns are
 * searched for those names, newest first, and the first hit wins. A question
 * that named a sheet three turns ago is still the sheet in play; a conversation
 * that has never named one resolves to null and the turn asks which.
 *
 * Deliberately NOT a search for words like "that sheet" or "the same one". What
 * makes a sheet active is having been NAMED, and the names are facts about the
 * file rather than guesses about phrasing.
 *
 * `recentTurns` is newest-first. Bounded by the caller: a sheet named forty
 * turns ago is not what "that sheet" means.
 */
export function resolveActiveSheet(
  file: string,
  sheetNames: readonly string[],
  recentTurns: readonly string[],
): { file: string; sheet: string } | null {
  // One sheet is not a choice, and claiming it is "active" would put a
  // reference where none was needed.
  if (sheetNames.length < 2) return null

  for (const turn of recentTurns) {
    const haystack = turn.toLowerCase()
    const hits = sheetNames.filter((n) => n.trim() !== '' && haystack.includes(n.toLowerCase()))
    // Two sheets named in one turn is that turn being about both. It does not
    // make either of them the one in play.
    if (hits.length === 1) return { file, sheet: hits[0]! }
    if (hits.length > 1) return null
  }
  return null
}

/**
 * The roll-call this turn is answered against.
 *
 * Returns null when there is nothing worth stating — one attachment and no sheet
 * in play is a turn that needs no help, and a preamble on every such turn is
 * noise in every prompt that never needed it.
 */
export function referenceEvidence(reference: TurnReference): string | null {
  const many = reference.attachments.length >= 2
  if (!many && !reference.activeSheet) return null

  const lines: string[] = []
  if (many) {
    lines.push(
      `[The files attached to this conversation, in the order they were provided:`,
      ...reference.attachments.map((a) => `  ${a.position}. ${a.name}`),
      `That numbering is what "the first document", "the second file" and similar`,
      `references mean here. It says nothing about what any of them contains.`,
    )
  } else {
    lines.push(`[Context for references in this question:`)
  }

  if (reference.activeSheet) {
    lines.push(
      `The sheet currently being discussed is "${reference.activeSheet.sheet}" in`,
      `${reference.activeSheet.file} — that is what "that sheet" and "the same sheet" mean`,
      `here, until the user names a different one.`,
    )
  }

  lines[lines.length - 1] = `${lines[lines.length - 1]}]`
  return composeEvidence({ fact: lines, directives: [] })
}
