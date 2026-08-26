import 'server-only'

/**
 * Where media BYTES live.
 *
 * WHY A SEAM AT ALL. VM111 is compute, not a media store. Every uploaded and
 * generated artifact currently sits on that one machine's disk, which makes the
 * host's lifetime the artifact's lifetime — a VM replacement would take a user's
 * pictures with it. Putting an interface here means the application stops caring
 * whether bytes are local or remote, and the move becomes a configuration change
 * rather than a rewrite of everything that touches an image.
 *
 * DELIBERATELY ARTIFACT-ORIENTED, NOT FILESYSTEM-ORIENTED. There are no paths,
 * directories, buckets, mounts or providers in this vocabulary — only opaque
 * keys and bytes. A caller that could see a path would eventually depend on one,
 * and then the abstraction would exist without buying anything.
 *
 * IT OWNS BYTES AND NOTHING ELSE. Whether a caller may delete, whether a
 * conversation keeps a historical reference, whether provenance survives, and
 * whether a record is tombstoned are all DOMAIN decisions and stay above this
 * layer. `delete()` removes bytes; it does not decide that they should be
 * removed.
 *
 * NOT A MOUNT. The alternative — mounting object storage at the images path —
 * would turn every network fault into a strange local-I/O fault and leave the
 * coupling exactly where it is today.
 */

/** What is known about a stored object without reading it. */
export interface MediaStat {
  bytes: number
  /** Milliseconds since the epoch, for reconciliation and sweeps. */
  modifiedAt: number
}

export interface PutOptions {
  /**
   * The canonical hash the record claims for these bytes.
   *
   * Verified BEFORE the write when supplied, so a corrupted buffer never becomes
   * a stored object that metadata vouches for. An object existing is not enough
   * if its bytes are not the ones the record describes.
   */
  sha256?: string
}

export interface ReadOptions {
  /**
   * The hash these bytes must have.
   *
   * A mismatch reads as absent rather than as data: bytes that changed
   * underneath their record are not the artifact the record describes, and
   * serving them would attach the wrong provenance to whatever is said about
   * them next.
   */
  expectSha256?: string
}

export interface MediaStorage {
  put(key: string, bytes: Buffer, options?: PutOptions): Promise<void>
  read(key: string, options?: ReadOptions): Promise<Buffer | null>
  stat(key: string): Promise<MediaStat | null>
  exists(key: string): Promise<boolean>
  /** True when something was removed; false when there was nothing to remove. */
  delete(key: string): Promise<boolean>
  /** Keys under a prefix. Both a filesystem and an object store can answer this. */
  list(prefix: string): Promise<string[]>
  /**
   * Discard writes that never completed, older than the given age.
   *
   * A STORAGE CONCERN, OWNED BY STORAGE. `list` deliberately hides in-flight
   * writes so they can never be mistaken for objects, which means nothing above
   * this layer can see them to clean them up — nor should it. On a filesystem
   * these are temporary files from a crashed write; in an object store they are
   * incomplete multipart uploads. Same problem, different mechanism, and the
   * caller should not have to know which.
   *
   * Returns how many were discarded.
   */
  sweepIncomplete(prefix: string, olderThanMs: number): Promise<number>
}

/**
 * A storage fault, told apart from "not there".
 *
 * Absence is a fact a caller can act on; a failure to look is not. Collapsing
 * them would let a permissions problem or an unreachable endpoint read as an
 * empty library, which is the difference between "you have nothing" and "we
 * could not look".
 */
export class MediaStorageUnavailable extends Error {
  constructor(
    readonly operation: string,
    readonly key: string,
    cause?: unknown,
  ) {
    super(`Media storage could not ${operation} ${key}: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'MediaStorageUnavailable'
  }
}

export class MediaIntegrityError extends Error {
  constructor(readonly key: string) {
    super(`The bytes at ${key} do not match the hash their record claims.`)
    this.name = 'MediaIntegrityError'
  }
}

/**
 * Keys are opaque to callers and CONSTRAINED here.
 *
 * A key becomes a filesystem path in one implementation and an object name in
 * another, so `..`, a leading slash or a backslash must never survive this
 * check. Refusing is the only safe answer: a "sanitised" key is a different key,
 * and silently reading or writing a different object is worse than failing.
 */
const SAFE_KEY = /^[A-Za-z0-9_][A-Za-z0-9._/-]{0,511}$/

/*
 * A LEADING UNDERSCORE IS ALLOWED, a leading dot is not. `_migration/…` is how
 * the migration ledger namespaces itself away from artifacts, and an underscore
 * cannot cause traversal. A leading dot can (`.` and `..`), so it stays refused.
 */

export function assertSafeKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes('..') || key.includes('//')) {
    throw new Error(`Unsafe media key: ${JSON.stringify(key)}`)
  }
  return key
}
