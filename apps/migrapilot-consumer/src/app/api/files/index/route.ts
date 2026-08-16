/**
 * Index the caller's document library so the assistant can actually read it.
 *
 * This is what the old "Analyze" button pretended to be. That button set a flag
 * after a 1200ms timer and then rendered invented findings from `mock.ts`;
 * nothing was ever read. Here, the Brain genuinely walks the user's directory,
 * chunks and embeds what it finds, and reports counts it measured.
 *
 * `POST` creates the index if the caller has none, then syncs it. Sync is
 * incremental, so re-running after an upload is the normal path rather than a
 * rebuild.
 *
 * The index root is derived from the session inside `userDirectory()` and is
 * never accepted from the request — a browser-supplied path would turn this
 * into an arbitrary-directory reader.
 */

import { requireSession } from '@/server/auth'
import { UnauthenticatedError } from '@/server/auth/authPort'
import { callBrain } from '@/server/brain/gateway'
import { userDirectory } from '@/server/files/storage'

export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

interface IndexRecord {
  id?: string
  root?: string
  state?: string
  stats?: Record<string, unknown>
}

/** The caller's own docs index, if one exists. Never another scope's. */
async function findIndex(root: string): Promise<IndexRecord | null> {
  const listed = await callBrain<{ indexes?: IndexRecord[] }>({ kind: 'listIndexes' })
  if (listed.kind !== 'ok') return null
  return (listed.value?.indexes ?? []).find((index) => index.root === root) ?? null
}

export async function GET(): Promise<Response> {
  try {
    await requireSession()
  } catch (error) {
    if (error instanceof UnauthenticatedError) return fail(401, 'unauthenticated', 'Sign in to view your library.')
    throw error
  }

  const root = await userDirectory()
  const existing = await findIndex(root)
  if (!existing?.id) return Response.json({ indexed: false })

  const status = await callBrain<Record<string, unknown>>({ kind: 'indexStatus', indexId: existing.id })
  if (status.kind !== 'ok') return Response.json({ indexed: false })

  // Only counts and state are relayed. The root is this server's filesystem
  // layout and is of no use to a browser.
  const value = status.value as { state?: string; stats?: Record<string, unknown> }
  const state = value?.state ?? existing.state ?? null
  return Response.json({
    indexed: true,
    // Only an approved index is reachable by grounding, so anything else is
    // indexed-but-not-searchable and must not be reported as ready.
    searchable: state === 'approved',
    state,
    stats: value?.stats ?? existing.stats ?? null,
  })
}

export async function POST(): Promise<Response> {
  try {
    await requireSession()
  } catch (error) {
    if (error instanceof UnauthenticatedError) return fail(401, 'unauthenticated', 'Sign in to index your library.')
    throw error
  }

  const root = await userDirectory()

  let indexId = (await findIndex(root))?.id
  if (!indexId) {
    const created = await callBrain<IndexRecord>({ kind: 'createDocsIndex', root })
    if (created.kind !== 'ok') {
      return fail(created.kind === 'unauthenticated' ? 401 : 502, 'index_failed', 'Your library could not be prepared.')
    }
    indexId = created.value?.id
    if (!indexId) return fail(502, 'index_failed', 'Your library could not be prepared.')
  }

  const synced = await callBrain<{ ok?: boolean; index?: IndexRecord }>({ kind: 'syncIndex', indexId })
  if (synced.kind !== 'ok') {
    return fail(
      synced.kind === 'timeout' ? 504 : 502,
      'sync_failed',
      'Your files could not be read. Nothing was indexed.',
    )
  }

  /*
   * Promote to `approved`, or the index is inert.
   *
   * The Brain grounds a chat turn from `approvedIndexFor(scope)`, which ignores
   * any index without an approved version. A synced-but-unpromoted index is
   * therefore searchable by nothing: "Ask about these files" would return an
   * answer the model invented, with the user believing their documents had been
   * read. Promotion is what makes the Files promise true.
   *
   * Safe to promote automatically here, and only here, because the index is a
   * single user's own uploaded documents — not a shared repository whose
   * promotion is a governance decision. Its scope is that user's alone; see
   * `tenancy/ownerScope.ts` for why the workspace had to become per-user before
   * this could be true.
   */
  const approved = await callBrain<IndexRecord>({ kind: 'approveIndex', indexId })
  // Promotion is what makes an index reachable by grounding, and a silent
  // failure here is indistinguishable from a model that ignored the documents.
  console.info(
    '[files] index promotion',
    JSON.stringify({ indexId, outcome: approved.kind, record: approved.kind === 'ok' ? approved.value : undefined }),
  )
  if (approved.kind !== 'ok') {
    // Indexed but not searchable — say exactly that rather than claim success.
    return Response.json(
      {
        indexed: true,
        searchable: false,
        message: 'Your files were read but could not be made searchable yet.',
        state: synced.value?.index?.state ?? null,
        stats: synced.value?.index?.stats ?? null,
      },
      { status: 200 },
    )
  }

  const record = approved.value ?? synced.value?.index
  return Response.json({
    indexed: true,
    searchable: true,
    state: record?.state ?? null,
    stats: record?.stats ?? synced.value?.index?.stats ?? null,
  })
}
