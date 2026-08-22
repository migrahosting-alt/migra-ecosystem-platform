import 'server-only'

import { callBrain } from '@/server/brain/gateway'
import { userDirectory } from '@/server/files/storage'

/**
 * Re-read the library and promote the result, so the served index matches the disk.
 *
 * 🚨 WHY DELETION NEEDS THIS. Removing a file deletes the bytes, the library entry, and the
 * name from any conversation that reconciles afterwards — but retrieval is served from the
 * APPROVED VERSION of the index, and that version still holds the file's chunks. Measured on
 * production: after deleting ground-alpha.json the very next question answered
 * "PURPLE FALCON 331" and cited `ground-alpha.json:1-6`, a file the user had just deleted.
 *
 * That is a data-retention failure, not a cosmetic one. A user who deletes a document has
 * every reason to believe its contents are gone.
 *
 * Sync already drops files that have disappeared from the source — the gap was that nothing
 * ran it on delete, and an unpromoted sync changes nothing because grounding reads the
 * approved version. So deletion reuses the exact path that made the file searchable in the
 * first place, rather than a bespoke purge that could leave the candidate and approved
 * indexes disagreeing.
 */
export interface ReindexOutcome {
  ok: boolean
  /** Present when the library could not be re-read or re-promoted. */
  reason?: string
}

interface IndexRecord {
  id?: string
  root?: string
}

export async function reindexLibrary(): Promise<ReindexOutcome> {
  const root = await userDirectory()

  const listed = await callBrain<{ indexes?: IndexRecord[] }>({ kind: 'listIndexes' })
  if (listed.kind !== 'ok') return { ok: false, reason: `indexes unavailable (${listed.kind})` }

  const indexId = (listed.value?.indexes ?? []).find((i) => i.root === root)?.id
  // No index means nothing was ever searchable, so there is nothing to purge.
  if (!indexId) return { ok: true }

  const synced = await callBrain({ kind: 'syncIndex', indexId })
  if (synced.kind !== 'ok') return { ok: false, reason: `sync failed (${synced.kind})` }

  // Without promotion the deleted file remains in the APPROVED version and stays
  // answerable — the whole point of running this.
  const approved = await callBrain({ kind: 'approveIndex', indexId })
  if (approved.kind !== 'ok') return { ok: false, reason: `promotion failed (${approved.kind})` }

  return { ok: true }
}
