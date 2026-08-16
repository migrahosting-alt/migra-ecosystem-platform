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
  return Response.json({
    indexed: true,
    state: value?.state ?? existing.state ?? null,
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

  const record = synced.value?.index
  return Response.json({ indexed: true, state: record?.state ?? null, stats: record?.stats ?? null })
}
