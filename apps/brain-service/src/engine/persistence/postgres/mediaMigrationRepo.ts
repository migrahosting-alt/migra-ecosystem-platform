import type { PoolClient } from 'pg';

/**
 * Where a media artifact's bytes have moved, and whether that was PROVEN.
 *
 * THE AUTHORITY, not the evidence. A copy of this record is mirrored into the
 * destination bucket so a restored bucket carries its own account of how it was
 * filled — but if the ledger lived ONLY there, losing the bucket would lose both
 * the artifact and the proof of where it went.
 *
 * 🚨 IDENTITY IS scope + artifact, NEVER artifact ALONE. Image ids are
 * content-addressed, so the same id legitimately exists under several owners.
 * Treating it as globally unique produced a migration "proof" that had verified
 * one owner's copy while the browser read another's.
 */

export type MediaMigrationStatus = 'pending' | 'copied' | 'verified' | 'failed';

export interface MediaMigration {
  scope: string;
  artifactId: string;
  sourceProvider: string;
  sourceKey: string;
  destinationProvider: string;
  destinationKey: string;
  expectedHash: string;
  verifiedHash?: string | undefined;
  status: MediaMigrationStatus;
  copiedAt?: number | undefined;
  verifiedAt?: number | undefined;
  lastError?: string | undefined;
  attempts: number;
  correlationId?: string | undefined;
  createdAt: number;
  updatedAt: number;
}

const num = (v: unknown): number => (typeof v === 'string' ? Number(v) : (v as number));
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : num(v));

/** The row's primary key, derived from the identity that actually distinguishes it. */
export const migrationId = (scope: string, artifactId: string, destinationProvider: string): string =>
  `${scope}/${artifactId}@${destinationProvider}`;

function toRecord(r: Record<string, unknown>): MediaMigration {
  return {
    scope: r.scope as string,
    artifactId: r.artifact_id as string,
    sourceProvider: r.source_provider as string,
    sourceKey: r.source_key as string,
    destinationProvider: r.destination_provider as string,
    destinationKey: r.destination_key as string,
    expectedHash: r.expected_hash as string,
    verifiedHash: (r.verified_hash as string | null) ?? undefined,
    status: r.status as MediaMigrationStatus,
    copiedAt: optNum(r.copied_at),
    verifiedAt: optNum(r.verified_at),
    lastError: (r.last_error as string | null) ?? undefined,
    attempts: num(r.attempts),
    correlationId: (r.correlation_id as string | null) ?? undefined,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/**
 * Write the current state of one migration.
 *
 * Upserted on the TARGET — one row per (scope, artifact, destination provider) —
 * so a retried migration updates its record rather than accumulating a history
 * that makes "has this moved?" ambiguous. `attempts` increments on every write,
 * which is what makes a permanently failing artifact visible instead of quietly
 * retried forever.
 */
export async function recordMediaMigration(
  client: PoolClient,
  entry: Omit<MediaMigration, 'attempts' | 'createdAt' | 'updatedAt'> & { at: number },
): Promise<void> {
  const id = migrationId(entry.scope, entry.artifactId, entry.destinationProvider);
  await client.query(
    `INSERT INTO media_migrations
       (id, scope, artifact_id, source_provider, source_key, destination_provider, destination_key,
        expected_hash, verified_hash, status, copied_at, verified_at, last_error, attempts,
        correlation_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$15)
     ON CONFLICT (id) DO UPDATE SET
       source_key = EXCLUDED.source_key,
       destination_key = EXCLUDED.destination_key,
       expected_hash = EXCLUDED.expected_hash,
       verified_hash = EXCLUDED.verified_hash,
       status = EXCLUDED.status,
       /* Timestamps are never cleared by a later attempt: when something was
          first copied or proven is history, not current state. */
       copied_at = COALESCE(EXCLUDED.copied_at, media_migrations.copied_at),
       verified_at = COALESCE(EXCLUDED.verified_at, media_migrations.verified_at),
       last_error = EXCLUDED.last_error,
       attempts = media_migrations.attempts + 1,
       correlation_id = COALESCE(EXCLUDED.correlation_id, media_migrations.correlation_id),
       updated_at = EXCLUDED.updated_at`,
    [
      id, entry.scope, entry.artifactId, entry.sourceProvider, entry.sourceKey,
      entry.destinationProvider, entry.destinationKey, entry.expectedHash,
      entry.verifiedHash ?? null, entry.status, entry.copiedAt ?? null, entry.verifiedAt ?? null,
      entry.lastError ?? null, entry.correlationId ?? null, entry.at,
    ],
  );
}

export async function getMediaMigration(
  client: PoolClient,
  scope: string,
  artifactId: string,
  destinationProvider: string,
): Promise<MediaMigration | null> {
  const { rows } = await client.query(`SELECT * FROM media_migrations WHERE id = $1`, [
    migrationId(scope, artifactId, destinationProvider),
  ]);
  return rows[0] ? toRecord(rows[0] as Record<string, unknown>) : null;
}

/** Has this artifact been PROVEN to have moved? Not merely copied. */
export async function isMediaMigrationVerified(
  client: PoolClient,
  scope: string,
  artifactId: string,
  destinationProvider: string,
): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM media_migrations WHERE id = $1 AND status = 'verified'`,
    [migrationId(scope, artifactId, destinationProvider)],
  );
  return rows.length > 0;
}

/** Migration state, for progress and for finding what still needs attention. */
export async function summariseMediaMigrations(
  client: PoolClient,
): Promise<Record<MediaMigrationStatus, number>> {
  const { rows } = await client.query(
    `SELECT status, COUNT(*)::int AS n FROM media_migrations GROUP BY status`,
  );
  const summary: Record<MediaMigrationStatus, number> = { pending: 0, copied: 0, verified: 0, failed: 0 };
  for (const row of rows as { status: MediaMigrationStatus; n: number }[]) {
    summary[row.status] = row.n;
  }
  return summary;
}

/** Everything that is not yet proven, so a resumed run knows what is left. */
export async function listUnverifiedMediaMigrations(
  client: PoolClient,
  limit = 500,
): Promise<MediaMigration[]> {
  const { rows } = await client.query(
    `SELECT * FROM media_migrations WHERE status <> 'verified' ORDER BY updated_at ASC LIMIT $1`,
    [limit],
  );
  return (rows as Record<string, unknown>[]).map(toRecord);
}
