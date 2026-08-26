import 'server-only'

import { createHash } from 'node:crypto'

import type { MediaStorage } from './mediaStorage'

/**
 * One record per artifact moved between providers.
 *
 * WHY A LEDGER AND NOT A LOOP. A migration that only copies has no way to answer
 * the three questions that matter when it is interrupted: what has moved, what
 * has been PROVEN to have moved, and what is left. Without that, resuming means
 * starting again, and "we copied everything" is a claim nobody can check.
 *
 * COPIED IS NOT VERIFIED. They are separate states on purpose. A byte stream
 * that arrived is not the same as a byte stream that arrived intact, and only
 * the second is a reason to stop reading from the source.
 *
 * 🚨 THIS IS EVIDENCE, NOT AUTHORITY. The authoritative ledger lives in the
 * Brain's PostgreSQL — see `brainMigrationLedger.ts`. A ledger that lives only
 * beside the bytes it describes shares their fate: losing the bucket would lose
 * both the artifact and the proof of where the artifact went.
 *
 * It is kept because it travels WITH the data, so a restored bucket carries its
 * own account of how it was filled. Every record it writes is stamped
 * `authority: 'evidence_only'` so that nobody recovering from an incident can
 * mistake it for canonical state — the moment it disagrees with PostgreSQL,
 * PostgreSQL is right and this is a clue about what happened.
 */

export type MigrationStatus = 'copied' | 'verified' | 'failed'

/**
 * Stamped into every mirrored record.
 *
 * A future reconciliation must be able to rebuild or discard these objects
 * without touching canonical state, and someone reading one at 3am must be able
 * to tell in one line that it is not the source of truth.
 */
export const EVIDENCE_ONLY = 'evidence_only' as const

export interface MigrationRecord {
  /** Always `evidence_only`. Present so the file says what it is. */
  authority?: typeof EVIDENCE_ONLY
  /** The artifact's canonical id — the same handle the product uses. */
  artifactId: string
  sourceProvider: string
  destinationProvider: string
  /** The key in the destination, so a record can be resolved without guessing. */
  destinationKey: string
  /** What the source record claims these bytes hash to. */
  expectedHash: string
  /** What the destination's bytes actually hash to. Absent until verified. */
  verifiedHash?: string
  bytes: number
  status: MigrationStatus
  migratedAt: number
  /** Present only on failure, so the reason survives the run that produced it. */
  error?: string
}

const LEDGER_PREFIX = '_migration/media'

const recordKey = (artifactId: string): string => `${LEDGER_PREFIX}/${artifactId}.json`

export class MigrationLedger {
  constructor(private readonly storage: MediaStorage) {}

  async record(entry: MigrationRecord): Promise<void> {
    // Stamped on write, never taken from the caller: the marker must describe
    // where the record IS, not what someone hoped it was.
    const stamped: MigrationRecord = { ...entry, authority: EVIDENCE_ONLY }
    await this.storage.put(recordKey(entry.artifactId), Buffer.from(JSON.stringify(stamped, null, 2)))
  }

  async get(artifactId: string): Promise<MigrationRecord | null> {
    const raw = await this.storage.read(recordKey(artifactId))
    if (!raw) return null
    try {
      return JSON.parse(raw.toString('utf8')) as MigrationRecord
    } catch {
      // A ledger entry that cannot be parsed is not evidence of anything. Treat
      // it as absent so the artifact is re-migrated and re-proven.
      return null
    }
  }

  /** Has this artifact been PROVEN to have moved? Not merely copied. */
  async isVerified(artifactId: string): Promise<boolean> {
    const entry = await this.get(artifactId)
    return entry?.status === 'verified'
  }

  async all(): Promise<MigrationRecord[]> {
    const keys = await this.storage.list(LEDGER_PREFIX)
    const entries: MigrationRecord[] = []
    for (const key of keys) {
      if (!key.endsWith('.json')) continue
      const raw = await this.storage.read(key)
      if (!raw) continue
      try {
        entries.push(JSON.parse(raw.toString('utf8')) as MigrationRecord)
      } catch {
        // Skipped rather than thrown: one unreadable entry must not hide the
        // state of every other artifact.
      }
    }
    return entries
  }
}

export interface MigrationOutcome {
  record: MigrationRecord
  /** True only when the destination's bytes hash to what the source claimed. */
  proven: boolean
}

/**
 * Copy one artifact and PROVE it arrived intact.
 *
 * The hash is recomputed from what the destination actually returns, not carried
 * over from the source: a hash copied alongside the bytes proves only that the
 * copy was consistent with itself.
 */
export async function migrateArtifact(options: {
  artifactId: string
  key: string
  expectedHash: string
  source: MediaStorage
  destination: MediaStorage
  sourceProvider: string
  destinationProvider: string
  ledger: MigrationLedger
  now?: () => number
}): Promise<MigrationOutcome> {
  const at = options.now?.() ?? Date.now()
  const base = {
    artifactId: options.artifactId,
    sourceProvider: options.sourceProvider,
    destinationProvider: options.destinationProvider,
    destinationKey: options.key,
    expectedHash: options.expectedHash,
    migratedAt: at,
  }

  const bytes = await options.source.read(options.key, { expectSha256: options.expectedHash })
  if (!bytes) {
    /*
     * Either the source has nothing there, or what it has does not match the
     * record. Both mean there is nothing here worth copying, and copying it
     * anyway would propagate a corruption into the destination and call it a
     * migration.
     */
    const record: MigrationRecord = {
      ...base,
      bytes: 0,
      status: 'failed',
      error: 'the source object is missing or does not match its recorded hash',
    }
    await options.ledger.record(record)
    return { record, proven: false }
  }

  await options.destination.put(options.key, bytes, { sha256: options.expectedHash })
  await options.ledger.record({ ...base, bytes: bytes.byteLength, status: 'copied' })

  // Read BACK from the destination and hash what it returns. Anything less
  // proves the write call returned, not that the bytes are retrievable.
  const readBack = await options.destination.read(options.key)
  const verifiedHash = readBack ? createHash('sha256').update(readBack).digest('hex') : undefined

  if (!readBack || verifiedHash !== options.expectedHash) {
    const record: MigrationRecord = {
      ...base,
      bytes: bytes.byteLength,
      ...(verifiedHash ? { verifiedHash } : {}),
      status: 'failed',
      error: readBack ? 'the destination returned different bytes' : 'the destination returned nothing',
    }
    await options.ledger.record(record)
    return { record, proven: false }
  }

  const record: MigrationRecord = {
    ...base,
    bytes: bytes.byteLength,
    verifiedHash,
    status: 'verified',
  }
  await options.ledger.record(record)
  return { record, proven: true }
}
