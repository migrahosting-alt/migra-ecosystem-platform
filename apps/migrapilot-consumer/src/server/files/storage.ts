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
const ALLOWED = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'yaml', 'yml', 'toml', 'log',
  'html', 'xml', 'ts', 'tsx', 'js', 'jsx', 'py', 'rb', 'go', 'rs', 'java',
  'sh', 'sql', 'css', 'scss', 'ini', 'env', 'conf',
])

export const ALLOWED_EXTENSIONS = [...ALLOWED].sort()

/** A single upload, and the whole library, are both bounded. */
export const MAX_FILE_BYTES = 2 * 1024 * 1024
export const MAX_LIBRARY_BYTES = 50 * 1024 * 1024
export const MAX_FILES = 200

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
    files.push({ name: entry.name, bytes: info.size, updatedAt: info.mtimeMs })
  }
  return files.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function saveFile(rawName: string, data: ArrayBuffer): Promise<StoredFile> {
  const name = safeName(rawName)
  const extension = extensionOf(name)

  if (!ALLOWED.has(extension)) {
    throw new FileRejected(
      'unsupported_type',
      `${extension ? `.${extension}` : 'That type'} is not supported yet. Text and code documents can be read; PDF and Office files cannot.`,
    )
  }
  if (data.byteLength === 0) throw new FileRejected('empty_file', 'That file is empty.')
  if (data.byteLength > MAX_FILE_BYTES) {
    throw new FileRejected('too_large', `Files are limited to ${MAX_FILE_BYTES / 1024 / 1024} MB.`)
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
