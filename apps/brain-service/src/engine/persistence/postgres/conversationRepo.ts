/**
 * MigraAI Engine — PostgreSQL conversation persistence (Group 1).
 *
 * Implements the SQLite semantics exactly. Where the two engines differ
 * naturally, the difference is normalised HERE so callers see one contract:
 *
 *   INSERT OR IGNORE   → ON CONFLICT (id) DO NOTHING
 *   INSERT OR REPLACE  → ON CONFLICT (id) DO UPDATE SET <every column>
 *   rowid tie-break    → ins_seq BIGSERIAL
 *   epoch-ms integers  → BIGINT (no timestamp precision conversion at all)
 *   0/1 durable flag   → BOOLEAN, converted at this boundary
 *   NULL ordering      → explicit NULLS FIRST, matching SQLite's default
 *
 * `pg` returns BIGINT as a string to avoid precision loss; every numeric column
 * is therefore converted explicitly rather than trusted to arrive as a number.
 */

import type { PoolClient } from 'pg';
import { requireAffected } from './ragRepo.js';
import type { Conversation, Message, Summary, MemoryMode, MessageRole, MessageStatus } from '../../memory/conversationStore.js';

export interface ScopedRequest {
  ownerScope: string;
  workspaceScope: string;
}

/** Every scoped statement runs inside a transaction with the scope declared. */
export async function withScope<T>(
  client: PoolClient,
  scope: ScopedRequest,
  fn: () => Promise<T>,
): Promise<T> {
  // `true` = transaction-local, so scope cannot leak to the next user of a
  // pooled connection.
  await client.query(`SELECT set_config('migrapilot.owner_scope', $1, true)`, [scope.ownerScope]);
  await client.query(`SELECT set_config('migrapilot.workspace_scope', $1, true)`, [scope.workspaceScope]);
  return fn();
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const optNum = (v: unknown): number | undefined => (v === null || v === undefined ? undefined : Number(v));
const optStr = (v: unknown): string | undefined => (v === null || v === undefined ? undefined : String(v));

export function rowToConversation(r: Record<string, unknown>): Conversation {
  return {
    id: String(r.id),
    ownerScope: String(r.owner_scope),
    workspaceScope: String(r.workspace_scope),
    title: String(r.title ?? ''),
    memoryMode: String(r.memory_mode ?? 'session') as MemoryMode,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
    ...(r.deleted_at !== null && r.deleted_at !== undefined ? { deletedAt: num(r.deleted_at) } : {}),
    // Unparseable JSON reads as "grounded in nothing" rather than throwing: one bad
    // row must not take the whole hydrate down on startup.
    // `[]` round-trips as an empty SET, not as absence — see saveConversation.
    ...(typeof r.image_refs === 'string' && r.image_refs.length > 0
      ? { imageRefs: safeJsonArray(r.image_refs) }
      : {}),
    ...(typeof r.grounding_files === 'string' && r.grounding_files.length > 0
      ? { groundingFiles: safeJsonArray(r.grounding_files) }
      : {}),
  };
}

function safeJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    role: String(r.role) as MessageRole,
    content: String(r.content ?? ''),
    status: String(r.status) as MessageStatus,
    ...(optStr(r.request_id) ? { requestId: String(r.request_id) } : {}),
    ...(optStr(r.model_id) ? { modelId: String(r.model_id) } : {}),
    ...(optStr(r.provider_id) ? { providerId: String(r.provider_id) } : {}),
    createdAt: num(r.created_at),
    durable: Boolean(r.durable),
    ...(optStr(r.supersedes_id) ? { supersedesId: String(r.supersedes_id) } : {}),
  };
}

export function rowToSummary(r: Record<string, unknown>): Summary {
  return {
    id: String(r.id),
    conversationId: String(r.conversation_id),
    sourceFromMessageId: String(r.source_from_message_id),
    sourceToMessageId: String(r.source_to_message_id),
    summary: JSON.parse(String(r.summary_json ?? '{}')),
    version: num(r.version),
    createdAt: num(r.created_at),
  };
}

/**
 * Mirrors SQLite's `ON CONFLICT(id) DO UPDATE SET title, updated_at`.
 *
 * Note what is deliberately NOT updated: owner/workspace scope. First write
 * wins, exactly as in SQLite — a conversation cannot be moved between tenants
 * by re-saving it.
 */
export async function saveConversation(client: PoolClient, c: Conversation): Promise<void> {
  await client.query(
    `INSERT INTO conversations
       -- Column order MATCHES parameter order on purpose. It used to run
       -- (…, deleted_at, grounding_files) against ($…,$9,$8), a deliberate
       -- crossover that was correct and invisible — until a column was added in
       -- the middle and the placeholders silently stopped lining up.
       (id, owner_scope, workspace_scope, title, memory_mode, created_at, updated_at,
        grounding_files, image_refs, deleted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, updated_at = EXCLUDED.updated_at,
       grounding_files = EXCLUDED.grounding_files,
       image_refs = EXCLUDED.image_refs,
       -- Never UN-deletes: an existing deletion wins over whatever is being
       -- written. Only an insert can carry a deletion timestamp in, which is
       -- what the legacy import needs.
       deleted_at = COALESCE(conversations.deleted_at, EXCLUDED.deleted_at)`,
    [
      c.id, c.ownerScope, c.workspaceScope, c.title, c.memoryMode, c.createdAt, c.updatedAt,
      // An EMPTY grounding set is a real user fact — "I detached every file" —
      // and is not the same as "I never attached one". Only `undefined` becomes
      // NULL. Collapsing `[]` to NULL made a cleared conversation come back
      // from a reload claiming it had never been grounded.
      c.groundingFiles === undefined ? null : JSON.stringify(c.groundingFiles),
      c.imageRefs === undefined ? null : JSON.stringify(c.imageRefs),
      c.deletedAt ?? null,
    ],
  );
}

/** Hard cascade delete, in SQLite's order: messages → summaries → conversation. */
export async function deleteConversation(client: PoolClient, id: string): Promise<void> {
  /*
   * DELETE SEMANTICS, DECIDED EXPLICITLY.
   *
   * `rowCount === 0` on the CONVERSATION is an error, not idempotent success.
   * Under FORCE row-level security "already gone" and "not yours / no scope
   * declared" are the same observation, and treating that as success is what let
   * an unscoped delete report completion while changing nothing — the
   * conversation then returned on the next restart.
   *
   * Callers reach here only after confirming the conversation is visible in
   * their own scope, so zero rows means something is genuinely wrong.
   *
   * Child rows are NOT required: a conversation may legitimately have no
   * messages or summaries yet.
   */
  await client.query('DELETE FROM conversation_messages WHERE conversation_id = $1', [id]);
  await client.query('DELETE FROM conversation_summaries WHERE conversation_id = $1', [id]);
  const r = await client.query('DELETE FROM conversations WHERE id = $1', [id]);
  requireAffected(r.rowCount, 'deleteConversation', id);
}

/**
 * Mirrors `INSERT OR IGNORE`: re-saving an existing id is a silent no-op, which
 * is what makes duplicate delivery safe.
 *
 * `seq` is set from `createdAt`, matching SQLite exactly — not from a sequence.
 */
export async function saveMessage(client: PoolClient, m: Message, scope: ScopedRequest): Promise<void> {
  await client.query(
    `INSERT INTO conversation_messages
       (id, conversation_id, owner_scope, workspace_scope, role, content, status,
        request_id, model_id, provider_id, created_at, durable, supersedes_id, seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [
      m.id, m.conversationId, scope.ownerScope, scope.workspaceScope, m.role, m.content, m.status,
      m.requestId ?? null, m.modelId ?? null, m.providerId ?? null, m.createdAt,
      m.durable, m.supersedesId ?? null, m.createdAt,
    ],
  );
}

/** Mirrors `INSERT OR REPLACE`: the whole row is replaced on id conflict. */
export async function saveSummary(client: PoolClient, s: Summary, scope: ScopedRequest): Promise<void> {
  await client.query(
    `INSERT INTO conversation_summaries
       (id, conversation_id, owner_scope, workspace_scope, source_from_message_id,
        source_to_message_id, summary_json, version, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       conversation_id        = EXCLUDED.conversation_id,
       source_from_message_id = EXCLUDED.source_from_message_id,
       source_to_message_id   = EXCLUDED.source_to_message_id,
       summary_json           = EXCLUDED.summary_json,
       version                = EXCLUDED.version,
       created_at             = EXCLUDED.created_at`,
    [
      s.id, s.conversationId, scope.ownerScope, scope.workspaceScope,
      s.sourceFromMessageId, s.sourceToMessageId, JSON.stringify(s.summary), s.version, s.createdAt,
    ],
  );
}

/**
 * Hydrate durable state for the CURRENT scope.
 *
 * Ordering matches SQLite exactly:
 *   messages   ORDER BY conversation_id, seq, ins_seq   (ins_seq ≡ rowid)
 *   summaries  ORDER BY conversation_id, version
 *   conversations — SQLite specifies no order, so none is imposed here either;
 *   callers must not depend on it, and the parity tests compare as sets.
 *
 * `NULLS FIRST` is explicit because PostgreSQL defaults to NULLS LAST in ASC
 * while SQLite sorts NULLs first — silently divergent otherwise.
 */
export async function loadDurable(
  client: PoolClient,
): Promise<{ conversations: Conversation[]; messages: Message[]; summaries: Summary[] }> {
  const conversations = await client.query<Record<string, unknown>>(
    'SELECT * FROM conversations WHERE deleted_at IS NULL',
  );
  const messages = await client.query<Record<string, unknown>>(
    `SELECT * FROM conversation_messages
      ORDER BY conversation_id NULLS FIRST, seq NULLS FIRST, ins_seq`,
  );
  const summaries = await client.query<Record<string, unknown>>(
    `SELECT * FROM conversation_summaries
      ORDER BY conversation_id NULLS FIRST, version NULLS FIRST`,
  );
  return {
    conversations: conversations.rows.map(rowToConversation),
    messages: messages.rows.map(rowToMessage),
    summaries: summaries.rows.map(rowToSummary),
  };
}

void optNum;
