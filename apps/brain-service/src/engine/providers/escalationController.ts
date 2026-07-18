// Intelligent Provider Router — Slice 3: escalation controller.
//
// Glue for the two-step, approval-gated cloud escalation:
//   offer()   — classify a local outcome, evaluate eligibility, and (if eligible)
//               mint a single-use offer. NEVER calls cloud. Audits offered/denied.
//   approve() — consume the single-use offer + re-validate the target, then run
//               EXACTLY ONE attributed cloud attempt via the executor.
//
// © MigraTeck LLC.

import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { auditStore } from '../auditLog.js';
import type { ExecutionPolicyId } from './executionPolicy.js';
import type { FleetRegistry } from './fleetRegistry.js';
import { ProviderRegistry } from './providerRegistry.js';
import { classifyLocalFailure, evaluateEscalation, type EscalationDecision, type LocalOutcome } from './escalation.js';
import { EscalationOfferStore, hashRequest } from './escalationStore.js';
import { CloudEscalationExecutor, type CloudAttemptResult } from './cloudEscalationExecutor.js';
import type { ProviderCapabilities } from './types.js';

export interface OfferResult extends EscalationDecision {
  offerId?: string;
  token?: string;
  expiresAt?: number;
}

export interface OfferInput {
  correlationId: string;
  policy: ExecutionPolicyId;
  outcome: LocalOutcome;
  request: ChatTurnRequest;
  requiredCaps?: Partial<ProviderCapabilities>;
}

export interface ApproveInput {
  correlationId: string;
  offerId: string;
  token: string;
  request: ChatTurnRequest;
}

/** A gate rejection (offer invalid / target ineligible) — no cloud attempt ran. */
export interface ApproveGateRejection {
  gate: true;
  code: 'OFFER_INVALID' | 'TARGET_INELIGIBLE' | 'UNKNOWN_TARGET';
  detail: string;
}
/** Either a gate rejection (no cloud call) or the outcome of the one cloud attempt. */
export type ApproveResult = ApproveGateRejection | CloudAttemptResult;

export function isGateRejection(r: ApproveResult): r is ApproveGateRejection {
  return (r as ApproveGateRejection).gate === true;
}

export class EscalationController {
  constructor(
    private readonly store: EscalationOfferStore,
    private readonly executor: CloudEscalationExecutor,
    private readonly fleet: FleetRegistry,
    private readonly providers: ProviderRegistry,
    private readonly budgetCapUsd: number,
  ) {}

  private estTokens(request: ChatTurnRequest): { input: number; output: number } {
    const chars = (request.userPrompt ?? '').length + JSON.stringify(request.context ?? {}).length;
    return { input: Math.ceil(chars / 4) + 500, output: 800 };
  }

  /** Decide whether to OFFER escalation. Never calls cloud. */
  async offer(input: OfferInput): Promise<OfferResult> {
    const reason = classifyLocalFailure(input.outcome);
    const snapshot = await this.fleet.snapshot();
    const est = this.estTokens(input.request);
    const decision = evaluateEscalation({
      policy: input.policy,
      reason,
      fleet: snapshot,
      requiredCaps: input.requiredCaps ?? { coding: true },
      estInputTokens: est.input,
      estOutputTokens: est.output,
      budgetCapUsd: this.budgetCapUsd,
    });

    if (!decision.offered || !decision.reason || !decision.target) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: decision.reason ?? 'none', fields: { policy: input.policy, denied: decision.deniedReason ?? 'not offered' } });
      return decision;
    }

    const offer = this.store.mint({ requestHash: hashRequest(input.request), reason: decision.reason, target: decision.target, estCostUsd: decision.estCostUsd ?? 0 });
    auditStore.append({ correlationId: input.correlationId, type: 'escalation.offered', component: 'escalation', outcome: decision.reason, fields: { policy: input.policy, provider: decision.target.providerId, model: decision.target.modelId, estCostUsd: decision.estCostUsd ?? 0 } });
    return { ...decision, offerId: offer.offerId, token: offer.token, expiresAt: offer.expiresAt };
  }

  /** Consume the offer + re-validate the target, then run ONE cloud attempt. */
  async approve(input: ApproveInput): Promise<ApproveResult> {
    const consumed = this.store.consume(input.offerId, input.token, hashRequest(input.request));
    if (!consumed.ok) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: consumed.reason, fields: { stage: 'approve' } });
      return { gate: true, code: 'OFFER_INVALID', detail: consumed.reason };
    }
    const offer = consumed.offer;
    const provider = this.providers.get(offer.target.providerId);
    if (!provider) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: 'UNKNOWN_TARGET', fields: { provider: offer.target.providerId } });
      return { gate: true, code: 'UNKNOWN_TARGET', detail: 'target provider no longer registered' };
    }
    // Re-validate the target is STILL eligible at approval time (state may have
    // changed since the offer was minted).
    if (provider.kind !== 'cloud' || !provider.enabled || (provider.credentialEnv && !this.providers.hasCredential(provider))) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: 'TARGET_INELIGIBLE', fields: { provider: provider.id } });
      return { gate: true, code: 'TARGET_INELIGIBLE', detail: 'target provider is no longer eligible' };
    }
    auditStore.append({ correlationId: input.correlationId, type: 'escalation.approved', component: 'escalation', outcome: offer.reason, fields: { provider: provider.id, model: offer.target.modelId, reason: offer.reason } });
    return this.executor.attempt({ correlationId: input.correlationId, provider, modelId: offer.target.modelId, reason: offer.reason, request: input.request });
  }
}
