/**
 * Transferring an anonymous conversation to the account that just signed in.
 *
 * WHY THIS IS NOT AN UPDATE. Row-level security's `WITH CHECK` refuses to let a
 * row be rewritten into a scope other than the declared one — which is exactly
 * right, and is what stops "make this conversation mine" from being a thing a
 * request can ask for. So the transfer is explicit: read under the anonymous
 * scope, delete under it, re-insert under the account's scope, all inside ONE
 * transaction that declares each scope only while it is operating in it.
 *
 * THE ID IS PRESERVED. The person is looking at a conversation; signing in must
 * not swap it for a different one. Delete-then-insert inside a transaction keeps
 * the primary key free at the moment of insert, so the id survives.
 *
 * AUTHORITY. Nothing here decides whether the claim is allowed. The caller has
 * already verified an authenticated session AND a signed anonymous cookie; this
 * function moves rows between two scopes it is told about. A browser cannot
 * reach it with a user id of its choosing.
 */

import type { PoolClient } from 'pg';

export interface ClaimScopes {
  anonymousOwner: string;
  accountOwner: string;
  accountWorkspace: string;
}

export interface ClaimOutcome {
  conversationId: string;
  messages: number;
  summaries: number;
}

export class ClaimError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'ALREADY_CLAIMED', message: string) {
    super(message);
    this.name = 'ClaimError';
  }
}

const setScope = async (client: PoolClient, owner: string, workspace: string): Promise<void> => {
  await client.query(`SELECT set_config('migrapilot.owner_scope', $1, true)`, [owner]);
  await client.query(`SELECT set_config('migrapilot.workspace_scope', $1, true)`, [workspace]);
};

/**
 * Move one conversation, with its messages and summaries, into an account.
 *
 * The caller supplies the transaction so the whole move commits or none of it
 * does. A half-moved conversation — messages under one owner, the thread under
 * another — would be invisible to both.
 */
export async function claimConversation(
  client: PoolClient,
  conversationId: string,
  scopes: ClaimScopes,
  now: number,
): Promise<ClaimOutcome> {
  // ── read everything, under the ANONYMOUS scope ──────────────────────────
  await setScope(client, scopes.anonymousOwner, scopes.anonymousOwner);

  const conv = await client.query<Record<string, unknown>>(
    'SELECT * FROM conversations WHERE id = $1', [conversationId],
  );
  if (conv.rowCount === 0) {
    throw new ClaimError(
      'NOT_FOUND',
      `conversation '${conversationId}' is not visible to this anonymous session. It does not exist, ` +
        'or it belongs to a different visitor — the two are indistinguishable from here, deliberately.',
    );
  }
  const row = conv.rows[0]!;

  const messages = await client.query<Record<string, unknown>>(
    'SELECT * FROM conversation_messages WHERE conversation_id = $1 ORDER BY seq, created_at, id',
    [conversationId],
  );
  const summaries = await client.query<Record<string, unknown>>(
    'SELECT * FROM conversation_summaries WHERE conversation_id = $1', [conversationId],
  );

  // ── delete under the anonymous scope: children first, composite FKs ─────
  await client.query('DELETE FROM conversation_messages WHERE conversation_id = $1', [conversationId]);
  await client.query('DELETE FROM conversation_summaries WHERE conversation_id = $1', [conversationId]);
  const removed = await client.query('DELETE FROM conversations WHERE id = $1', [conversationId]);
  if (!removed.rowCount) {
    throw new ClaimError(
      'NOT_FOUND',
      `conversation '${conversationId}' could not be removed from the anonymous scope — nothing was moved`,
    );
  }

  // ── re-insert under the ACCOUNT scope, same id ──────────────────────────
  await setScope(client, scopes.accountOwner, scopes.accountWorkspace);

  await client.query(
    `INSERT INTO conversations
       (id, owner_scope, workspace_scope, title, memory_mode, created_at, updated_at, deleted_at, grounding_files)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      conversationId, scopes.accountOwner, scopes.accountWorkspace,
      row.title, row.memory_mode, row.created_at, now, row.deleted_at ?? null,
      row.grounding_files ?? null,
    ],
  );

  for (const m of messages.rows) {
    await client.query(
      `INSERT INTO conversation_messages
         (id, conversation_id, owner_scope, workspace_scope, role, content, status,
          request_id, model_id, provider_id, created_at, durable, supersedes_id, seq)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        m.id, conversationId, scopes.accountOwner, scopes.accountWorkspace,
        m.role, m.content, m.status, m.request_id ?? null, m.model_id ?? null,
        m.provider_id ?? null, m.created_at, m.durable, m.supersedes_id ?? null, m.seq,
      ],
    );
  }

  for (const s of summaries.rows) {
    await client.query(
      `INSERT INTO conversation_summaries
         (id, conversation_id, owner_scope, workspace_scope, source_from_message_id,
          source_to_message_id, summary_json, version, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        s.id, conversationId, scopes.accountOwner, scopes.accountWorkspace,
        s.source_from_message_id, s.source_to_message_id, s.summary_json, s.version, s.created_at,
      ],
    );
  }

  return {
    conversationId,
    messages: messages.rowCount ?? 0,
    summaries: summaries.rowCount ?? 0,
  };
}
