/**
 * Which of a conversation's files this TURN may be answered from.
 *
 * 🚨 THE DEFECT. Every file ever attached to a conversation stayed an equally
 * active retrieval target forever:
 *
 *     const requestedGrounding = [...new Set([...storedGrounding, ...attachedNow])]
 *
 * So attaching a scanned PDF to an existing thread and asking about it produced
 * an answer from an unrelated earlier document, and a CSV question cited a DOCX.
 * The same files in a fresh conversation answered correctly, which is what
 * proved the extraction was fine and the SELECTION was not.
 *
 * 🚨 WHY IT WAS BUILT THAT WAY, AND WHY THAT IS NOW SAFE TO CHANGE. The consumer
 * never sent `conversationId`, so the Brain had no conversation history at all —
 * documents were the ONLY thing carrying continuity between turns. Making the
 * file set additive-forever was the workaround. Now that history genuinely
 * flows, continuity is history's job and this can go back to meaning what it
 * says: the evidence for THIS question.
 *
 * THE SET IS STILL PERSISTED IN FULL. Narrowing what is ACTIVE is not the same
 * as forgetting: the conversation keeps every file it was given, and naming one
 * brings it back. This decides the retrieval boundary for one turn only.
 */

/**
 * A file is "named" if the prompt mentions its name or its stem.
 *
 * Deliberately literal. Anything cleverer — embedding the prompt, asking a model
 * which file is meant — would put a guess in the position of a boundary, and the
 * whole defect here was retrieval quietly widening beyond what was asked. A user
 * who writes the filename gets that file; a user who does not gets this turn's
 * attachments, which is what they just chose.
 */
function mentions(prompt: string, fileName: string): boolean {
  const haystack = prompt.toLowerCase()
  const name = fileName.toLowerCase()
  if (haystack.includes(name)) return true

  // The stem, so "the reference document" matches `reference_document.docx`
  // once punctuation is normalised. Short stems are ignored: a file called
  // `a.txt` would otherwise match the letter "a" in any sentence.
  const stem = name.replace(/\.[^.]+$/, '')
  if (stem.length < 4) return false
  if (haystack.includes(stem)) return true

  const spaced = stem.replace(/[_-]+/g, ' ')
  return spaced.length >= 4 && haystack.includes(spaced)
}

import { composeEvidence } from '@/server/evidence/composition'

export interface TurnGroundingSelection {
  /** The retrieval boundary for THIS turn. */
  active: string[]
  /** Why, for the turn trace. Never shown to the user as-is. */
  reason: 'attached_this_turn' | 'named_in_prompt' | 'conversation_default' | 'none'
  /** Files in the thread that this turn deliberately left out. */
  withheld: string[]
}

/**
 * Choose the active grounding set.
 *
 * The rules, in order:
 *
 *   1. Files attached to THIS turn are active. That is what the user just did,
 *      and it is the case the contamination defect broke.
 *   2. Historical files NAMED in the prompt are active — attached this turn or
 *      not — because "what did the invoice say?" is an explicit reference.
 *   3. With neither, ONE document at most. A single-file thread uses its file,
 *      because "summarise it" is unambiguous there. A multi-file thread uses
 *      only the most recently attached — never the whole set, which is how a
 *      question about the first PDF came back citing an unrelated scan.
 */
/**
 * How far apart two uploads may be and still count as ONE attachment.
 *
 * 🚨 MEASURED, not guessed. Two files chosen in a single picker action land
 * 137 ms apart; the window is set far wider so that a slow multi-file upload —
 * a large scan beside a small sheet, written sequentially — is still recognised
 * as the one action it was.
 *
 * The cost of being generous is bounded and small: a file attached two minutes
 * ago IN THE SAME THREAD joins the working set. That is nothing like the defect
 * this module exists for, which was an unrelated document from much earlier in
 * a long session being reactivated forever.
 */
const CO_ATTACHED_WINDOW_MS = 120_000

/**
 * Files this conversation HAD, which are no longer in the library.
 *
 * 🚨 WHY THE MODEL HAS TO BE TOLD. Reconciliation drops a deleted file from the
 * available set silently and correctly — it is gone, and grounding on it is
 * impossible. But the turn then proceeds as though the user had never referred
 * to it, and the narrowing rules below pick some OTHER document.
 *
 * Measured on staging. A lease summary was attached, discussed, and deleted from
 * the library. Asked "In the lease document, which year is the rent review?",
 * the answer came back "The term of the document is 2026 (vendor_terms.md:1-2)"
 * — a different file, cited, with nothing anywhere saying the lease was gone.
 * A confident answer about the wrong document is worse than a refusal, because
 * the citation invites the reader to trust it.
 *
 * Stated UNCONDITIONALLY rather than only when the prompt appears to name the
 * missing file, because name-matching is exactly what cannot be relied on here:
 * "the lease document" does not match `lease_summary.md` by stem or by spacing,
 * so a matched-only disclosure would have stayed silent on the very case that
 * produced the defect. The fact is short, it is true, and it only appears on a
 * conversation that has actually lost a file.
 */
export function missingFileEvidence(missing: readonly string[]): string | null {
  const gone = [...new Set(missing.filter((name) => name.trim().length > 0))]
  if (gone.length === 0) return null
  return composeEvidence({
    fact: [
      `[${gone.length === 1 ? 'This file was' : 'These files were'} part of this conversation and ${gone.length === 1 ? 'is' : 'are'} NO LONGER in the user's library:`,
      ...gone.map((name) => `  ${name}`),
      `If the question is about ${gone.length === 1 ? 'it' : 'one of them'}, say plainly that it is no longer available.`,
      `Do not answer about it from a different document.]`,
    ],
    directives: [],
  })
}

export function selectTurnGrounding(
  prompt: string,
  attachedNow: readonly string[],
  conversationFiles: readonly string[],
  uploadedAt: Readonly<Record<string, number>> = {},
): TurnGroundingSelection {
  const all = [...new Set([...conversationFiles, ...attachedNow])]
  const named = all.filter((f) => mentions(prompt, f))

  if (attachedNow.length > 0) {
    // Both: attaching a file and asking how it compares to a named earlier one
    // is a real question, and answering it needs both documents.
    const active = [...new Set([...attachedNow, ...named])]
    return {
      active,
      reason: named.length > attachedNow.length ? 'named_in_prompt' : 'attached_this_turn',
      withheld: all.filter((f) => !active.includes(f)),
    }
  }

  if (named.length > 0) {
    return { active: named, reason: 'named_in_prompt', withheld: all.filter((f) => !named.includes(f)) }
  }

  /*
   * 🚨 NOTHING ATTACHED AND NOTHING NAMED — THE NARROWEST HONEST ANSWER.
   *
   * This returned the WHOLE conversation set, which is how "what did we discuss
   * earlier about the first PDF?" came back citing an unrelated six-page scan
   * alongside the right file. Correct answer, over-broad evidence — and
   * "reactivating every historical file indiscriminately" is exactly what this
   * module exists to stop.
   *
   * One file in the thread is unambiguous: "summarise it" means that one, and
   * grounding on nothing would replace contamination with amnesia.
   *
   * With several, the MOST RECENT is the only defensible guess — "it", "this
   * file" and "the document" almost always mean the one just discussed — and it
   * is bounded to a single document either way. A question genuinely about an
   * older file is served by naming it, which rule 2 already honours, or by
   * conversation history, which now actually works.
   */
  if (all.length <= 1) {
    return { active: [...all], reason: all.length === 1 ? 'conversation_default' : 'none', withheld: [] }
  }

  /*
   * 🚨 "MOST RECENT" MEANS THE MOST RECENT ATTACHMENT, NOT THE LAST FILENAME.
   *
   * THE DEFECT. A contract and a rate-review workbook were attached TOGETHER and
   * compared successfully — `attached_this_turn`, two files active. The very next
   * question, a follow-up about the same pair, came back
   * `conversation_default, active 1, withheld 1`: this rule kept the last name in
   * a flat list and silently dropped the other half of the set. The answer then
   * said the dropped file did not mention a figure printed on its page 3.
   *
   * Taking one file was right for what this rule was written for — a thread that
   * ACCUMULATED unrelated documents over a long session. It was never right for a
   * set the user attached in one action and is plainly still discussing.
   *
   * So the boundary is the attachment EVENT. Files written within moments of the
   * newest one arrived together and stay together; anything older stays out,
   * which is exactly what the original fix protects.
   *
   * Falls back to the last name when no timestamps are supplied, so a caller that
   * cannot provide them behaves as before rather than losing the narrowing.
   */
  const timeOf = (f: string): number | undefined => uploadedAt[f]
  const newest = all.reduce((best, f) => {
    const t = timeOf(f)
    if (t === undefined) return best
    const bt = best === undefined ? undefined : timeOf(best)
    return bt === undefined || t > bt ? f : best
  }, undefined as string | undefined)

  if (newest === undefined) {
    const mostRecent = all[all.length - 1]!
    return {
      active: [mostRecent],
      reason: 'conversation_default',
      withheld: all.filter((f) => f !== mostRecent),
    }
  }

  const newestAt = timeOf(newest)!
  const active = all.filter((f) => {
    const t = timeOf(f)
    return t !== undefined && newestAt - t <= CO_ATTACHED_WINDOW_MS
  })

  return {
    active,
    reason: 'conversation_default',
    withheld: all.filter((f) => !active.includes(f)),
  }
}
