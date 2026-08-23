/**
 * Durable checkpoints for a resumable import.
 *
 * If the import dies at conversation 47 of 96, rerunning must continue rather
 * than duplicate. The checkpoints live in the TARGET database, not in a file
 * beside the process: a checkpoint file is lost exactly when the process that
 * owned it is, which is the only situation it exists for.
 *
 * Progress is recorded per (scope, stage) and only AFTER that stage's writes
 * have committed. A checkpoint written first would claim work that a crash then
 * prevented, and the resume would skip it forever.
 */

import type { PostgresConnection } from '../postgres/pool.js';

export type RunStatus = 'running' | 'completed' | 'failed';

export interface MigrationRun {
  runId: string;
  sourceFingerprint: string;
  sourcePath: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  status: RunStatus;
  verificationStatus?: string;
  recordsImported: Record<string, number>;
  notes: Record<string, unknown>;
}

/** Raised when a resume is asked to continue against a different source. */
export class SourceFingerprintMismatchError extends Error {
  constructor(readonly runId: string, readonly expected: string, readonly actual: string) {
    super(
      `migration run '${runId}' was started against source fingerprint ${expected.slice(0, 16)}… but the ` +
        `source now fingerprints as ${actual.slice(0, 16)}…. Refusing to resume: continuing would interleave two ` +
        'different datasets into one target. Start a NEW run if the source legitimately changed.',
    );
    this.name = 'SourceFingerprintMismatchError';
  }
}

export class CheckpointStore {
  constructor(private readonly connection: PostgresConnection) {}

  /**
   * Begin a run, or adopt an existing one after verifying the source is the same.
   *
   * `now` is injected rather than read from the clock so a test can assert the
   * recorded timestamps instead of asserting that time passed.
   */
  async beginOrResume(
    runId: string, sourcePath: string, sourceFingerprint: string, now: number,
  ): Promise<{ run: MigrationRun; resumed: boolean }> {
    return this.connection.transaction(async (client) => {
      const existing = await client.query<{
        run_id: string; source_fingerprint: string; source_path: string;
        started_at: string; updated_at: string; completed_at: string | null;
        status: string; verification_status: string | null;
        records_imported: Record<string, number>; notes: Record<string, unknown>;
      }>('SELECT * FROM migration_runs WHERE run_id = $1', [runId]);

      const row = existing.rows[0];
      if (row) {
        if (row.source_fingerprint !== sourceFingerprint) {
          throw new SourceFingerprintMismatchError(runId, row.source_fingerprint, sourceFingerprint);
        }
        await client.query('UPDATE migration_runs SET updated_at = $2, status = $3 WHERE run_id = $1',
          [runId, now, 'running']);
        return {
          resumed: true,
          run: {
            runId: row.run_id,
            sourceFingerprint: row.source_fingerprint,
            sourcePath: row.source_path,
            startedAt: Number(row.started_at),
            updatedAt: now,
            ...(row.completed_at === null ? {} : { completedAt: Number(row.completed_at) }),
            status: 'running' as RunStatus,
            ...(row.verification_status === null ? {} : { verificationStatus: row.verification_status }),
            recordsImported: row.records_imported ?? {},
            notes: row.notes ?? {},
          },
        };
      }

      await client.query(
        `INSERT INTO migration_runs
           (run_id, source_fingerprint, source_path, started_at, updated_at, status, records_imported, notes)
         VALUES ($1,$2,$3,$4,$4,'running','{}'::jsonb,'{}'::jsonb)`,
        [runId, sourceFingerprint, sourcePath, now],
      );
      return {
        resumed: false,
        run: {
          runId, sourceFingerprint, sourcePath, startedAt: now, updatedAt: now,
          status: 'running' as RunStatus, recordsImported: {}, notes: {},
        },
      };
    });
  }

  /** Stages already committed for this run, as `owner\u001fworkspace\u001fstage` keys. */
  async completedStages(runId: string): Promise<Set<string>> {
    const rows = await this.connection.query<{ owner_scope: string; workspace_scope: string; stage: string }>(
      'SELECT owner_scope, workspace_scope, stage FROM migration_scope_progress WHERE run_id = $1', [runId],
    );
    return new Set(rows.map((r) => `${r.owner_scope}\u001f${r.workspace_scope}\u001f${r.stage}`));
  }

  /**
   * Record a finished stage. Called INSIDE the same transaction as that stage's
   * writes wherever possible, so the checkpoint and the work commit together.
   */
  async markStage(
    runId: string, scope: { ownerScope: string; workspaceScope: string }, stage: string,
    counts: Record<string, number>, now: number,
  ): Promise<void> {
    await this.connection.query(
      `INSERT INTO migration_scope_progress (run_id, owner_scope, workspace_scope, stage, completed_at, records_imported)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (run_id, owner_scope, workspace_scope, stage)
       DO UPDATE SET completed_at = EXCLUDED.completed_at, records_imported = EXCLUDED.records_imported`,
      [runId, scope.ownerScope, scope.workspaceScope, stage, now, JSON.stringify(counts)],
    );
  }

  async finish(
    runId: string, status: RunStatus, totals: Record<string, number>,
    verificationStatus: string | undefined, notes: Record<string, unknown>, now: number,
  ): Promise<void> {
    await this.connection.query(
      `UPDATE migration_runs
          SET status = $2, completed_at = $3, updated_at = $3,
              records_imported = $4::jsonb, verification_status = $5, notes = $6::jsonb
        WHERE run_id = $1`,
      [runId, status, now, JSON.stringify(totals), verificationStatus ?? null, JSON.stringify(notes)],
    );
  }

  async get(runId: string): Promise<MigrationRun | undefined> {
    const rows = await this.connection.query<{
      run_id: string; source_fingerprint: string; source_path: string;
      started_at: string; updated_at: string; completed_at: string | null;
      status: string; verification_status: string | null;
      records_imported: Record<string, number>; notes: Record<string, unknown>;
    }>('SELECT * FROM migration_runs WHERE run_id = $1', [runId]);
    const row = rows[0];
    if (!row) return undefined;
    return {
      runId: row.run_id,
      sourceFingerprint: row.source_fingerprint,
      sourcePath: row.source_path,
      startedAt: Number(row.started_at),
      updatedAt: Number(row.updated_at),
      ...(row.completed_at === null ? {} : { completedAt: Number(row.completed_at) }),
      status: row.status as RunStatus,
      ...(row.verification_status === null ? {} : { verificationStatus: row.verification_status }),
      recordsImported: row.records_imported ?? {},
      notes: row.notes ?? {},
    };
  }
}
