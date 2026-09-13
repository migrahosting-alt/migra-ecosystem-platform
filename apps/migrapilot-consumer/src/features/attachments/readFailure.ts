/**
 * SIX DIFFERENT FACTS WERE ARRIVING AS ONE SENTENCE.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT THIS EXISTS TO STOP
 *
 * A damaged file, a scan with no text layer, a password-protected file, a file
 * past the parser ceiling, a genuinely empty document, and A SERVER MISSING ITS
 * PDF RENDERER all produce the same thing downstream: zero indexed chunks. All
 * six were then reported with one sentence:
 *
 *   "No readable content was found in <file>, so there is nothing to answer
 *    from. Attach a file with text in it, or ask about a different document."
 *
 * The renderer case is why this is not cosmetic. The reader had already
 * recorded, in its own words:
 *
 *   failureReason: "the page renderer is not available on this server"
 *
 * It knew the file was fine and the SERVER was not. The chat path discarded
 * that and told the user their document was empty and to attach a different
 * one. One of those sends a person to re-scan a perfectly good book; the other
 * is an operator's job and the user should do nothing at all.
 *
 * ---------------------------------------------------------------------------
 * 🚨 KEYED ON THE STATE, NEVER ON THE PROSE
 *
 * The typed image error taught this the expensive way: the refusal was mapped
 * by matching its MESSAGE, both halves were deployed, and the browser still got
 * `brain_error` because the real path carried a CODE and the text never
 * matched. A message string is not a contract. Every decision here reads
 * `state`; `failureReason` is only ever rendered, never parsed.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE READER'S OWN SENTENCE WINS
 *
 * Where the reader supplied a `failureReason`, that is the reason shown. The
 * defaults below exist for when it did not. This is the same rule capability
 * answers follow: a fact the system holds exactly must not be re-authored on
 * the way out, because a second version of it is how two surfaces start
 * disagreeing.
 */

/** What the reader concluded about one file. `state` is the contract. */
export interface ReadFailure {
  name: string
  state: string
  /** The reader's own sentence, where it supplied one. Rendered, never parsed. */
  failureReason?: string
}

export interface ReadFailureAnswer {
  error: string
  message: string
}

/**
 * Each way a document can fail to be read, and what it means for the person.
 *
 * `advice` is the half that makes the distinction worth drawing: three of these
 * are the user's to act on, one is an operator's, and one asks them to do
 * nothing at all. Collapsing them into a single sentence removed exactly that.
 */
export const READ_FAILURE: Record<string, { code: string; reason: string; advice: string }> = {
  reader_unavailable: {
    code: 'document_reader_unavailable',
    reason: 'the document reader is not available on this server',
    advice: 'Nothing is wrong with your file — this one is ours to fix, not yours.',
  },
  no_text_layer: {
    code: 'pdf_has_no_text_layer',
    reason: 'it has no text layer — the pages are images of text rather than text',
    advice: 'Reading it needs text recognition, which is not available here yet.',
  },
  ocr_failed: {
    code: 'pdf_text_not_recognised',
    reason: 'its pages were rendered, but no readable text could be recognised from them',
    advice: 'A clearer scan, or a copy with a real text layer, would be readable.',
  },
  corrupt: {
    code: 'document_corrupt',
    reason: 'the file is damaged and could not be opened',
    advice: 'Re-export or download it again and attach the new copy.',
  },
  encrypted: {
    code: 'document_encrypted',
    reason: 'it is password-protected, so its text cannot be read',
    advice: 'Remove the password and attach it again.',
  },
  too_large_to_process: {
    code: 'file_too_large_to_read',
    reason: 'it is larger than this server will load into the parser in one piece',
    advice: 'Split it and attach the part you need.',
  },
}

/**
 * The truthful refusal for a set of unreadable files, or `null`.
 *
 * 🚨 `null` IS THE HONEST ANSWER WHEN THE READER DID NOT EXPLAIN ITSELF.
 *
 * It returns a verdict only when EVERY unreadable file has a recognised one.
 * A partial set would mean stating one file's cause and letting it stand for
 * files whose cause is unknown — which is the same defect being fixed, with a
 * more specific sentence. The caller falls back to the generic wording, which
 * claims less.
 */
export function describeReadFailures(
  unreadable: readonly string[],
  failures: readonly ReadFailure[],
): ReadFailureAnswer | null {
  if (unreadable.length === 0) return null

  const classified = unreadable
    .map((name) => {
      const found = failures.find((f) => f.name === name)
      const klass = found ? READ_FAILURE[found.state] : undefined
      return klass ? { name, klass, failureReason: found?.failureReason } : null
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  if (classified.length !== unreadable.length) return null

  const codes = new Set(classified.map((c) => c.klass.code))
  const lines = classified.map(
    (c) => `${c.name}: ${c.failureReason ?? c.klass.reason}. ${c.klass.advice}`,
  )

  return {
    // One cause means one code. Mixed causes must not pick a winner and let it
    // stand for files it does not describe.
    error: codes.size === 1 ? [...codes][0]! : 'documents_could_not_be_read',
    message:
      lines.length === 1
        ? lines[0]!
        : ['These files could not be read, for different reasons:', '', ...lines.map((l) => `• ${l}`)].join('\n'),
  }
}
