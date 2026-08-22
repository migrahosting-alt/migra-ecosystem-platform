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
  /**
   * Available files the approved index holds NO chunks for.
   *
   * They are stored and retained, but nothing can be answered from them. Kept separate from
   * `missing` because the file has not been deleted — it simply has no readable content.
   */
  unreadable: string[]
  /** Names dropped because the file no longer exists. */
  missing: string[]
  /**
   * The library could not be read AT ALL, so nothing here is a fact about it.
   *
   * Kept separate from `missing` because the two demand opposite durable actions.
   * A missing file is GONE and must leave the set permanently. An unreadable
   * library says only that we could not look — the files are probably still
   * there, and erasing the set would destroy the user's own choice over a
   * transient fault. Callers must not persist any set derived from this.
   */
  libraryUnreadable: boolean
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

/**
 * Whether the index can serve at all, and per-file counts when the Brain reports them.
 *
 * The two are SEPARATE on purpose. Tying searchability to the presence of counts made an
 * older Brain — one that does not report them — look completely unsearchable, which would
 * have silently ungrounded every conversation on a version skew. Approval decides whether
 * anything can be served; counts only refine WHICH files are readable.
 */
async function approvedIndexState(): Promise<{ approved: boolean; counts: Record<string, number> | null }> {
  const root = await userDirectory()
  const listed = await callBrain<{ indexes?: IndexRecord[] }>({ kind: 'listIndexes' })
  if (listed.kind !== 'ok') return { approved: false, counts: null }
  const index = (listed.value?.indexes ?? []).find((i) => i.root === root)
  if (!index?.id) return { approved: false, counts: null }
  const status = await callBrain<{ state?: string; chunkCounts?: Record<string, number> }>({
    kind: 'indexStatus',
    indexId: index.id,
  })
  if (status.kind !== 'ok') return { approved: false, counts: null }
  // Only an APPROVED index is reachable by grounding. Anything else is
  // indexed-but-not-searchable and must never be treated as ready.
  const approved = (status.value?.state ?? index.state) === 'approved'
  return { approved, counts: status.value?.chunkCounts ?? null }
}

export async function reconcileGrounding(requested: string[]): Promise<GroundingReconciliation> {
  if (requested.length === 0) {
    return { available: [], missing: [], unreadable: [], searchable: false, grounded: false, libraryUnreadable: false }
  }

  /*
   * FAIL CLOSED, BUT DO NOT FORGET.
   *
   * An unreadable library is not evidence that the files are gone, and a chat turn
   * must not 500 because storage hiccuped — so this turn grounds nothing.
   *
   * What it must NOT do is report the names as `missing`. It used to, and the
   * caller treats `missing` as "deleted, drop it permanently" — so one transient
   * read failure ERASED the conversation's durable grounding set for good. Proven
   * on the canary: with the upload root unreadable for a single turn, a grounded
   * conversation lost its document, and restoring the library did not bring it
   * back. The user had to re-attach a file they had never removed.
   *
   * Nothing is known to be missing here, because nothing could be read.
   */
  const listed = await listFiles().catch(() => null)
  if (listed === null) {
    return {
      available: [],
      missing: [],
      unreadable: [],
      searchable: false,
      grounded: false,
      libraryUnreadable: true,
    }
  }
  const present = new Set(listed.map((f) => f.name))
  const available = requested.filter((name) => present.has(name))
  const missing = requested.filter((name) => !present.has(name))
  const state = available.length > 0 ? await approvedIndexState() : { approved: false, counts: null }
  const searchable = state.approved
  const counts = state.counts

  /*
   * A file with zero chunks is retained but unreadable.
   *
   * Unknown counts are NOT treated as zero: an older Brain that does not report them would
   * otherwise mark every attachment unreadable. Absent means "cannot tell", and the turn
   * proceeds as before.
   */
  // Omitted, not zero: the indexer never adds a file that yielded nothing, so a name
  // missing from a PRESENT map is the index saying it holds nothing for that file.
  const unreadable = counts ? available.filter((name) => (counts[name] ?? 0) === 0) : []

  return {
    available,
    missing,
    unreadable,
    searchable,
    grounded: available.length > 0 && searchable,
    libraryUnreadable: false,
  }
}
