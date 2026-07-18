// Intelligent Provider Router — Slice 4: read-only budget + usage API.
//
//   GET  /api/ai/providers/budget            (scope status + reservation totals)
//   GET  /api/ai/providers/usage             (bounded ledger query + summary)
//   GET  /api/ai/providers/usage/:id         (records for one correlation id)
//   POST /api/ai/providers/budget/estimate   ({providerId, modelId, promptChars})
//
// Read-only: no ledger mutation, no client-controlled limit increase, no secrets,
// no prompts/responses. Explicit estimated-vs-actual labels.
//
// © MigraTeck LLC.

import type { FastifyInstance } from 'fastify';
import type { BudgetManager } from './budgetManager.js';
import type { UsageLedger } from './usageLedger.js';
import { PricingBook } from './pricing.js';
import { estimateCost } from './costEstimation.js';

export interface BudgetRoutesDeps {
  budget: BudgetManager;
  ledger: UsageLedger;
  pricing: PricingBook;
  maxOutputTokens?: number;
}

export function registerBudgetRoutes(app: FastifyInstance, deps: BudgetRoutesDeps): void {
  const maxOut = deps.maxOutputTokens ?? 2000;

  app.get('/api/ai/providers/budget', async () => ({
    enabled: deps.budget.isEnabled(),
    currency: 'USD',
    scopes: deps.budget.status(),
  }));

  app.get<{ Querystring: { provider?: string; model?: string; localOrCloud?: string; limit?: string; offset?: string } }>('/api/ai/providers/usage', async (request) => {
    const q = request.query ?? {};
    const records = deps.ledger.query({
      providerId: q.provider,
      modelId: q.model,
      localOrCloud: q.localOrCloud === 'local' || q.localOrCloud === 'cloud' ? q.localOrCloud : undefined,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
    return { records, summary: deps.ledger.summary() };
  });

  app.get<{ Params: { id: string } }>('/api/ai/providers/usage/:id', async (request) => ({
    correlationId: request.params.id,
    records: deps.ledger.byCorrelation(request.params.id),
  }));

  app.post<{ Body: { providerId?: string; modelId?: string; promptChars?: number; maxOutputTokens?: number } }>('/api/ai/providers/budget/estimate', async (request, reply) => {
    const b = request.body ?? {};
    if (!b.providerId || !b.modelId) {
      reply.code(400);
      return { ok: false, code: 'BAD_REQUEST', error: 'providerId and modelId are required' };
    }
    const inTok = Math.ceil((b.promptChars ?? 0) / 4);
    const estimate = estimateCost(deps.pricing.get(b.providerId, b.modelId), inTok, Math.min(b.maxOutputTokens ?? maxOut, maxOut));
    return { ok: true, estimate: { ...estimate, label: 'estimated' } };
  });
}
