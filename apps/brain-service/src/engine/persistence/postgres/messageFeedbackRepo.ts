/**
 * What a person thought of an answer.
 *
 * ONE ROW PER MESSAGE PER OWNER. The primary key does the work: changing your
 * mind is an UPDATE, withdrawing is a DELETE, and a double-click cannot become
 * two contradictory votes. An append-only log would push that reconciliation
 * onto every future reader, and they would each solve it slightly differently.
 *
 * 🚨 THIS IS EVIDENCE, NOT A CONTROL. Nothing here changes an answer,
 * regenerates a turn, or feeds a model. A vote is a fact about what someone
 * thought, recorded so it can be studied later — treating it as an instruction
 * would make the button dangerous to press.
 */

import type { PoolClient } from 'pg';

/** The vocabulary a negative vote may use. Fixed on purpose: free text alone
 *  cannot be counted, and a hundred uncounted complaints are not a signal. */
export const FEEDBACK_REASONS = [
  'incorrect',
  'misunderstood_request',
  'poor_quality',
  'unsafe_or_unhelpful',
  'tool_failure',
  'other',
] as const;
export type FeedbackReason = (typeof FEEDBACK_REASONS)[number];

export type FeedbackRating = 'up' | 'down';

/** Bounded turn provenance. Small, and never user content. */
export interface FeedbackTurnContext {
  grounded?: boolean;
  hadImages?: boolean;
  hadDocuments?: boolean;
  refused?: boolean;
  capability?: string;
}

export interface MessageFeedback {
  conversationId: string;
  messageId: string;
  rating: FeedbackRating;
  reason?: FeedbackReason;
  detail?: string;
  requestId?: string;
  modelId?: string;
  providerId?: string;
  turnContext?: FeedbackTurnContext;
  createdAt: number;
  updatedAt: number;
}

export interface FeedbackScope {
  ownerScope: string;
  workspaceScope: string;
}

/** The record shape a later evaluation pipeline reads. Versioned so it can. */
export const FEEDBACK_SCHEMA_VERSION = 1;

/** Detail is a note, not an essay: bounded so one paste cannot dominate a table. */
export const MAX_DETAIL = 2000;

function rowToFeedback(r: Record<string, unknown>): MessageFeedback {
  return {
    conversationId: String(r.conversation_id),
    messageId: String(r.message_id),
    rating: String(r.rating) as FeedbackRating,
    ...(r.reason ? { reason: String(r.reason) as FeedbackReason } : {}),
    ...(r.detail ? { detail: String(r.detail) } : {}),
    ...(r.request_id ? { requestId: String(r.request_id) } : {}),
    ...(r.model_id ? { modelId: String(r.model_id) } : {}),
    ...(r.provider_id ? { providerId: String(r.provider_id) } : {}),
    ...(typeof r.turn_context === 'string' && r.turn_context
      ? { turnContext: safeContext(r.turn_context) }
      : {}),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

function safeContext(raw: string): FeedbackTurnContext {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as FeedbackTurnContext) : {};
  } catch {
    // A row whose context cannot be parsed is still a valid VOTE. Losing the
    // whole record because one metadata field is malformed would discard the
    // thing we actually wanted.
    return {};
  }
}

/*
 * Plain functions over a SCOPED client, matching every other repo here. The
 * scoping is not cosmetic: `inScope` sets the owner that row-level security
 * checks, so a repo that opened its own connection would quietly bypass tenant
 * isolation while every test still passed.
 */

export async function putFeedback(
  client: PoolClient,
  scope: FeedbackScope,
  input: Omit<MessageFeedback, 'createdAt' | 'updatedAt'>,
  now: number,
): Promise<MessageFeedback> {
  const detail = input.detail?.slice(0, MAX_DETAIL);
  const { rows } = await client.query(
    `INSERT INTO message_feedback
       (owner_scope, workspace_scope, conversation_id, message_id, rating, reason, detail,
        request_id, model_id, provider_id, turn_context, schema_version, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
     ON CONFLICT (owner_scope, workspace_scope, conversation_id, message_id)
     DO UPDATE SET rating = EXCLUDED.rating,
                   reason = EXCLUDED.reason,
                   detail = EXCLUDED.detail,
                   request_id = COALESCE(EXCLUDED.request_id, message_feedback.request_id),
                   model_id = COALESCE(EXCLUDED.model_id, message_feedback.model_id),
                   provider_id = COALESCE(EXCLUDED.provider_id, message_feedback.provider_id),
                   turn_context = COALESCE(EXCLUDED.turn_context, message_feedback.turn_context),
                   updated_at = EXCLUDED.updated_at
     RETURNING *`,
    [
      scope.ownerScope, scope.workspaceScope, input.conversationId, input.messageId,
      input.rating, input.reason ?? null, detail ?? null,
      input.requestId ?? null, input.modelId ?? null, input.providerId ?? null,
      input.turnContext ? JSON.stringify(input.turnContext) : null,
      FEEDBACK_SCHEMA_VERSION, now,
    ],
  );
  return rowToFeedback(rows[0] as Record<string, unknown>);
}

/** Withdraw a vote. Returns whether there was one to withdraw. */
export async function removeFeedback(
  client: PoolClient, scope: FeedbackScope, conversationId: string, messageId: string,
): Promise<boolean> {
  const { rowCount } = await client.query(
    `DELETE FROM message_feedback
      WHERE owner_scope = $1 AND workspace_scope = $2
        AND conversation_id = $3 AND message_id = $4`,
    [scope.ownerScope, scope.workspaceScope, conversationId, messageId],
  );
  return (rowCount ?? 0) > 0;
}

/**
 * Every vote in one conversation.
 *
 * Read per conversation rather than per message: a transcript renders all its
 * turns at once, and asking once beats asking forty times.
 */
export async function listFeedbackForConversation(
  client: PoolClient, scope: FeedbackScope, conversationId: string,
): Promise<MessageFeedback[]> {
  const { rows } = await client.query(
    `SELECT * FROM message_feedback
      WHERE owner_scope = $1 AND workspace_scope = $2 AND conversation_id = $3`,
    [scope.ownerScope, scope.workspaceScope, conversationId],
  );
  return (rows as Record<string, unknown>[]).map(rowToFeedback);
}
