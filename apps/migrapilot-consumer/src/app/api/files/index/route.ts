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
import { join } from 'node:path'
import { callBrain } from '@/server/brain/gateway'
import { userDirectory, listFiles } from '@/server/files/storage'
import { listProcessing, requestProcessing } from '@/server/files/documentProcessing'

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
  const value = status.value as {
    state?: string
    stats?: Record<string, unknown>
    chunkCounts?: Record<string, number>
    chunkIntegrity?: { loaded: number; recorded: number | null; contradictory: boolean }
  }
  const state = value?.state ?? existing.state ?? null
  return Response.json({
    indexed: true,
    // Only an approved index is reachable by grounding, so anything else is
    // indexed-but-not-searchable and must not be reported as ready.
    searchable: state === 'approved',
    state,
    stats: value?.stats ?? existing.stats ?? null,
    /*
     * PER-FILE readability, not a library-wide guess.
     *
     * `searchable` says the INDEX can serve answers; it says nothing about whether a
     * particular file contributed anything. A whitespace-only upload produced zero chunks
     * and the UI still showed "Ready — MigraPilot can read this" for it. A file is readable
     * only when the approved index holds chunks FOR THAT FILE.
     */
    chunkCounts: value?.chunkCounts ?? {},
    /*
     * Surfaced so a broken index is OBSERVABLE rather than merely handled.
     *
     * The chat path already refuses honestly when the index contradicts its own
     * record, but a refusal the user sees once and nobody can inspect afterwards
     * is not diagnosis. Relaying it here means the state can be read directly
     * while it is happening, which is what the untraced restart race needs.
     */
    chunkIntegrity: value?.chunkIntegrity ?? null,
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

  /*
   * Re-read the status to learn WHICH FILES the approved index actually holds chunks for.
   *
   * The promotion result says the index is servable; it does not say a given file
   * contributed anything. A whitespace-only upload indexed "successfully" and produced zero
   * chunks, and the composer still told the user "Ready — MigraPilot can read this". A
   * failure to read the counts leaves them ABSENT rather than assuming readiness.
   */
  const after = await callBrain<{ chunkCounts?: Record<string, number> }>({ kind: 'indexStatus', indexId })
  const chunkCounts = after.kind === 'ok' ? (after.value?.chunkCounts ?? {}) : {}

  /*
   * A PDF THE FAST PATH COULD NOT READ IS ESCALATED TO BACKGROUND OCR.
   *
   * The decision is made from EVIDENCE, not from the extension: a PDF with a
   * text layer has just been extracted and indexed in milliseconds and keeps
   * that route untouched. Only one that produced no chunks is handed to the
   * Brain's reader, because OCR costs minutes and spending them on a document
   * already read would be pure waste.
   *
   * Awaited only until the pending state is durable — the reading itself takes
   * minutes and happens after this response is long gone.
   */
  const uploadRoot = await userDirectory()
  const library = await listFiles().catch(() => [])

  /*
   * 🚨 TOO LARGE TO PARSE IS NOT "NOTHING TO READ", AND SAYING SO IS A LIE.
   *
   * A file above the extraction ceiling is stored, skipped by the extractor, and
   * therefore absent from `chunkCounts` — which the client reads as zero chunks
   * and reports as "No readable content was found in this file." For a 100 MB
   * PDF dense with text that explanation is simply false, and it points the user
   * at the one thing that is not wrong with their document.
   *
   * Naming these files explicitly matters more now than it did: while uploads
   * were capped near the extraction ceiling this band was a few megabytes wide.
   * Raising transport to 256 MB makes it the majority of what can be uploaded,
   * so the wrong explanation would become the common one.
   */
  /*
   * 🚨 A LARGE PDF IS NOW READ, NOT ABANDONED.
   *
   * This used to `continue` past anything above the synchronous extraction
   * ceiling, which is how a 35.5 MB PDF became a stored object no answer could
   * ever use. The ceiling protects the SYNCHRONOUS parser — it was never a
   * statement that the document is unreadable — so an oversized PDF goes to the
   * background reader, which extracts it a page at a time with `pdftotext` and
   * never holds the whole file in memory.
   *
   * The escalation rule is unchanged for everything else: a PDF the fast path
   * already read keeps its chunks and is left alone, because re-reading a
   * document that produced text would be pure waste.
   */
  for (const file of library) {
    if (!/\.pdf$/i.test(file.name)) continue
    if ((chunkCounts[file.name] ?? 0) > 0) continue
    await requestProcessing(file.name, join(uploadRoot, file.name)).catch(() => null)
  }

  /*
   * Reported ONLY for files nothing will read.
   *
   * A large PDF is no longer in this list — it is being processed, and saying
   * "too large to read" about a document actively being read would be the same
   * class of lie as the one this field was added to remove. Non-PDF files above
   * the ceiling have no background reader yet, so for those it stays true.
   */
  const processing = new Set(
    (await listProcessing().catch(() => [])).filter((p) => p.polling).map((p) => p.fileName),
  )
  const tooLargeToProcess = library
    .filter((file) => file.tooLargeToProcess && !/\.pdf$/i.test(file.name) && !processing.has(file.name))
    .map((file) => file.name)

  return Response.json({
    indexed: true,
    searchable: true,
    state: record?.state ?? null,
    stats: record?.stats ?? synced.value?.index?.stats ?? null,
    chunkCounts,
    tooLargeToProcess,
    /*
     * Documents a background reader is actively working on.
     *
     * The client needs this to tell three states apart that all look like "no
     * chunks yet": a file that yielded nothing readable, a file nothing will
     * ever read, and a file being read right now. Only the last one is worth
     * waiting for, and calling it "no readable content" — which is what happened
     * before this field existed — tells the user to give up on a document that
     * is about to work.
     */
    processing: [...processing],
  })
}
