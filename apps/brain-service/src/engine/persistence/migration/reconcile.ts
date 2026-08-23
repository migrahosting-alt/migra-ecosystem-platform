/**
 * Stage 4 — exact reconciliation.
 *
 * Compares the imported PostgreSQL state against the legacy source field by
 * field. A count that matches is not parity; two conversations can have the same
 * message count and different messages.
 *
 * One deliberate exception, and it is the only one: the legacy chunk ROW ID is
 * not compared. Migration 11 changed persistence identity on purpose — SQLite
 * keyed chunks by `${indexId}:v${version}:${path}#${line}`, PostgreSQL keys them
 * by (owner, workspace, index, logical key) with the logical key being the
 * engine's own `${path}#${line}`. Requiring the old string to survive would be
 * requiring the defect to survive. LOGICAL chunk identity and content are
 * compared instead, which is what retrieval actually depends on.
 */

import { createHash } from 'node:crypto';
import type { PostgresDurableStore } from '../postgresStore.js';
import { LegacySource, type LegacyScope } from './legacySource.js';
import { logicalChunkKey, toChunk } from './records.js';

export interface ParityMismatch {
  domain: string;
  scope: string;
  id: string;
  field: string;
  legacy: unknown;
  postgres: unknown;
}

export interface ParityReport {
  comparedScopes: number;
  comparedConversations: number;
  /** Legacy conversations that were soft-deleted, and so must NOT load. */
  deletedConversationsChecked: number;
  comparedMessages: number;
  comparedSummaries: number;
  comparedWorkspaces: number;
  comparedIndexes: number;
  comparedChunks: number;
  mismatches: ParityMismatch[];
  exact: boolean;
}

const scopeLabel = (s: LegacyScope) => `${s.ownerScope} / ${s.workspaceScope}`;

/** Order-insensitive comparison for a set-valued field like grounding files. */
const sameSet = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean => {
  const x = [...(a ?? [])].sort();
  const y = [...(b ?? [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

/** Content fingerprint of a chunk — what retrieval actually serves. */
const chunkFingerprint = (c: { text: string; contentHash: string; startLine: number; endLine: number; vector: number[] }): string =>
  createHash('sha256').update(JSON.stringify([
    c.contentHash, c.startLine, c.endLine, c.text,
    // Float32 round-trips exactly through JS numbers, so an equal vector must
    // fingerprint equal. A drifted vector means retrieval ranking changed.
    c.vector,
  ])).digest('hex');

export async function reconcile(
  source: LegacySource, store: PostgresDurableStore,
): Promise<ParityReport> {
  const mismatches: ParityMismatch[] = [];
  const report: ParityReport = {
    comparedScopes: 0, comparedConversations: 0, deletedConversationsChecked: 0,
    comparedMessages: 0, comparedSummaries: 0,
    comparedWorkspaces: 0, comparedIndexes: 0, comparedChunks: 0, mismatches, exact: false,
  };

  const miss = (domain: string, scope: LegacyScope, id: string, field: string, legacy: unknown, postgres: unknown) => {
    mismatches.push({ domain, scope: scopeLabel(scope), id, field, legacy, postgres });
  };

  for (const scope of source.scopes()) {
    report.comparedScopes += 1;
    const persistScope = { owner: scope.ownerScope, workspace: scope.workspaceScope };

    // ── conversations, messages, summaries ────────────────────────────────
    const loaded = await store.loadDurableForScope(persistScope);
    const pgConversations = new Map(loaded.conversations.map((c) => [c.id, c]));
    const pgMessages = new Map<string, typeof loaded.messages>();
    for (const m of loaded.messages) {
      const list = pgMessages.get(m.conversationId) ?? [];
      list.push(m);
      pgMessages.set(m.conversationId, list);
    }
    const pgSummaries = new Map<string, typeof loaded.summaries>();
    for (const s of loaded.summaries) {
      const list = pgSummaries.get(s.conversationId) ?? [];
      list.push(s);
      pgSummaries.set(s.conversationId, list);
    }

    const legacyConversations = source.conversations(scope);
    for (const row of legacyConversations) {
      report.comparedConversations += 1;
      const pg = pgConversations.get(row.id);

      /*
       * A SOFT-DELETED legacy conversation must not load.
       *
       * `loadDurable` filters `deleted_at IS NULL`, so for these the correct
       * parity result is ABSENCE from the loaded set — not presence. Comparing
       * them like live conversations would report every deleted thread as lost,
       * and "fixing" that would mean resurrecting threads users deleted.
       */
      if (row.deleted_at !== null) {
        report.deletedConversationsChecked += 1;
        if (pg) miss('conversation', scope, row.id, 'deleted-but-loadable', 'absent', 'present');
        continue;
      }

      if (!pg) {
        miss('conversation', scope, row.id, 'present', true, false);
        continue;
      }
      if (pg.ownerScope !== row.owner_scope) miss('conversation', scope, row.id, 'ownerScope', row.owner_scope, pg.ownerScope);
      if (pg.workspaceScope !== row.workspace_scope) miss('conversation', scope, row.id, 'workspaceScope', row.workspace_scope, pg.workspaceScope);
      if (pg.title !== (row.title ?? '')) miss('conversation', scope, row.id, 'title', row.title, pg.title);
      if (pg.memoryMode !== row.memory_mode) miss('conversation', scope, row.id, 'memoryMode', row.memory_mode, pg.memoryMode);
      if (Number(pg.createdAt) !== Number(row.created_at)) miss('conversation', scope, row.id, 'createdAt', row.created_at, pg.createdAt);
      // Reaching here means the legacy row was NOT deleted, so the loaded one
      // must not be either.
      if (pg.deletedAt !== undefined) miss('conversation', scope, row.id, 'deletedAt', undefined, pg.deletedAt);

      const legacyGrounding: string[] | undefined = row.grounding_files === null || row.grounding_files === ''
        ? undefined
        : (JSON.parse(row.grounding_files) as string[]);
      // "no grounding set" and "an empty grounding set" are different facts.
      if ((legacyGrounding === undefined) !== (pg.groundingFiles === undefined)
        || !sameSet(legacyGrounding, pg.groundingFiles)) {
        miss('conversation', scope, row.id, 'groundingFiles', legacyGrounding, pg.groundingFiles);
      }

      // Messages: count, ORDER, ids and content all matter.
      const legacyMessages = source.messages(row.id);
      const got = pgMessages.get(row.id) ?? [];
      report.comparedMessages += legacyMessages.length;
      if (got.length !== legacyMessages.length) {
        miss('messages', scope, row.id, 'count', legacyMessages.length, got.length);
      }
      for (let i = 0; i < legacyMessages.length; i += 1) {
        const l = legacyMessages[i]!;
        const p = got[i];
        if (!p) { miss('message', scope, l.id, 'present', true, false); continue; }
        if (p.id !== l.id) miss('message', scope, `${row.id}[${i}]`, 'id/order', l.id, p.id);
        if (p.role !== l.role) miss('message', scope, l.id, 'role', l.role, p.role);
        if (p.content !== l.content) miss('message', scope, l.id, 'content', `${l.content.length} chars`, `${p.content.length} chars`);
        if (p.status !== l.status) miss('message', scope, l.id, 'status', l.status, p.status);
        if (Number(p.createdAt) !== Number(l.created_at)) miss('message', scope, l.id, 'createdAt', l.created_at, p.createdAt);
        if (p.durable !== (Number(l.durable) === 1)) miss('message', scope, l.id, 'durable', Number(l.durable) === 1, p.durable);
      }

      const legacySummaries = source.summaries(row.id);
      const gotSummaries = pgSummaries.get(row.id) ?? [];
      report.comparedSummaries += legacySummaries.length;
      if (gotSummaries.length !== legacySummaries.length) {
        miss('summaries', scope, row.id, 'count', legacySummaries.length, gotSummaries.length);
      }
      for (const l of legacySummaries) {
        const p = gotSummaries.find((s) => s.id === l.id);
        if (!p) { miss('summary', scope, l.id, 'present', true, false); continue; }
        if (Number(p.version) !== Number(l.version ?? 1)) miss('summary', scope, l.id, 'version', l.version, p.version);
        if (Number(p.createdAt) !== Number(l.created_at)) miss('summary', scope, l.id, 'createdAt', l.created_at, p.createdAt);
      }
    }

    // Anything in PostgreSQL that the legacy source does not have is also a
    // parity failure — an import that INVENTS rows is as wrong as one that
    // drops them.
    const legacyIds = new Set(legacyConversations.map((c) => c.id));
    for (const id of pgConversations.keys()) {
      if (!legacyIds.has(id)) miss('conversation', scope, id, 'unexpected', false, true);
    }

    // ── workspaces ────────────────────────────────────────────────────────
    const legacyWorkspaces = source.workspaces(scope);
    const pgWorkspaces = new Map((await store.loadWorkspacesForScope(persistScope)).map((w) => [w.id, w]));
    for (const row of legacyWorkspaces) {
      report.comparedWorkspaces += 1;
      const pg = pgWorkspaces.get(row.id);
      if (!pg) { miss('workspace', scope, row.id, 'present', true, false); continue; }
      if (pg.root !== row.root) miss('workspace', scope, row.id, 'root', row.root, pg.root);
      if (pg.name !== row.name) miss('workspace', scope, row.id, 'name', row.name, pg.name);
      if (pg.memoryMode !== row.memory_mode) miss('workspace', scope, row.id, 'memoryMode', row.memory_mode, pg.memoryMode);
      if ((pg.indexId ?? null) !== row.index_id) miss('workspace', scope, row.id, 'indexId', row.index_id, pg.indexId);
    }

    // ── indexes, versions, chunks ─────────────────────────────────────────
    const legacyIndexes = source.indexes(scope);
    const pgIndexes = new Map((await store.loadIndexesForScope(persistScope)).map((i) => [i.id, i]));
    for (const row of legacyIndexes) {
      report.comparedIndexes += 1;
      const pg = pgIndexes.get(row.id);
      if (!pg) { miss('index', scope, row.id, 'present', true, false); continue; }
      if (pg.root !== row.root) miss('index', scope, row.id, 'root', row.root, pg.root);
      if (pg.sourceType !== row.source_type) miss('index', scope, row.id, 'sourceType', row.source_type, pg.sourceType);
      if (pg.state !== row.state) miss('index', scope, row.id, 'state', row.state, pg.state);
      if (Number(pg.version) !== Number(row.version)) miss('index', scope, row.id, 'version', row.version, pg.version);
      const legacyApproved = row.approved_version === null ? undefined : Number(row.approved_version);
      if ((pg.approvedVersion ?? undefined) !== legacyApproved) {
        miss('index', scope, row.id, 'approvedVersion', legacyApproved, pg.approvedVersion);
      }
      if (pg.embeddingModel !== row.embedding_model) miss('index', scope, row.id, 'embeddingModel', row.embedding_model, pg.embeddingModel);

      for (const version of source.chunkVersions(row.id)) {
        const legacyChunks = source.chunks(row.id, version).map(toChunk);
        const pgChunks = await store.loadChunksForScope(persistScope, row.id, version);
        report.comparedChunks += legacyChunks.length;

        if (pgChunks.length !== legacyChunks.length) {
          miss('chunks', scope, `${row.id}@v${version}`, 'count', legacyChunks.length, pgChunks.length);
        }

        // LOGICAL identity, deliberately — see the file header.
        const pgByKey = new Map(pgChunks.map((c) => [c.id, c]));
        for (const l of legacyChunks) {
          const key = logicalChunkKey(l.filePath, l.startLine);
          const p = pgByKey.get(key);
          if (!p) { miss('chunk', scope, `${row.id}@v${version}:${key}`, 'present', true, false); continue; }
          if (p.filePath !== l.filePath) miss('chunk', scope, key, 'filePath', l.filePath, p.filePath);
          if (chunkFingerprint(p) !== chunkFingerprint(l)) {
            miss('chunk', scope, `${row.id}@v${version}:${key}`, 'content/vector', 'legacy fingerprint', 'differs');
          }
          pgByKey.delete(key);
        }
        for (const key of pgByKey.keys()) {
          miss('chunk', scope, `${row.id}@v${version}:${key}`, 'unexpected', false, true);
        }
      }
    }
  }

  report.exact = mismatches.length === 0;
  return report;
}
