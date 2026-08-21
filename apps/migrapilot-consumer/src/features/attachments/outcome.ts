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
  | { state: 'unsearchable'; reason: string }
  | { state: 'failed'; reason: string }

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
  if (rejected) return { state: 'failed', reason: rejected.message }

  // A guard denial (401) has neither saved nor rejected — it must not be read as success.
  if (response.error) {
    return { state: 'failed', reason: response.message ?? `Upload refused: ${response.error}.` }
  }

  const saved = response.saved?.[0]
  if (!saved) return { state: 'failed', reason: 'The server did not confirm the file was saved.' }

  // Stored is NOT ready. Indexing decides whether the Brain can actually read it.
  return { state: 'indexing', name: saved.name, bytes: saved.bytes }
}

export interface IndexResponse {
  searchable?: boolean
  message?: string
}

/**
 * `searchable` must be EXACTLY true to become ready.
 *
 * The index route reports `searchable: false` for a file it read but could not make
 * answerable, and treating anything truthy — or a missing field — as success is precisely
 * how "your file is ready" gets said about a file no question can reach.
 */
export function outcomeOfIndex(ok: boolean, response: IndexResponse): AttachmentOutcome {
  if (!ok) {
    return { state: 'unsearchable', reason: response.message ?? 'Indexing failed.' }
  }
  if (response.searchable === true) return { state: 'ready' }
  return {
    state: 'unsearchable',
    reason: response.message ?? 'Your file was stored but could not be made searchable.',
  }
}
