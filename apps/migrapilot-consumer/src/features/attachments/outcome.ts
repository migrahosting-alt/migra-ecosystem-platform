import { canAnalyzeStructurally, canIndex, extensionOf } from './capability'

/**
 * Server response → what the user is told. Pure, so it can be tested.
 *
 * This mapping is the truth-critical part of an attachment. The network calls are plumbing;
 * this is where "uploaded" could quietly become "ready", or a half-success could be rounded
 * up to a tick. Keeping it as pure functions means the rules are checked directly instead of
 * being inferred from a rendered chip.
 */

export type AttachmentOutcome =
  | { state: 'indexing'; name: string; bytes: number }
  | { state: 'ready' }
  /** Stored, being read in the background, not usable YET. Worth waiting for. */
  | { state: 'processing'; reason: string }
  | { state: 'unsearchable'; reason: string }
  /**
   * Stored and ANALYSABLE, but never prose-indexed. A workbook.
   *
   * Distinct from `unsearchable`, which means the file cannot contribute at all.
   * A structured file answers questions about totals, columns and sheets — it
   * just holds no index chunks, so it looked identical to an empty upload and
   * was described as having "no readable content … cannot be used to answer
   * questions". Both halves of that sentence were false about a workbook whose
   * Revenue column the product had already totalled correctly.
   */
  | { state: 'structured'; reason: string }
  | { state: 'failed'; reason: string; retryable: boolean }

/**
 * 🚨 FAILURES THAT THE SAME BYTES CAN NEVER SURVIVE.
 *
 * Every failed attachment used to offer Retry, including a file rejected for
 * being too large. Retrying identical bytes against an unchanged limit cannot
 * succeed — the button was an invitation to fail again, and it hid the only
 * thing that would actually help: pick a different file.
 *
 * These three are properties OF THE FILE, so no number of attempts changes the
 * answer. Everything else — a write that failed, a library that is full, a
 * connection that dropped, a server that was briefly unwell — describes a
 * MOMENT, and a second attempt may genuinely land. That is the line: retry is
 * offered when the same bytes could plausibly pass later, and withheld when
 * they provably cannot.
 */
const PERMANENT_REJECTIONS = new Set(['too_large', 'unsupported_type', 'empty_file'])

export function isPermanentRejection(code: string | undefined): boolean {
  return code !== undefined && PERMANENT_REJECTIONS.has(code)
}

export interface UploadResponse {
  saved?: { name: string; bytes: number }[]
  rejected?: { name: string; error: string; message: string }[]
  /** Present on a guard denial, e.g. { error: 'unauthenticated', message: '...' }. */
  error?: string
  message?: string
}

/**
 * A rejection is reported in the SERVER'S OWN WORDS. It knows which limit was hit —
 * extension, per-file size, library size, file count — and paraphrasing it in the client
 * is how the two drift until the message names the wrong rule.
 */
export function outcomeOfUpload(response: UploadResponse): AttachmentOutcome {
  const rejected = response.rejected?.[0]
  if (rejected) {
    return {
      state: 'failed',
      reason: rejected.message,
      retryable: !isPermanentRejection(rejected.error),
    }
  }

  // A guard denial (401) has neither saved nor rejected — it must not be read as success.
  if (response.error) {
    // Signing in again and retrying is exactly what the user should do here.
    return {
      state: 'failed',
      reason: response.message ?? `Upload refused: ${response.error}.`,
      retryable: true,
    }
  }

  const saved = response.saved?.[0]
  if (!saved) {
    return {
      state: 'failed',
      reason: 'The server did not confirm the file was saved.',
      retryable: true,
    }
  }

  // Stored is NOT ready. Indexing decides whether the Brain can actually read it.
  return { state: 'indexing', name: saved.name, bytes: saved.bytes }
}

export interface IndexResponse {
  searchable?: boolean
  message?: string
  /** Retrievable chunks PER FILE, from the approved index. */
  chunkCounts?: Record<string, number>
  /** Stored, but above the extraction ceiling — read but never parsed. */
  tooLargeToProcess?: string[]
  /** Being read by a background job right now. Not terminal. */
  processing?: string[]
}

/**
 * `searchable` must be EXACTLY true to become ready.
 *
 * The index route reports `searchable: false` for a file it read but could not make
 * answerable, and treating anything truthy — or a missing field — as success is precisely
 * how "your file is ready" gets said about a file no question can reach.
 */
export function outcomeOfIndex(ok: boolean, response: IndexResponse, fileName?: string): AttachmentOutcome {
  /*
   * 🚨 A STRUCTURED FILE IS DECIDED BEFORE THE INDEX IS CONSULTED AT ALL.
   *
   * It is never indexed, so every index answer about it is silence — and every
   * branch below reads silence as failure. Placed later, this lost twice in the
   * real product: the chip said "No readable content was found in this file, so
   * it cannot be used to answer questions", and after that was fixed it said
   * "Your files could not be read. Nothing was indexed." Both were false beside a
   * workbook the product was already totalling correctly.
   *
   * The index has nothing to say about this file. That is not a fault, and the
   * only truthful thing to report is what the file IS good for.
   */
  if (fileName && canAnalyzeStructurally(extensionOf(fileName)) && !canIndex(extensionOf(fileName))) {
    return {
      state: 'structured',
      reason: 'Ready for table analysis — totals, averages, columns and sheets. Text inside it is not searchable.',
    }
  }

  if (!ok) {
    return { state: 'unsearchable', reason: response.message ?? 'Indexing failed.' }
  }

  /*
   * READY IS A PER-FILE FACT, and `searchable` is a library-wide one.
   *
   * A whitespace-only upload was indexed "successfully" — the library was searchable, so
   * the chip said "Ready — MigraPilot can read this" — while the approved index held ZERO
   * chunks for that file. Nothing could ever be answered from it, and the refusal then told
   * the user to "try naming the document", which was impossible to satisfy.
   *
   * Counts are only consulted when the server actually reported them: an older server, or a
   * failure to read them back, leaves the field ABSENT, and absent must not be read as
   * "zero chunks" — that would mark every file unreadable on a version skew.
   */
  /*
   * 🚨 CHECKED FIRST, AHEAD OF THE CHUNK COUNT.
   *
   * A document being read in the background has no chunks yet, which is
   * indistinguishable from a document that yielded nothing — and the wrong
   * reading tells the user to abandon a file that is minutes from working. Being
   * read is the one non-terminal answer here, so it has to win.
   */
  if (fileName && response.processing?.includes(fileName)) {
    return {
      state: 'processing',
      reason: 'Reading this document — large files can take a few minutes.',
    }
  }

  /*
   * CHECKED BEFORE THE CHUNK COUNT, because a file the extractor never opened
   * is absent from `chunkCounts` and would otherwise be explained as having no
   * readable content — which is the opposite of true for a large document.
   */
  if (fileName && response.tooLargeToProcess?.includes(fileName)) {
    return {
      state: 'unsearchable',
      reason: 'This file is too large for MigraPilot to read yet. It is stored, but answers cannot use it.',
    }
  }

  if (response.searchable === true && fileName && response.chunkCounts) {
    /*
     * A file that yielded nothing is OMITTED from the map, not recorded as 0 — the indexer
     * never adds it. So "no readable content" is the ABSENCE OF THE KEY while the MAP IS
     * PRESENT, and checking only for a literal 0 let a whitespace-only upload keep showing
     * "Ready — MigraPilot can read this" after the per-file fix shipped.
     *
     * The two absences are different and must stay so: no `chunkCounts` OBJECT means an
     * older Brain that cannot tell us, and that still reads as ready. A missing KEY inside a
     * present map is the index saying it holds nothing for this file.
     */
    const chunks = response.chunkCounts[fileName] ?? 0
    if (chunks === 0) {
      return {
        state: 'unsearchable',
        reason: 'No readable content was found in this file, so it cannot be used to answer questions.',
      }
    }
  }

  if (response.searchable === true) return { state: 'ready' }
  return {
    state: 'unsearchable',
    reason: response.message ?? 'Your file was stored but could not be made searchable.',
  }
}
