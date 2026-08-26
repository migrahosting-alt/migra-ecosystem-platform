import 'server-only'

import type { MediaStat, MediaStorage, PutOptions, ReadOptions } from './mediaStorage'

/**
 * Reads prefer object storage; local is the fallback. Writes stay local.
 *
 * THE MIGRATION PHASE, made explicit. Bytes are being copied to object storage
 * and proven there, but nothing has cut over: local is still where new media is
 * written and still the authority for what exists. This reads from the
 * destination so the object path is exercised by real traffic — under a safety
 * net — long before it is trusted with a write.
 *
 * OBJECT-FIRST WITHOUT ASKING THE LEDGER. Trying object and falling back is
 * behaviourally identical to checking a ledger first, and costs the same one
 * round trip for an artifact that has not moved. It also keeps the ledger off
 * the read path entirely, which matters because a ledger living in the same
 * bucket as the media is not something reads should depend on — if that bucket
 * is unreachable, reads must still work, and here they simply fall through.
 *
 * NOTHING IS HEALED ON A READ. A fallback does not copy the artifact into object
 * storage, and a hash mismatch does not overwrite anything. A read is not the
 * moment to repair state: it happens under user latency, it has no ledger entry
 * to update, and a self-healing read hides exactly the signal that says the
 * migration is wrong.
 */

export interface StorageHealthEvent {
  /*
   * The kinds are distinct because the ALERTS are distinct. A fallback is
   * routine during the staged phase; a failed write is a user losing their
   * picture. Collapsing both into "error" would force whoever is paged to open
   * the logs to find out whether anything actually broke.
   */
  kind: 'fallback' | 'mismatch' | 'error' | 'write-failed' | 'delete-failed'
  key: string
  detail?: string
}

export interface DualReadOptions {
  /** Where migrated bytes live. Tried first for every read. */
  object: MediaStorage
  /** Where bytes are still written, and the fallback for reads. */
  local: MediaStorage
  /**
   * Told whenever the object path did not serve a read.
   *
   * A fallback is not an error — the read succeeded — but it IS the number that
   * says whether the migration is working. Silent fallback would let object
   * storage be broken for weeks while everything looked fine.
   */
  onHealth?: (event: StorageHealthEvent) => void
}

export class DualReadMediaStorage implements MediaStorage {
  constructor(private readonly options: DualReadOptions) {}

  private health(event: StorageHealthEvent): void {
    try {
      this.options.onHealth?.(event)
    } catch {
      // Telemetry must never be able to fail a read.
    }
  }

  async read(key: string, options: ReadOptions = {}): Promise<Buffer | null> {
    try {
      const fromObject = await this.options.object.read(key, options)
      if (fromObject) return fromObject
      /*
       * Null is ambiguous here and deliberately treated as "try local": either
       * the artifact has not been migrated yet, or its bytes failed the hash
       * check inside the object backend. Both mean the object store cannot serve
       * this read, and the second is reported so a mismatch is never silent.
       */
      if (options.expectSha256 && (await this.options.object.exists(key))) {
        this.health({ kind: 'mismatch', key, detail: 'object bytes did not match the recorded hash' })
      } else {
        this.health({ kind: 'fallback', key, detail: 'not present in object storage' })
      }
    } catch (error) {
      // A storage fault is not absence. Fall back, and say so loudly.
      this.health({ kind: 'error', key, detail: error instanceof Error ? error.message : String(error) })
    }
    return this.options.local.read(key, options)
  }

  /**
   * Writes stay LOCAL until cutover.
   *
   * Writing to both would make object storage authoritative for new media
   * without any of the durability work being done — the cutover would have
   * happened quietly, which is the thing the staged plan exists to prevent.
   */
  async put(key: string, bytes: Buffer, options?: PutOptions): Promise<void> {
    try {
      return await this.options.local.put(key, bytes, options)
    } catch (error) {
      // Counted and re-thrown: the caller still fails, but a write that failed
      // is the loudest signal this storage produces and must not be invisible.
      this.health({
        kind: 'write-failed',
        key,
        detail: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  /**
   * Deletes reach BOTH, because a deleted artifact must not survive anywhere.
   *
   * Local decides the answer — it is still the authority on what exists — but a
   * migrated copy left behind in object storage would come back the moment reads
   * cut over, which is a deletion that silently undid itself.
   */
  async delete(key: string): Promise<boolean> {
    let removedLocally: boolean
    try {
      removedLocally = await this.options.local.delete(key)
    } catch (error) {
      this.health({
        kind: 'delete-failed',
        key,
        detail: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
    try {
      await this.options.object.delete(key)
    } catch (error) {
      // The user's delete succeeded where it counts. The orphan is reported
      // rather than raised, so reconciliation can clean it up later.
      this.health({ kind: 'delete-failed', key, detail: `object copy not removed: ${error instanceof Error ? error.message : error}` })
    }
    return removedLocally
  }

  // Local remains the authority for existence and enumeration during this phase:
  // it is where writes land, so it is the only complete picture.
  stat(key: string): Promise<MediaStat | null> {
    return this.options.local.stat(key)
  }
  exists(key: string): Promise<boolean> {
    return this.options.local.exists(key)
  }
  list(prefix: string): Promise<string[]> {
    return this.options.local.list(prefix)
  }

  async sweepIncomplete(prefix: string, olderThanMs: number): Promise<number> {
    const local = await this.options.local.sweepIncomplete(prefix, olderThanMs)
    let object = 0
    try {
      object = await this.options.object.sweepIncomplete(prefix, olderThanMs)
    } catch (error) {
      this.health({ kind: 'error', key: prefix, detail: `object sweep failed: ${error instanceof Error ? error.message : error}` })
    }
    return local + object
  }
}
