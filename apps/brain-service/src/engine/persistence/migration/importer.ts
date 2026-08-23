/**
 * Stage 3 — per-scope import into PostgreSQL.
 *
 * Two rules shape everything here.
 *
 * ONE: every write goes through `PostgresDurableStore`, the same adapter
 * production uses. Hand-written bulk SQL would bypass the scope declaration,
 * the row-count invariant, and the composite foreign keys — the three things
 * that make the target trustworthy — and would drift from the schema the moment
 * either side changed.
 *
 * TWO: the import is driven per (owner, workspace) scope. There is no global
 * bulk transaction, because under FORCE row-level security a statement with no
 * declared scope matches zero rows and reports success. A "fast bulk copy" here
 * would complete instantly and import nothing.
 *
 * Every write is an upsert keyed on the record's own id, so a rerun after a
 * crash converges instead of duplicating.
 */

import type { PostgresDurableStore } from '../postgresStore.js';
import type { CheckpointStore } from './checkpoint.js';
import { LegacySource, type LegacyScope } from './legacySource.js';
import {
  toChunk, toConversation, toIndexRecord, toMessage, toSummary, toWorkspace,
} from './records.js';

export type ImportStage = 'conversations' | 'workspaces' | 'indexes';

export interface ScopeImportCounts {
  conversations: number;
  messages: number;
  summaries: number;
  workspaces: number;
  indexes: number;
  indexVersions: number;
  chunks: number;
}

export interface ImportProgress {
  scope: LegacyScope;
  stage: ImportStage;
  counts: Partial<ScopeImportCounts>;
  skipped: boolean;
}

const ZERO: ScopeImportCounts = {
  conversations: 0, messages: 0, summaries: 0, workspaces: 0, indexes: 0, indexVersions: 0, chunks: 0,
};

export interface ImporterDeps {
  source: LegacySource;
  store: PostgresDurableStore;
  checkpoints: CheckpointStore;
  runId: string;
  now: () => number;
  onProgress?: (p: ImportProgress) => void;
}

export class Importer {
  constructor(private readonly deps: ImporterDeps) {}

  /** Import every scope the legacy source holds, skipping stages already done. */
  async importAll(): Promise<ScopeImportCounts> {
    // The run must have been opened first. Without it the first checkpoint write
    // fails on a foreign key deep inside the import, after real rows have
    // already been written — a confusing way to learn the run was never begun.
    if (!(await this.deps.checkpoints.get(this.deps.runId))) {
      throw new Error(
        `migration run '${this.deps.runId}' has not been started. Call CheckpointStore.beginOrResume() first — ` +
          'it is what pins the run to a source fingerprint and makes a resume safe.',
      );
    }

    const done = await this.deps.checkpoints.completedStages(this.deps.runId);
    const totals = { ...ZERO };

    for (const scope of this.deps.source.scopes()) {
      for (const stage of ['conversations', 'workspaces', 'indexes'] as ImportStage[]) {
        // MUST use the same separator as CheckpointStore.completedStages. When
        // these two disagreed, every resume matched nothing and silently
        // re-imported work it had already committed — the resume looked like it
        // worked because a re-import is idempotent, and only a skip count caught
        // it. A unit separator is used because a scope string can contain a space.
        const key = `${scope.ownerScope}\u001f${scope.workspaceScope}\u001f${stage}`;
        if (done.has(key)) {
          this.deps.onProgress?.({ scope, stage, counts: {}, skipped: true });
          continue;
        }
        const counts = await this.runStage(scope, stage);
        await this.deps.checkpoints.markStage(this.deps.runId, scope, stage, counts, this.deps.now());
        for (const [k, v] of Object.entries(counts)) {
          totals[k as keyof ScopeImportCounts] += v;
        }
        this.deps.onProgress?.({ scope, stage, counts, skipped: false });
      }
    }
    return totals;
  }

  private async runStage(scope: LegacyScope, stage: ImportStage): Promise<Record<string, number>> {
    if (stage === 'conversations') return this.importConversations(scope);
    if (stage === 'workspaces') return this.importWorkspaces(scope);
    return this.importIndexes(scope);
  }

  /**
   * Conversations, their messages, and their summaries.
   *
   * Message ORDER is part of parity, so they are written in the legacy `seq`
   * order the source query already imposes. The conversation is written before
   * its children because the composite foreign keys added in migration 10 will
   * otherwise reject them — which is the schema doing its job, not an obstacle
   * to work around.
   */
  private async importConversations(scope: LegacyScope): Promise<Record<string, number>> {
    const counts = { conversations: 0, messages: 0, summaries: 0 };
    const persistScope = { owner: scope.ownerScope, workspace: scope.workspaceScope };

    for (const row of this.deps.source.conversations(scope)) {
      await this.deps.store.saveConversation(toConversation(row));
      counts.conversations += 1;

      for (const m of this.deps.source.messages(row.id)) {
        await this.deps.store.saveMessage(toMessage(m), persistScope);
        counts.messages += 1;
      }
      for (const s of this.deps.source.summaries(row.id)) {
        await this.deps.store.saveSummary(toSummary(s as never), persistScope);
        counts.summaries += 1;
      }
    }
    return counts;
  }

  private async importWorkspaces(scope: LegacyScope): Promise<Record<string, number>> {
    let workspaces = 0;
    for (const row of this.deps.source.workspaces(scope)) {
      await this.deps.store.saveWorkspace(toWorkspace(row));
      workspaces += 1;
    }
    return { workspaces };
  }

  /**
   * Indexes, their version history, and their chunks.
   *
   * Versions are replayed in ASCENDING order through `commitSync`, the same call
   * a live sync makes. That reproduces the multi-version history faithfully:
   * `commitSync` deletes only the files it is replacing AT THAT VERSION, so
   * chunks belonging to earlier versions survive exactly as they do in the
   * legacy state.
   *
   * The index record is written TWICE, and both writes are load-bearing.
   *
   * Before the replay, because migration 10's composite foreign keys require the
   * parent to exist, in the same scope, before any chunk can reference it.
   *
   * After the replay, because `commitSync` advances
   * `workspace_indexes.version` as a side effect of every version it commits. On
   * this production data the last replayed version happens to equal the legacy
   * pointer for all four indexes — but only because each index's newest version
   * still has chunks. An index whose newest version deleted every file has NO
   * chunk rows at that version, the replay would stop at an older one, and the
   * pointer would silently land in the past. "Usually the same" is not parity.
   *
   * The approved pointer needs its own call regardless: `saveIndex` deliberately
   * omits `approved_version` from its conflict update, so an index cannot be
   * re-approved by re-saving it. That is the right rule for live use and it
   * means the second `saveIndex` alone would never restore an approval.
   */
  private async importIndexes(scope: LegacyScope): Promise<Record<string, number>> {
    const counts = { indexes: 0, indexVersions: 0, chunks: 0 };
    const persistScope = { owner: scope.ownerScope, workspace: scope.workspaceScope };

    for (const row of this.deps.source.indexes(scope)) {
      const record = toIndexRecord(row);

      // The record must exist before chunks can reference it — migration 10's
      // composite foreign keys enforce that, and enforce that the parent is in
      // the same scope.
      await this.deps.store.saveIndex(record);
      counts.indexes += 1;

      for (const version of this.deps.source.chunkVersions(row.id)) {
        const chunkRows = this.deps.source.chunks(row.id, version);
        const chunks = chunkRows.map(toChunk);
        const files = [...new Set(chunks.map((c) => c.filePath))];
        const committedAt = this.deps.source.indexVersions(row.id)
          .find((v) => v.version === version)?.committed_at ?? record.updatedAt;

        await this.deps.store.commitSync(
          row.id, version, chunks, files, [], Number(committedAt), persistScope,
        );
        counts.indexVersions += 1;
        counts.chunks += chunks.length;
      }

      // Restore the legacy pointers the replay moved. `saveIndex` upserts state,
      // version, root and updated_at; the approval needs its own call.
      await this.deps.store.saveIndex(record);
      await this.deps.store.setApprovedVersion(
        row.id, record.approvedVersion ?? null, record.updatedAt, persistScope,
      );
    }
    return counts;
  }
}
