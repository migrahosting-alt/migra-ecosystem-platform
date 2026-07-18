// Intelligent Provider Router — Slice 3: the escalation approval endpoint.
//
//   POST /api/ai/escalation/approve  { offerId, token, request }
//
// The ONLY way a cloud attempt runs. It consumes a single-use offer (minted when a
// local coding turn failed with a defined reason) and executes exactly one
// attributed cloud completion. No offer → no cloud. Nothing here escalates
// silently.
//
// © MigraTeck LLC.

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { newCorrelationId } from '../correlation.js';
import { isGateRejection, type EscalationController } from './escalationController.js';

interface ApproveBody {
  offerId?: string;
  token?: string;
  request?: ChatTurnRequest;
}

function correlationId(request: FastifyRequest): string {
  return String((request.headers['x-correlation-id'] as string | undefined) ?? '').trim();
}

export function registerEscalationRoutes(app: FastifyInstance, controller: EscalationController): void {
  app.post<{ Body: ApproveBody }>('/api/ai/escalation/approve', async (request, reply) => {
    const body = request.body ?? {};
    const cid = correlationId(request) || newCorrelationId();
    if (!body.offerId || !body.token || !body.request) {
      reply.code(400);
      return { ok: false, code: 'BAD_REQUEST', error: 'offerId, token, and request are required', correlationId: cid };
    }
    const result = await controller.approve({ correlationId: cid, offerId: body.offerId, token: body.token, request: body.request });

    if (isGateRejection(result)) {
      reply.code(result.code === 'OFFER_INVALID' ? 409 : 403);
      return { ok: false, code: result.code, error: result.detail, correlationId: cid };
    }
    // A cloud attempt ran (exactly one). Report it truthfully + attributed.
    if (!result.ok) {
      reply.code(502);
      return { ok: false, code: 'ESCALATION_FAILED', error: result.error, correlationId: cid, escalation: { provider: result.provider, model: result.model, reason: result.reason, viaEscalation: true } };
    }
    return {
      ok: true,
      correlationId: cid,
      escalation: { provider: result.provider, model: result.model, reason: result.reason, viaEscalation: true },
      content: result.content,
      usage: result.usage,
    };
  });
}
