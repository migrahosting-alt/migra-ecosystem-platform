import { INDEXED_EXTENSIONS, contentMismatch, refusalFor } from '@/features/attachments/capability'
import 'server-only'

import { createHash } from 'node:crypto'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { requireSession } from '@/server/auth'
import { deriveBrainScope } from '@/server/tenancy/ownerScope'

/**
 * Per-user document storage, on disk, shared with the Brain.
 *
 * The consumer and the Brain run as the same service account on the same host,
 * and the Brain already holds `/var/lib/migrapilot` as a writable path. That is
 * what makes real ingestion possible without an object store: the consumer
 * writes a file here and the Brain indexes the very same directory.
 *
 * The Brain's RAG indexes are rooted at a FILESYSTEM PATH — there is no
 * content-upload endpoint on it — so this directory is the interface between
 * the two services.
 *
 * TENANCY. The directory is derived from the verified session and nothing else.
 * No argument to this module can influence which directory is used, so one
 * user's upload cannot land in, or be listed from, another user's namespace.
 */

/** Matches the Brain's own writable root (`migrapilot-brain.service`). */
/**
 * Read at CALL time, not at module load.
 *
 * ESM hoists imports, so a test that sets UPLOAD_ROOT in its body was already too late —
 * this module had captured the production default before the assignment ran, and the tests
 * quietly exercised the fail-closed path instead of the real directory. Resolving lazily
 * costs nothing and removes an import-order trap.
 */
const uploadRoot = (): string => process.env.UPLOAD_ROOT ?? '/var/lib/migrapilot/uploads'

/**
 * What the Brain's indexer can actually read.
 *
 * Deliberately NOT pdf/docx/xlsx. `apps/brain-service/src/engine/rag/exclusions.ts`
 * excludes PDF as a binary extension, and the zip-based Office formats would
 * index as garbage. Accepting them would put a file in the user's library that
 * silently contributes nothing to an answer — the storage-layer equivalent of
 * fabricating a capability. Extraction is a separate slice.
 */
/*
 * 🚨 DERIVED, NOT DECLARED. This set used to be written out by hand beside a
 * separately hand-written picker list, and the two drifted until the product
 * offered 48 file types and accepted 27. Both now come from one definition, so
 * they cannot disagree again — see features/attachments/capability.ts for why a
 * type is or is not on it.
 */
const ALLOWED = new Set<string>(INDEXED_EXTENSIONS)

/*
 * `sql` AND `env` WERE REMOVED FROM THE LIST ABOVE, and the omission is the point.
 *
 * Both were accepted here and then silently discarded by the indexer, which
 * treats `*.sql` as a database dump and a bare `.env` as a secret. A user could
 * upload `schema.sql`, watch it land in their library, and receive answers that
 * had never read a line of it — the exact failure the comment above forbids.
 * `.env` was stranger still: `prod.env` indexed fine while `.env` did not, so
 * the outcome turned on whether the file happened to have a stem.
 *
 * Refusing them is the honest state, not the desired one. A user asking about
 * their own schema is a reasonable thing to want, and the indexer's rule exists
 * for scanning REPOSITORIES, where skipping dumps and secrets is correct — it is
 * not obviously right for a document someone deliberately uploaded. Re-admitting
 * them means deciding that question, with the credential-exposure risk in view,
 * rather than quietly widening a list.
 *
 * `test/uploadIndexerAgreement.test.ts` in brain-service holds the two lists
 * together so they cannot drift apart again.
 */

export const ALLOWED_EXTENSIONS = [...ALLOWED].sort()

/** A single upload, and the whole library, are both bounded. */
/*
 * Limits are CONFIGURABLE and deliberately generous. Real documents — a scanned
 * book, a long report — routinely exceed the 2MB this used to allow, and a cap
 * that rejects the user's actual file is a cap in the wrong place.
 *
 * They are not removed entirely, and that is an engineering judgement rather
 * than timidity: extraction loads the whole file into memory, so a genuinely
 * unbounded upload can exhaust the process and take chat down for EVERY user,
 * not just the one who uploaded it. The ceiling is therefore high enough not to
 * be met in normal use and low enough to keep one upload from ending the
 * service — and it is one environment variable away from anything else.
 */
const megabytes = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed * 1024 * 1024 : fallback * 1024 * 1024
}

export const MAX_FILE_BYTES = megabytes(process.env.MIGRAPILOT_MAX_FILE_MB, 1024)
export const MAX_LIBRARY_BYTES = megabytes(process.env.MIGRAPILOT_MAX_LIBRARY_MB, 20 * 1024)
export const MAX_FILES = Number(process.env.MIGRAPILOT_MAX_FILES) || 2000

/*
 * STORABLE AND PARSEABLE ARE DIFFERENT LIMITS, and conflating them was a real
 * mistake in the previous change.
 *
 * How much MigraPilot may RETAIN is a storage question. How much it may PARSE is
 * a question about the process doing the parsing — and extraction currently
 * loads the whole file into memory inside the synchronous Brain, so a single
 * enormous document could exhaust it and end chat for every user. Raising both
 * numbers together made a storage decision on the service's behalf.
 *
 * A file may therefore be perfectly storable without being safe to parse yet.
 * Above this ceiling the file is KEPT and reported as unprocessed rather than
 * pushed through the parser, and the ceiling rises when streaming or chunked
 * parsing or worker isolation exists — not before.
 *
 * The Brain reads the same env var and default, so the two sides cannot drift
 * apart quietly; `uploadIndexerAgreement` holds them to it.
 */
export const MAX_EXTRACT_BYTES = megabytes(process.env.MIGRAPILOT_MAX_EXTRACT_MB, 25)

export class FileRejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'FileRejected'
  }
}

export interface StoredFile {
  name: string
  bytes: number
  updatedAt: number
  /**
   * Stored, but beyond what the parser may safely load — so NOT indexed.
   *
   * Present so the gap can never be silent. The file is genuinely kept and the
   * user's copy is intact; what is untrue is any claim that MigraPilot can
   * answer from it, and a caller that cannot see this flag would make exactly
   * that claim.
   */
  tooLargeToProcess?: boolean
}

export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/**
 * The caller's directory, created on demand.
 *
 * The owner scope is hashed rather than used directly: it is a canonical
 * identifier, not a path component, and hashing means no identifier shape can
 * ever produce a directory separator or a relative segment.
 */
export async function userDirectory(): Promise<string> {
  const session = await requireSession()
  const scope = deriveBrainScope(session)
  const bucket = createHash('sha256').update(scope.owner).digest('hex').slice(0, 32)
  const dir = join(uploadRoot(), bucket)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  return dir
}

/**
 * Reduce a client-supplied filename to a safe basename.
 *
 * Traversal is defeated structurally rather than by blocklist: every path
 * separator is stripped, so `../../etc/passwd` becomes `etcpasswd` and cannot
 * escape the directory even in principle. The result is re-checked against the
 * resolved directory by the caller.
 */
export function safeName(raw: string): string {
  const base = raw.replace(/[/\\]/g, '').replace(/^\.+/, '').trim()
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120)
  if (!cleaned || cleaned === '.' || cleaned === '..') {
    throw new FileRejected('invalid_name', 'That file name cannot be used.')
  }
  return cleaned
}

export async function listFiles(): Promise<StoredFile[]> {
  const dir = await userDirectory()
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])

  const files: StoredFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const info = await stat(join(dir, entry.name)).catch(() => null)
    if (!info) continue
    files.push({
      name: entry.name,
      bytes: info.size,
      updatedAt: info.mtimeMs,
      ...(info.size > MAX_EXTRACT_BYTES ? { tooLargeToProcess: true } : {}),
    })
  }
  return files.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveFile(rawName: string, data: ArrayBuffer): Promise<StoredFile> {
  const name = safeName(rawName)
  const extension = extensionOf(name)

  if (!ALLOWED.has(extension)) {
    /*
     * The reason comes from the same definition that decides selectability, so
     * a refusal can be SPECIFIC: "export the sheet as CSV" is actionable where
     * "unsupported file type" is not, and the two can never describe different
     * rules.
     */
    throw new FileRejected('unsupported_type', refusalFor(name))
  }

  /*
   * THE NAME IS A CLAIM; THE BYTES ARE THE EVIDENCE. An .xlsx renamed to .csv
   * passed the check above and stored an archive as a text file, which the
   * indexer then skipped — accepted in the library, unreadable in every answer.
   */
  const mismatch = contentMismatch(name, new Uint8Array(data.slice(0, 512)))
  if (mismatch) throw new FileRejected('unsupported_type', mismatch)
  if (data.byteLength === 0) throw new FileRejected('empty_file', 'That file is empty.')
  if (data.byteLength > MAX_FILE_BYTES) {
    const limitMb = MAX_FILE_BYTES / 1024 / 1024
    const readable = limitMb >= 1024 ? `${(limitMb / 1024).toFixed(0)} GB` : `${limitMb} MB`
    throw new FileRejected('too_large', `Files are limited to ${readable}.`)
  }

  const dir = await userDirectory()
  const existing = await listFiles()
  const replacing = existing.find((file) => file.name === name)

  if (!replacing && existing.length >= MAX_FILES) {
    throw new FileRejected('too_many', `You can keep up to ${MAX_FILES} files. Delete some first.`)
  }
  const totalAfter =
    existing.reduce((sum, file) => sum + file.bytes, 0) - (replacing?.bytes ?? 0) + data.byteLength
  if (totalAfter > MAX_LIBRARY_BYTES) {
    throw new FileRejected('library_full', 'Your library is full. Delete some files first.')
  }

  // Defence in depth: even with `safeName`, never write outside the directory.
  const target = resolve(dir, name)
  if (!target.startsWith(resolve(dir) + '/')) {
    throw new FileRejected('invalid_name', 'That file name cannot be used.')
  }

  await writeFile(target, Buffer.from(data), { mode: 0o600 })
  return { name, bytes: data.byteLength, updatedAt: Date.now() }
}

export async function deleteFile(rawName: string): Promise<boolean> {
  const name = safeName(rawName)
  const dir = await userDirectory()
  const target = resolve(dir, name)
  if (!target.startsWith(resolve(dir) + '/')) return false

  const info = await stat(target).catch(() => null)
  if (!info?.isFile()) return false

  await rm(target, { force: true })
  return true
}
