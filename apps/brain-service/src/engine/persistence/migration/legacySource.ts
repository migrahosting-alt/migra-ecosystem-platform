/**
 * Stage 1 — read-only extraction from the legacy Brain state.
 *
 * The legacy SQLite database is a **migration source artifact**, not a supported
 * persistence backend. Nothing in this file writes to it, and the connection is
 * opened `readOnly` so a mistake fails loudly instead of mutating the only copy
 * of the data being migrated.
 *
 * Run it against a COPY. The live file is served by a running Brain, and reading
 * a file mid-write is how a migration silently imports a torn state.
 */

import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';

export interface LegacyScope {
  ownerScope: string;
  workspaceScope: string;
}

export interface LegacyConversationRow {
  id: string; owner_scope: string; workspace_scope: string; title: string | null;
  memory_mode: string; created_at: number; updated_at: number;
  deleted_at: number | null; grounding_files: string | null;
}

export interface LegacyMessageRow {
  id: string; conversation_id: string; role: string; content: string; status: string;
  request_id: string | null; model_id: string | null; provider_id: string | null;
  created_at: number; durable: number; supersedes_id: string | null; seq: number;
}

export interface LegacySummaryRow {
  id: string; conversation_id: string; content: string; covers_through_seq: number | null;
  version: number | null; created_at: number;
}

export interface LegacyIndexRow {
  id: string; workspace_id: string; owner_scope: string; source_type: string; root: string;
  state: string; version: number; approved_version: number | null;
  embedding_model: string; embedding_version: string; created_at: number; updated_at: number;
}

export interface LegacyChunkRow {
  id: string; index_id: string; workspace_id: string; file_path: string; language: string | null;
  symbol: string | null; start_line: number; end_line: number; content_hash: string;
  embedding_model: string; embedding_version: string; indexed_at: number;
  text: string; vector: Uint8Array; index_version: number;
}

export interface LegacyWorkspaceRow {
  id: string; owner_scope: string; workspace_scope: string; name: string; root: string;
  git_repo: string | null; git_branch: string | null; memory_mode: string;
  index_id: string | null; provider_preferences: string | null; permissions: string | null;
  last_sync_at: number | null; created_at: number; updated_at: number;
}

/** Every table the legacy state holds, and how many rows are in it. */
export type LegacyInventory = Record<string, number>;

export class LegacySource {
  private readonly db: DatabaseSync;

  constructor(readonly path: string) {
    // readOnly is not a convenience. It is the guarantee that a bug in the
    // importer cannot damage the artifact being migrated FROM.
    this.db = new DatabaseSync(path, { readOnly: true });
  }

  /**
   * A content fingerprint of the whole source file.
   *
   * Pins a resumable run to one exact artifact. Row counts or an mtime would let
   * a changed source pass as "the same migration", interleaving two datasets
   * into one target in a way that is nearly impossible to unpick afterwards.
   */
  static async fingerprint(path: string): Promise<string> {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    await once(stream, 'end');
    return hash.digest('hex');
  }

  /** Row count for every table present, so the report states what was actually seen. */
  inventory(): LegacyInventory {
    const tables = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const out: LegacyInventory = {};
    for (const { name } of tables) {
      if (name.startsWith('sqlite_')) continue;
      const row = this.db.prepare(`SELECT count(*) AS c FROM "${name}"`).get() as { c: number };
      out[name] = Number(row.c);
    }
    return out;
  }

  /**
   * Every (owner, workspace) pair that owns data anywhere.
   *
   * The import is driven per scope because every PostgreSQL write must declare
   * one — there is no global bulk transaction that bypasses row-level security.
   * A scope counts if ANY domain has rows for it, not only conversations.
   */
  scopes(): LegacyScope[] {
    const seen = new Map<string, LegacyScope>();
    const add = (ownerScope: string | null, workspaceScope: string | null) => {
      if (ownerScope === null || workspaceScope === null) return;
      seen.set(`${ownerScope}\u001f${workspaceScope}`, { ownerScope, workspaceScope });
    };

    for (const r of this.db.prepare(
      'SELECT DISTINCT owner_scope, workspace_scope FROM conversations',
    ).all() as Array<{ owner_scope: string; workspace_scope: string }>) {
      add(r.owner_scope, r.workspace_scope);
    }
    for (const r of this.db.prepare(
      'SELECT DISTINCT owner_scope, workspace_scope FROM workspaces',
    ).all() as Array<{ owner_scope: string; workspace_scope: string }>) {
      add(r.owner_scope, r.workspace_scope);
    }
    // Indexes carry the workspace SCOPE in a column named `workspace_id`. Gate
    // 1.8 proved against the real database that the two are the same value
    // despite the name, which is why it is read as a scope here.
    for (const r of this.db.prepare(
      'SELECT DISTINCT owner_scope, workspace_id FROM workspace_indexes',
    ).all() as Array<{ owner_scope: string; workspace_id: string }>) {
      add(r.owner_scope, r.workspace_id);
    }
    for (const r of this.db.prepare(
      'SELECT DISTINCT owner_scope, workspace_scope FROM memory_items',
    ).all() as Array<{ owner_scope: string; workspace_scope: string }>) {
      add(r.owner_scope, r.workspace_scope);
    }

    // Sorted, so a resumed run always walks scopes in the same order as the run
    // it is resuming.
    return [...seen.values()].sort((a, b) =>
      a.ownerScope.localeCompare(b.ownerScope) || a.workspaceScope.localeCompare(b.workspaceScope));
  }

  conversations(scope: LegacyScope): LegacyConversationRow[] {
    return this.db.prepare(
      'SELECT * FROM conversations WHERE owner_scope = ? AND workspace_scope = ? ORDER BY id',
    ).all(scope.ownerScope, scope.workspaceScope) as unknown as LegacyConversationRow[];
  }

  /** Ordered by `seq` — message ORDER is part of exact parity, not incidental. */
  messages(conversationId: string): LegacyMessageRow[] {
    return this.db.prepare(
      'SELECT * FROM conversation_messages WHERE conversation_id = ? ORDER BY seq, created_at, id',
    ).all(conversationId) as unknown as LegacyMessageRow[];
  }

  summaries(conversationId: string): LegacySummaryRow[] {
    return this.db.prepare(
      'SELECT * FROM conversation_summaries WHERE conversation_id = ? ORDER BY version, created_at, id',
    ).all(conversationId) as unknown as LegacySummaryRow[];
  }

  workspaces(scope: LegacyScope): LegacyWorkspaceRow[] {
    return this.db.prepare(
      'SELECT * FROM workspaces WHERE owner_scope = ? AND workspace_scope = ? ORDER BY id',
    ).all(scope.ownerScope, scope.workspaceScope) as unknown as LegacyWorkspaceRow[];
  }

  indexes(scope: LegacyScope): LegacyIndexRow[] {
    return this.db.prepare(
      'SELECT * FROM workspace_indexes WHERE owner_scope = ? AND workspace_id = ? ORDER BY id',
    ).all(scope.ownerScope, scope.workspaceScope) as unknown as LegacyIndexRow[];
  }

  /** Versions recorded for an index, ascending — replay order matters. */
  indexVersions(indexId: string): Array<{ version: number; committed_at: number }> {
    return this.db.prepare(
      'SELECT version, committed_at FROM index_versions WHERE index_id = ? ORDER BY version',
    ).all(indexId) as unknown as Array<{ version: number; committed_at: number }>;
  }

  /**
   * Versions that actually hold chunks.
   *
   * Distinct from `indexVersions`: a version row routinely outlives its chunks,
   * because a later sync deletes the chunks of the files it replaced. Replaying
   * the version list would then invent empty versions.
   */
  chunkVersions(indexId: string): number[] {
    return (this.db.prepare(
      'SELECT DISTINCT index_version AS v FROM index_chunks WHERE index_id = ? ORDER BY v',
    ).all(indexId) as Array<{ v: number }>).map((r) => Number(r.v));
  }

  chunks(indexId: string, version: number): LegacyChunkRow[] {
    return this.db.prepare(
      'SELECT * FROM index_chunks WHERE index_id = ? AND index_version = ? ORDER BY file_path, start_line',
    ).all(indexId, version) as unknown as LegacyChunkRow[];
  }

  memoryItems(scope: LegacyScope): Array<Record<string, unknown>> {
    return this.db.prepare(
      'SELECT * FROM memory_items WHERE owner_scope = ? AND workspace_scope = ? ORDER BY id',
    ).all(scope.ownerScope, scope.workspaceScope) as unknown as Array<Record<string, unknown>>;
  }

  /** Tables with no tenant scope — migrated once, outside the per-scope loop. */
  unscoped(table: string): Array<Record<string, unknown>> {
    return this.db.prepare(`SELECT * FROM "${table}"`).all() as unknown as Array<Record<string, unknown>>;
  }

  close(): void {
    this.db.close();
  }
}
