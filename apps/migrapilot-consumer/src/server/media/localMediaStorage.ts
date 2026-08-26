import 'server-only'

import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  assertSafeKey,
  MediaIntegrityError,
  MediaStorageUnavailable,
  type MediaStat,
  type MediaStorage,
  type PutOptions,
  type ReadOptions,
} from './mediaStorage'

/**
 * Media bytes on this machine's disk.
 *
 * The behaviour that was already here, moved behind the interface unchanged:
 * atomic writes, hash verification on read, and 0600 files inside 0700
 * directories. Nothing about it is new — that is the point of this step. The
 * object-store implementation arrives next and has to match what this does,
 * which is only checkable if this one is honest about what it does.
 *
 * DEVELOPMENT AND FALLBACK. It stays the implementation used when no object
 * store is configured, so a workstation needs no infrastructure to run the
 * product.
 */
export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    return join(this.root, assertSafeKey(key))
  }

  async put(key: string, bytes: Buffer, options: PutOptions = {}): Promise<void> {
    const target = this.pathFor(key)
    if (options.sha256) {
      // Checked BEFORE the write: a corrupted buffer must never become a stored
      // object that metadata vouches for.
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== options.sha256) throw new MediaIntegrityError(key)
    }
    const temporary = join(dirname(target), `.tmp-${randomUUID()}`)
    try {
      await mkdir(dirname(target), { recursive: true, mode: 0o700 })
      /*
       * Written to a temporary name and renamed. Rename within one filesystem is
       * atomic, so a reader never observes a half-written object and a crash
       * mid-write leaves a temp file rather than a corrupt one under a canonical
       * key.
       */
      await writeFile(temporary, bytes, { mode: 0o600 })
      await rename(temporary, target)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw new MediaStorageUnavailable('write', key, error)
    }
  }

  async read(key: string, options: ReadOptions = {}): Promise<Buffer | null> {
    const target = this.pathFor(key)
    let bytes: Buffer
    try {
      bytes = await readFile(target)
    } catch (error) {
      // Absent is a fact; anything else is a failure to look, and the two must
      // not be reported the same way.
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw new MediaStorageUnavailable('read', key, error)
    }
    if (options.expectSha256) {
      const actual = createHash('sha256').update(bytes).digest('hex')
      /*
       * A mismatch reads as ABSENT rather than as data. Bytes that changed
       * underneath their record are not the artifact the record describes, and
       * serving them would attach the wrong provenance to whatever is said about
       * them next.
       */
      if (actual !== options.expectSha256) return null
    }
    return bytes
  }

  async stat(key: string): Promise<MediaStat | null> {
    try {
      const info = await stat(this.pathFor(key))
      return { bytes: info.size, modifiedAt: info.mtimeMs }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null
      throw new MediaStorageUnavailable('stat', key, error)
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null
  }

  async delete(key: string): Promise<boolean> {
    const target = this.pathFor(key)
    try {
      await stat(target)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return false
      throw new MediaStorageUnavailable('delete', key, error)
    }
    try {
      await rm(target, { force: true })
      return true
    } catch (error) {
      throw new MediaStorageUnavailable('delete', key, error)
    }
  }

  async sweepIncomplete(prefix: string, olderThanMs: number): Promise<number> {
    if (prefix) assertSafeKey(prefix)
    const directory = join(this.root, prefix)
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return 0
      throw new MediaStorageUnavailable('sweep', prefix, error)
    }
    let removed = 0
    for (const entry of entries) {
      if (!entry.startsWith('.tmp-')) continue
      const full = join(directory, entry)
      const info = await stat(full).catch(() => null)
      // Age-bounded: a young temporary belongs to a write happening right now.
      if (!info || Date.now() - info.mtimeMs < olderThanMs) continue
      await rm(full, { force: true }).catch(() => undefined)
      removed += 1
    }
    return removed
  }

  async list(prefix: string): Promise<string[]> {
    // A prefix is a key shape too, so the same constraint applies — an empty
    // prefix means the whole store and is allowed.
    if (prefix) assertSafeKey(prefix)
    const directory = join(this.root, prefix)
    let entries: string[]
    try {
      entries = await readdir(directory)
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return []
      throw new MediaStorageUnavailable('list', prefix, error)
    }
    return entries
      // Temporaries belong to an in-flight write and are not objects yet.
      .filter((entry) => !entry.startsWith('.tmp-'))
      .map((entry) => (prefix ? `${prefix}/${entry}` : entry))
  }
}
