// Intelligent Provider Router — Slice 1: read-only inspection API.
//
// Inspect the provider fleet, the execution policies, and a DRY-RUN selection
// plan. Read-only + dry-run: NO endpoint changes routing, executes a completion,
// or reveals a credential value. This is the observable foundation; Slice 2 wires
// actual routing.
//
//   GET  /api/ai/providers            (fleet snapshot + health; ?refresh=true probes)
//   GET  /api/ai/providers/policies   (the execution policy catalog + default)
//   POST /api/ai/providers/plan       ({ policy?, hints? } → dry-run selection plan)
//
// © MigraTeck LLC.

import type { FastifyInstance } from 'fastify';
import type { FleetRegistry } from './fleetRegistry.js';
import { EXECUTION_POLICIES, DEFAULT_POLICY, isExecutionPolicyId, PolicyEngine, type PlanHints } from './executionPolicy.js';

export interface ProviderRoutesDeps {
  fleet: FleetRegistry;
  engine: PolicyEngine;
  defaultPolicy?: string;
}

export function registerProviderRoutes(app: FastifyInstance, deps: ProviderRoutesDeps): void {
  const defaultPolicy = deps.defaultPolicy && isExecutionPolicyId(deps.defaultPolicy) ? deps.defaultPolicy : DEFAULT_POLICY;

  app.get<{ Querystring: { refresh?: string } }>('/api/ai/providers', async (request) => {
    if (String(request.query?.refresh ?? '') === 'true') await deps.fleet.refresh();
    const snapshot = await deps.fleet.snapshot();
    return {
      mode: 'Intelligent Provider Router — inspection only (no routing change)',
      defaultPolicy,
      generatedAt: snapshot.generatedAt,
      // Safe fleet view: provider summaries carry NO credential value; models are
      // safe descriptors (id/tier/capabilities only).
      providers: snapshot.providers.map((fp) => ({
        ...fp.provider,
        declaredCapabilities: fp.declaredCapabilities,
        effectiveCapabilities: fp.effectiveCapabilities,
        modelBackedCapabilities: fp.modelBackedCapabilities,
        models: fp.models.map((m) => ({ id: m.id, tier: m.tier, capabilities: m.capabilities })),
      })),
    };
  });

  app.get('/api/ai/providers/policies', async () => ({
    policies: Object.values(EXECUTION_POLICIES),
    default: defaultPolicy,
  }));

  app.post<{ Body: { policy?: string; hints?: PlanHints } }>('/api/ai/providers/plan', async (request, reply) => {
    const body = request.body ?? {};
    const policy = body.policy ?? defaultPolicy;
    if (!isExecutionPolicyId(policy)) {
      reply.code(400);
      return { ok: false, code: 'UNKNOWN_POLICY', error: 'unknown execution policy' };
    }
    const snapshot = await deps.fleet.snapshot();
    const plan = deps.engine.plan(policy, body.hints ?? {}, snapshot);
    return { ok: true, plan };
  });
}
