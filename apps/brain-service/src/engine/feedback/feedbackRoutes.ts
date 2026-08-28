/**
 * Feedback on an answer, as an API.
 *
 * 🚨 EVIDENCE, NOT A CONTROL. Nothing in here edits a message, regenerates a
 * turn or influences the next answer. A vote records what a person thought so it
 * can be studied later — the moment feedback could change an answer, pressing
 * the button would carry a consequence nobody asked for.
 *
 * THE ENGINEER SEAM EXISTS NOW, DELIBERATELY. `schemaVersion` and the turn
 * provenance travel with every record so a later evaluation pipeline can read
 * these rows without a migration. Those fields cannot be back-filled: by the time
 * anyone wants them, the turn they describe is gone. Building the consumer is a
 * different slice; leaving room for it costs nothing today.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { scopeFrom } from '../memory/memoryRoutes.js';
import {
  FEEDBACK_REASONS,
  FEEDBACK_SCHEMA_VERSION,
  MAX_DETAIL,
  type FeedbackRating,
  type FeedbackReason,
  type FeedbackTurnContext,
  type MessageFeedback,
} from '../persistence/postgres/messageFeedbackRepo.js';

export interface FeedbackStore {
  putMessageFeedback(
    scope: { owner: string; workspace: string },
    input: Omit<MessageFeedback, 'createdAt' | 'updatedAt'>,
    now: number,
  ): Promise<MessageFeedback>;
  removeMessageFeedback(
    scope: { owner: string; workspace: string }, conversationId: string, messageId: string,
  ): Promise<boolean>;
  listMessageFeedback(
    scope: { owner: string; workspace: string }, conversationId: string,
  ): Promise<MessageFeedback[]>;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;

interface Body {
  conversationId?: unknown;
  messageId?: unknown;
  rating?: unknown;
  reason?: unknown;
  detail?: unknown;
  requestId?: unknown;
  modelId?: unknown;
  providerId?: unknown;
  turnContext?: unknown;
}

/** Only the fields we named. An arbitrary object from a client must not become
 *  a place to smuggle unbounded content into a table nobody is watching. */
function safeTurnContext(raw: unknown): FeedbackTurnContext | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const out: FeedbackTurnContext = {};
  if (typeof r.grounded === 'boolean') out.grounded = r.grounded;
  if (typeof r.hadImages === 'boolean') out.hadImages = r.hadImages;
  if (typeof r.hadDocuments === 'boolean') out.hadDocuments = r.hadDocuments;
  if (typeof r.refused === 'boolean') out.refused = r.refused;
  if (typeof r.capability === 'string') out.capability = r.capability.slice(0, 64);
  return Object.keys(out).length > 0 ? out : undefined;
}

export function registerFeedbackRoutes(app: FastifyInstance, store: FeedbackStore): void {
  /** The vocabulary, so the product never hard-codes its own copy of it. */
  app.get('/api/ai/feedback/reasons', async () => ({
    reasons: FEEDBACK_REASONS,
    maxDetail: MAX_DETAIL,
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
  }));

  /** Every vote in one conversation, so a transcript can render its own state. */
  app.get<{ Params: { id: string } }>(
    '/api/ai/conversations/:id/feedback',
    async (request) => {
      const s = scopeFrom(request);
      const items = await store.listMessageFeedback(
        { owner: s.owner, workspace: s.workspace },
        decodeURIComponent(request.params.id),
      );
      return { feedback: items };
    },
  );

  app.put(
    '/api/ai/feedback',
    async (request: FastifyRequest<{ Body: Body }>, reply: FastifyReply) => {
      const b = request.body ?? {};
      if (typeof b.conversationId !== 'string' || !ID.test(b.conversationId)) {
        return reply.code(400).send({ error: 'conversationId is required.' });
      }
      if (typeof b.messageId !== 'string' || !ID.test(b.messageId)) {
        return reply.code(400).send({ error: 'messageId is required.' });
      }
      if (b.rating !== 'up' && b.rating !== 'down') {
        return reply.code(400).send({ error: "rating must be 'up' or 'down'." });
      }
      /*
       * A reason belongs to a negative vote. Accepting one on a thumbs-up would
       * put "incorrect" beside an answer somebody LIKED, and every later count
       * of that reason would be wrong.
       */
      let reason: FeedbackReason | undefined;
      if (b.reason !== undefined && b.reason !== null) {
        if (typeof b.reason !== 'string' || !(FEEDBACK_REASONS as readonly string[]).includes(b.reason)) {
          return reply.code(400).send({ error: 'reason is not one of the accepted values.' });
        }
        if (b.rating !== 'down') {
          return reply.code(400).send({ error: 'A reason may only accompany negative feedback.' });
        }
        reason = b.reason as FeedbackReason;
      }
      if (b.detail !== undefined && b.detail !== null && typeof b.detail !== 'string') {
        return reply.code(400).send({ error: 'detail must be text.' });
      }

      const s = scopeFrom(request);
      const record = await store.putMessageFeedback(
        { owner: s.owner, workspace: s.workspace },
        {
          conversationId: b.conversationId,
          messageId: b.messageId,
          rating: b.rating as FeedbackRating,
          ...(reason ? { reason } : {}),
          ...(typeof b.detail === 'string' && b.detail.trim() ? { detail: b.detail.trim() } : {}),
          ...(typeof b.requestId === 'string' && ID.test(b.requestId) ? { requestId: b.requestId } : {}),
          ...(typeof b.modelId === 'string' ? { modelId: b.modelId.slice(0, 128) } : {}),
          ...(typeof b.providerId === 'string' ? { providerId: b.providerId.slice(0, 64) } : {}),
          ...(safeTurnContext(b.turnContext) ? { turnContext: safeTurnContext(b.turnContext)! } : {}),
        },
        Date.now(),
      );
      return { feedback: record };
    },
  );

  app.delete(
    '/api/ai/feedback',
    async (request: FastifyRequest<{ Body: Body }>, reply: FastifyReply) => {
      const b = request.body ?? {};
      if (typeof b.conversationId !== 'string' || typeof b.messageId !== 'string') {
        return reply.code(400).send({ error: 'conversationId and messageId are required.' });
      }
      const s = scopeFrom(request);
      const removed = await store.removeMessageFeedback(
        { owner: s.owner, workspace: s.workspace }, b.conversationId, b.messageId,
      );
      // Not an error when there was nothing there: withdrawing a vote you never
      // cast leaves you in exactly the state you asked for.
      return { removed };
    },
  );
}
