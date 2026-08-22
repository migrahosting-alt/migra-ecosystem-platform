/**
 * The document library: real files, on disk, scoped to the caller.
 *
 * This replaced a page that accepted a file, threw its contents away, waited
 * 1400ms and then displayed "8 pages" — a number nothing had counted, about a
 * document nothing had read. Every number this route returns is measured.
 *
 * Files land in a per-user directory that the Brain can index directly; see
 * `src/server/files/storage.ts` for why that directory is the interface between
 * the two services and how tenancy is derived.
 */

import { requireSession } from '@/server/auth'
import { reindexLibrary } from '@/server/files/reindex'
import { UnauthenticatedError } from '@/server/auth/authPort'
import {
  ALLOWED_EXTENSIONS,
  FileRejected,
  MAX_FILE_BYTES,
  MAX_FILES,
  MAX_LIBRARY_BYTES,
  deleteFile,
  listFiles,
  saveFile,
} from '@/server/files/storage'

export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, message: string): Response =>
  Response.json({ error, message }, { status })

async function guard(): Promise<Response | null> {
  try {
    await requireSession()
    return null
  } catch (error) {
    if (error instanceof UnauthenticatedError) return fail(401, 'unauthenticated', 'Sign in to manage files.')
    throw error
  }
}

export async function GET(): Promise<Response> {
  const denied = await guard()
  if (denied) return denied

  const files = await listFiles()
  return Response.json({
    files,
    limits: {
      maxFileBytes: MAX_FILE_BYTES,
      maxLibraryBytes: MAX_LIBRARY_BYTES,
      maxFiles: MAX_FILES,
      allowedExtensions: ALLOWED_EXTENSIONS,
    },
    usedBytes: files.reduce((sum, file) => sum + file.bytes, 0),
  })
}

export async function POST(request: Request): Promise<Response> {
  const denied = await guard()
  if (denied) return denied

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return fail(400, 'invalid_body', 'Expected a multipart upload.')
  }

  const entries = form.getAll('file').filter((entry): entry is File => entry instanceof File)
  if (entries.length === 0) return fail(400, 'no_file', 'No file was provided.')

  // Per-file outcomes: one rejected file must not discard the accepted ones.
  const saved: { name: string; bytes: number }[] = []
  const rejected: { name: string; error: string; message: string }[] = []

  for (const entry of entries) {
    try {
      const stored = await saveFile(entry.name, await entry.arrayBuffer())
      saved.push({ name: stored.name, bytes: stored.bytes })
    } catch (error) {
      if (error instanceof FileRejected) {
        rejected.push({ name: entry.name, error: error.code, message: error.message })
      } else {
        rejected.push({ name: entry.name, error: 'write_failed', message: 'That file could not be saved.' })
      }
    }
  }

  return Response.json({ saved, rejected }, { status: rejected.length && !saved.length ? 400 : 200 })
}

export async function DELETE(request: Request): Promise<Response> {
  const denied = await guard()
  if (denied) return denied

  const name = new URL(request.url).searchParams.get('name')
  if (!name) return fail(400, 'no_name', 'A file name is required.')

  try {
    const removed = await deleteFile(name)
    if (!removed) return fail(404, 'not_found', 'That file is not in your library.')

    /*
     * DELETION IS NOT DONE UNTIL THE CONTENT IS UNANSWERABLE.
     *
     * The bytes are gone, but retrieval serves the APPROVED index version, which still
     * holds this file's chunks. Measured in production: the question right after a delete
     * answered from the deleted file and cited it by name. Re-reading and re-promoting the
     * library is what removes it from what can be retrieved.
     */
    const reindexed = await reindexLibrary()
    if (!reindexed.ok) {
      // The file IS deleted; what failed is making that true for search. Say so rather
      // than reporting a clean delete the index will contradict on the next question.
      return Response.json(
        {
          deleted: name,
          searchPurged: false,
          message:
            'The file was deleted, but your search index could not be updated, so its ' +
            'contents may still appear in answers until indexing runs again.',
        },
        { status: 207 },
      )
    }

    return Response.json({ deleted: name, searchPurged: true })
  } catch (error) {
    if (error instanceof FileRejected) return fail(400, error.code, error.message)
    throw error
  }
}
