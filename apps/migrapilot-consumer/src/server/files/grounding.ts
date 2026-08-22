import 'server-only'

import { callBrain } from '@/server/brain/gateway'
import { listFiles, userDirectory } from '@/server/files/storage'

/**
 * Reconcile a conversation's stored grounding set against what actually exists.
 *
 * 🚨 WHY THIS IS NOT OPTIONAL. The set is durable, so it outlives the files in it. Delete a
 * file from the library and the conversation still names it — and a set with one name in it
 * still says `grounded: true`, so the Brain would be told to answer from an approved index
 * that no longer holds that document. The user would get a refusal, or worse an answer, for
 * a file they deleted. Durable state that is never checked against reality is just a stale
 * claim with a database behind it.
 *
 * TWO KINDS OF ABSENCE, TREATED DIFFERENTLY, because they are not the same fact:
 *
 *   deleted        the file is gone from the library. It leaves the set PERMANENTLY, and
 *                  the corrected set is written back so the drift does not persist.
 *   not searchable the files are all still there, but the index is not approved. Nothing can
 *                  ground right now, yet the set must NOT be erased — searchability can come
 *                  back, and wiping it would silently discard the user's own choice.
 */
export interface GroundingReconciliation {
  /** Names still present in the library. */
  available: string[]
  /** Names dropped because the file no longer exists. */
  missing: string[]
  /** True when the index can actually serve a grounded answer. */
  searchable: boolean
  /** May this turn be grounded at all? */
  grounded: boolean
}

interface IndexRecord {
  id?: string
  root?: string
  state?: string
}

async function indexIsSearchable(): Promise<boolean> {
  const root = await userDirectory()
  const listed = await callBrain<{ indexes?: IndexRecord[] }>({ kind: 'listIndexes' })
  if (listed.kind !== 'ok') return false
  const index = (listed.value?.indexes ?? []).find((i) => i.root === root)
  if (!index?.id) return false
  const status = await callBrain<{ state?: string }>({ kind: 'indexStatus', indexId: index.id })
  // Only an APPROVED index is reachable by grounding. Anything else is
  // indexed-but-not-searchable and must never be treated as ready.
  const state = status.kind === 'ok' ? (status.value?.state ?? index.state) : index.state
  return state === 'approved'
}

export async function reconcileGrounding(requested: string[]): Promise<GroundingReconciliation> {
  if (requested.length === 0) {
    return { available: [], missing: [], searchable: false, grounded: false }
  }

  // FAIL CLOSED. If the library cannot be read at all we ground nothing rather than
  // trusting the stored names: an unreadable library is not evidence that the files are
  // there, and a chat turn must not 500 because storage hiccuped.
  const listed = await listFiles().catch(() => null)
  if (listed === null) {
    return { available: [], missing: requested, searchable: false, grounded: false }
  }
  const present = new Set(listed.map((f) => f.name))
  const available = requested.filter((name) => present.has(name))
  const missing = requested.filter((name) => !present.has(name))
  const searchable = available.length > 0 ? await indexIsSearchable() : false

  return { available, missing, searchable, grounded: available.length > 0 && searchable }
}
