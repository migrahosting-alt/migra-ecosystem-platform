import 'server-only'

import { createHash } from 'node:crypto'

import { signRequest, type Credentials } from './sigv4'
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
 * Media bytes in S3-compatible object storage.
 *
 * THE SAME CONTRACT AS THE LOCAL BACKEND, deliberately: one interface, one test
 * suite, two implementations. If "the same" were only an intention rather than a
 * shared suite, the migration would be a guess.
 *
 * KEYS ARE PREFIXED, NOT RESHAPED. The bucket is shared with other MigraPilot
 * artifacts (drift snapshots already live there), so media sits under its own
 * prefix and the logical key underneath is byte-for-byte what the local backend
 * uses. Re-keying during a provider move is how you lose things; it is a
 * separate, checksum-verified migration if it is ever wanted at all.
 */

export interface ObjectStorageConfig {
  /** e.g. `http://100.113.190.42:9000` — the tailnet address, not a public host. */
  endpoint: string
  bucket: string
  /** MinIO has no meaningful region; `us-east-1` is the conventional default. */
  region?: string
  /** Everything this backend writes lives under here. */
  prefix?: string
  credentials: Credentials
}

export class ObjectMediaStorage implements MediaStorage {
  private readonly region: string
  private readonly prefix: string

  constructor(private readonly config: ObjectStorageConfig) {
    this.region = config.region ?? 'us-east-1'
    this.prefix = (config.prefix ?? '').replace(/^\/+|\/+$/g, '')
  }

  /** The object path for a logical key. The prefix is provider plumbing. */
  private objectPath(key: string): string {
    assertSafeKey(key)
    const scoped = this.prefix ? `${this.prefix}/${key}` : key
    return `/${this.config.bucket}/${scoped}`
  }

  private async send(
    method: string,
    key: string,
    options: { body?: Buffer; query?: Record<string, string>; path?: string } = {},
  ): Promise<Response> {
    const signed = signRequest({
      method,
      endpoint: this.config.endpoint,
      path: options.path ?? this.objectPath(key),
      ...(options.query ? { query: options.query } : {}),
      ...(options.body ? { body: options.body } : {}),
      credentials: this.config.credentials,
      region: this.region,
    })
    try {
      return await fetch(signed.url, {
        method: signed.method,
        headers: signed.headers,
        ...(options.body ? { body: new Uint8Array(options.body) } : {}),
      })
    } catch (error) {
      // A transport failure is NOT absence — see `MediaStorageUnavailable`.
      throw new MediaStorageUnavailable(method.toLowerCase(), key, error)
    }
  }

  async put(key: string, bytes: Buffer, options: PutOptions = {}): Promise<void> {
    if (options.sha256) {
      // Checked before the request, exactly as the local backend does: metadata
      // must never vouch for bytes that are not these.
      const actual = createHash('sha256').update(bytes).digest('hex')
      if (actual !== options.sha256) throw new MediaIntegrityError(key)
    }
    const response = await this.send('PUT', key, { body: bytes })
    if (!response.ok) {
      throw new MediaStorageUnavailable('write', key, `${response.status} ${await response.text().catch(() => '')}`)
    }
  }

  async read(key: string, options: ReadOptions = {}): Promise<Buffer | null> {
    const response = await this.send('GET', key)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new MediaStorageUnavailable('read', key, `${response.status}`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    if (options.expectSha256) {
      const actual = createHash('sha256').update(bytes).digest('hex')
      // A mismatch reads as ABSENT, matching the local backend: bytes that
      // changed underneath their record are not the artifact it describes.
      if (actual !== options.expectSha256) return null
    }
    return bytes
  }

  async stat(key: string): Promise<MediaStat | null> {
    const response = await this.send('HEAD', key)
    if (response.status === 404) return null
    if (!response.ok) throw new MediaStorageUnavailable('stat', key, `${response.status}`)
    const length = Number(response.headers.get('content-length') ?? '0')
    const modified = response.headers.get('last-modified')
    return {
      bytes: Number.isFinite(length) ? length : 0,
      modifiedAt: modified ? Date.parse(modified) : Date.now(),
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null
  }

  async delete(key: string): Promise<boolean> {
    /*
     * S3 DELETE is idempotent and answers 204 whether or not the object was
     * there, so existence is established first. Reporting "deleted" for
     * something that was never present would tell a caller their delete worked
     * on an object they never had — the same contract the local backend keeps.
     */
    if (!(await this.exists(key))) return false
    const response = await this.send('DELETE', key)
    if (!response.ok && response.status !== 204) {
      throw new MediaStorageUnavailable('delete', key, `${response.status}`)
    }
    return true
  }

  async list(prefix: string): Promise<string[]> {
    if (prefix) assertSafeKey(prefix)
    const scoped = this.prefix ? `${this.prefix}/${prefix}` : prefix
    const response = await this.send('GET', prefix, {
      path: `/${this.config.bucket}`,
      query: { 'list-type': '2', prefix: scoped ? `${scoped}/` : '' },
    })
    if (!response.ok) throw new MediaStorageUnavailable('list', prefix, `${response.status}`)

    const xml = await response.text()
    const keys: string[] = []
    for (const match of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
      const full = match[1]!
      const logical = this.prefix && full.startsWith(`${this.prefix}/`) ? full.slice(this.prefix.length + 1) : full
      // Flat, like the local backend: keys directly under the prefix, not the
      // whole subtree, so both answer `list` the same way.
      const rest = prefix ? logical.slice(prefix.length + 1) : logical
      if (rest && !rest.includes('/')) keys.push(logical)
    }
    return keys
  }

  async sweepIncomplete(prefix: string, olderThanMs: number): Promise<number> {
    /*
     * Abandoned multipart uploads are this backend's version of a temporary file
     * from a crashed write. The policy grants exactly the three actions needed
     * to find and abort them and nothing more.
     */
    if (prefix) assertSafeKey(prefix)
    const scoped = this.prefix ? `${this.prefix}/${prefix}` : prefix
    const response = await this.send('GET', prefix, {
      path: `/${this.config.bucket}`,
      query: { uploads: '', prefix: scoped ? `${scoped}/` : '' },
    })
    if (!response.ok) throw new MediaStorageUnavailable('sweep', prefix, `${response.status}`)

    const xml = await response.text()
    const cutoff = Date.now() - olderThanMs
    let aborted = 0
    for (const match of xml.matchAll(/<Upload>([\s\S]*?)<\/Upload>/g)) {
      const block = match[1]!
      const key = /<Key>([^<]+)<\/Key>/.exec(block)?.[1]
      const uploadId = /<UploadId>([^<]+)<\/UploadId>/.exec(block)?.[1]
      const initiated = /<Initiated>([^<]+)<\/Initiated>/.exec(block)?.[1]
      if (!key || !uploadId) continue
      // Age-bounded: a young upload belongs to a write happening right now.
      if (initiated && Date.parse(initiated) > cutoff) continue
      const abort = await this.send('DELETE', key, {
        path: `/${this.config.bucket}/${key}`,
        query: { uploadId },
      })
      if (abort.ok || abort.status === 204) aborted += 1
    }
    return aborted
  }
}
