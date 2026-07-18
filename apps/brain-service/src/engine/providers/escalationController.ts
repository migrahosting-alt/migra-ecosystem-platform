// Intelligent Provider Router — Slice 3 + Slice 4: escalation controller.
//
//   offer()   — classify a local outcome, evaluate policy/provider eligibility,
//               PRICE the attempt, PREFLIGHT the budget, and (if all pass) mint a
//               single-use offer whose consent binds the WORST-CASE cost ceiling.
//               NEVER calls cloud.
//   approve() — consume the offer, re-validate target + ceiling, RESERVE budget
//               (the atomic gate — no reservation, no cloud), run EXACTLY ONE
//               attributed cloud attempt, reconcile actual usage against the
//               reservation, and write a metadata-only ledger record.
//
// © MigraTeck LLC.

import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { auditStore } from '../auditLog.js';
import type { ExecutionPolicyId } from './executionPolicy.js';
import type { FleetRegistry } from './fleetRegistry.js';
import { ProviderRegistry } from './providerRegistry.js';
import { classifyLocalFailure, evaluateEscalation, type EscalationReason, type LocalOutcome } from './escalation.js';
import { EscalationOfferStore, hashRequest } from './escalationStore.js';
import { CloudEscalationExecutor, type CloudAttemptResult } from './cloudEscalationExecutor.js';
import type { ProviderCapabilities } from './types.js';
import { PricingBook, isTrustedForHardEnforcement } from './budget/pricing.js';
import { estimateCost, estimateTokens, type CostEstimate } from './budget/costEstimation.js';
import { BudgetManager, type BudgetFailureCode } from './budget/budgetManager.js';
import { UsageLedger } from './budget/usageLedger.js';

export interface OfferResult {
  offered: boolean;
  reason: EscalationReason | null;
  target?: { providerId: string; modelId: string };
  deniedReason?: string;
  offerId?: string;
  token?: string;
  expiresAt?: number;
  // cost + budget surface (spec §5)
  estimate?: CostEstimate;
  worstCaseCostUsd?: number;
  remainingBudgetUsd?: number;
  costCeilingUsd?: number;
  dataLeavesLocal?: boolean;
}

export interface OfferInput {
  correlationId: string;
  policy: ExecutionPolicyId;
  outcome: LocalOutcome;
  request: ChatTurnRequest;
  requiredCaps?: Partial<ProviderCapabilities>;
  tenant?: string;
}

export interface ApproveInput {
  correlationId: string;
  offerId: string;
  token: string;
  request: ChatTurnRequest;
  tenant?: string;
}

export interface ApproveGateRejection {
  gate: true;
  code: 'OFFER_INVALID' | 'TARGET_INELIGIBLE' | 'UNKNOWN_TARGET' | 'CEILING_EXCEEDED' | BudgetFailureCode;
  detail: string;
}
export type ApproveResult = ApproveGateRejection | (CloudAttemptResult & { costUsd?: number; reservationId?: string });

export function isGateRejection(r: ApproveResult): r is ApproveGateRejection {
  return (r as ApproveGateRejection).gate === true;
}

export class EscalationController {
  constructor(
    private readonly store: EscalationOfferStore,
    private readonly executor: CloudEscalationExecutor,
    private readonly fleet: FleetRegistry,
    private readonly providers: ProviderRegistry,
    private readonly pricing: PricingBook,
    private readonly budget: BudgetManager,
    private readonly ledger: UsageLedger,
    private readonly maxOutputTokens = 2000,
  ) {}

  private estInputTokens(request: ChatTurnRequest): number {
    return estimateTokens((request.userPrompt ?? '') + JSON.stringify(request.context ?? {}));
  }

  private priceEstimate(providerId: string, modelId: string, request: ChatTurnRequest): CostEstimate {
    return estimateCost(this.pricing.get(providerId, modelId), this.estInputTokens(request), this.maxOutputTokens);
  }

  async offer(input: OfferInput): Promise<OfferResult> {
    const reason = classifyLocalFailure(input.outcome);
    const snapshot = await this.fleet.snapshot();
    // Policy + provider eligibility (budget handled authoritatively below).
    const decision = evaluateEscalation({ policy: input.policy, reason, fleet: snapshot, requiredCaps: input.requiredCaps ?? { coding: true }, estInputTokens: 1, estOutputTokens: 1, budgetCapUsd: Number.MAX_SAFE_INTEGER });
    if (!decision.offered || !decision.reason || !decision.target) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: reason ?? 'none', fields: { policy: input.policy, denied: decision.deniedReason ?? 'not offered' } });
      return { offered: false, reason, deniedReason: decision.deniedReason ?? 'not offered' };
    }

    const estimate = this.priceEstimate(decision.target.providerId, decision.target.modelId, input.request);
    // Hard enforcement: no trustworthy price → no offer.
    if (this.budget.isEnabled() && (estimate.costUnavailable || !isTrustedForHardEnforcement(estimate.pricingStatus))) {
      auditStore.append({ correlationId: input.correlationId, type: 'budget.pricing_unknown', component: 'budget', fields: { provider: decision.target.providerId, model: decision.target.modelId } });
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: reason ?? 'none', fields: { denied: 'pricing not trustworthy under hard enforcement' } });
      return { offered: false, reason: decision.reason, deniedReason: 'pricing not trustworthy under hard enforcement' };
    }
    // Budget preflight (truthful; the atomic gate is reserve() at approval).
    const pf = this.budget.preflight({ correlationId: input.correlationId, providerId: decision.target.providerId, modelId: decision.target.modelId, tenant: input.tenant, estimate });
    if (!pf.affordable) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: reason ?? 'none', fields: { denied: pf.code ?? 'over budget' } });
      return { offered: false, reason: decision.reason, deniedReason: pf.code ?? 'over budget', estimate, worstCaseCostUsd: estimate.worstCaseCostUsd, remainingBudgetUsd: pf.remainingUsd };
    }

    const offer = this.store.mint({ requestHash: hashRequest(input.request), reason: decision.reason, target: decision.target, estCostUsd: estimate.estimatedCostUsd, costCeilingUsd: estimate.worstCaseCostUsd });
    auditStore.append({ correlationId: input.correlationId, type: 'escalation.offered', component: 'escalation', outcome: decision.reason, fields: { policy: input.policy, provider: decision.target.providerId, model: decision.target.modelId, estCostUsd: estimate.estimatedCostUsd, worstCaseUsd: estimate.worstCaseCostUsd } });
    return {
      offered: true,
      reason: decision.reason,
      target: decision.target,
      offerId: offer.offerId,
      token: offer.token,
      expiresAt: offer.expiresAt,
      estimate,
      worstCaseCostUsd: estimate.worstCaseCostUsd,
      remainingBudgetUsd: pf.remainingUsd,
      costCeilingUsd: estimate.worstCaseCostUsd,
      dataLeavesLocal: true,
    };
  }

  /** Record a LOCAL execution in the usage ledger with a clearly-ESTIMATED avoided
   * cloud cost. Never claims local is literally $0 — when no cloud price reference
   * exists, savings are reported `unknown`. */
  recordLocalUsage(input: { correlationId: string; providerId: string; modelId: string; mode: 'engineer' | 'chat'; policy: string; outcome: string; request: ChatTurnRequest }): { equivalentCloudCostUsd?: number; estimatedSavingsUsd?: number; localCostStatus: 'estimated' | 'unknown' } {
    const cloudRefs = this.pricing.list().filter((r) => r.outputCostPerMillion > 0);
    let equivalentCloudCostUsd: number | undefined;
    let localCostStatus: 'estimated' | 'unknown' = 'unknown';
    if (cloudRefs.length > 0) {
      const ref = cloudRefs.sort((a, b) => a.inputCostPerMillion + a.outputCostPerMillion - (b.inputCostPerMillion + b.outputCostPerMillion))[0]!;
      equivalentCloudCostUsd = estimateCost(ref, this.estInputTokens(input.request), this.maxOutputTokens).estimatedCostUsd;
      localCostStatus = 'estimated';
    }
    this.ledger.append({
      executionCorrelationId: input.correlationId,
      providerId: input.providerId,
      modelId: input.modelId,
      executionMode: input.mode,
      policy: input.policy,
      localOrCloud: 'local',
      outcome: input.outcome,
      costStatus: 'unknown', // local marginal cost is not asserted as $0
      equivalentCloudCostUsd,
      estimatedSavingsUsd: equivalentCloudCostUsd,
      localCostStatus,
    });
    return { equivalentCloudCostUsd, estimatedSavingsUsd: equivalentCloudCostUsd, localCostStatus };
  }

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
    if (provider.kind !== 'cloud' || !provider.enabled || (provider.credentialEnv && !this.providers.hasCredential(provider))) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: 'TARGET_INELIGIBLE', fields: { provider: provider.id } });
      return { gate: true, code: 'TARGET_INELIGIBLE', detail: 'target provider is no longer eligible' };
    }

    // Re-estimate and enforce the CONSENTED ceiling (guards a price change).
    const estimate = this.priceEstimate(offer.target.providerId, offer.target.modelId, input.request);
    if (estimate.worstCaseCostUsd > offer.costCeilingUsd) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: 'CEILING_EXCEEDED', fields: { worstCaseUsd: estimate.worstCaseCostUsd, ceilingUsd: offer.costCeilingUsd } });
      return { gate: true, code: 'CEILING_EXCEEDED', detail: 'estimated cost exceeds the consented ceiling' };
    }

    // ATOMIC budget gate — no reservation, no cloud.
    const rr = this.budget.reserve({ correlationId: input.correlationId, providerId: offer.target.providerId, modelId: offer.target.modelId, tenant: input.tenant, estimate });
    if (!rr.ok) {
      auditStore.append({ correlationId: input.correlationId, type: 'escalation.denied', component: 'escalation', outcome: rr.code, fields: { stage: 'reserve' } });
      return { gate: true, code: rr.code, detail: rr.detail };
    }

    auditStore.append({ correlationId: input.correlationId, type: 'escalation.approved', component: 'escalation', outcome: offer.reason, fields: { provider: provider.id, model: offer.target.modelId, reason: offer.reason, reservationId: rr.reservation.reservationId } });
    const result = await this.executor.attempt({ correlationId: input.correlationId, provider, modelId: offer.target.modelId, reason: offer.reason, request: input.request });

    // Reconcile: success → consume actual; failure → release (no charge).
    let costUsd: number | undefined;
    let costStatus: 'actual' | 'estimated' = 'estimated';
    if (result.ok) {
      const actualIn = result.usage?.inputTokens ?? estimate.estimatedInputTokens;
      const actualOut = result.usage?.outputTokens ?? estimate.maximumOutputTokens;
      costUsd = estimateCost(this.pricing.get(offer.target.providerId, offer.target.modelId), actualIn, actualOut, { expectedOutputTokens: actualOut }).estimatedCostUsd;
      costStatus = result.usage ? 'actual' : 'estimated';
      this.budget.consume(rr.reservation.reservationId, costUsd);
    } else {
      this.budget.release(rr.reservation.reservationId);
    }

    this.ledger.append({
      executionCorrelationId: input.correlationId,
      providerId: offer.target.providerId,
      modelId: offer.target.modelId,
      executionMode: 'escalation',
      policy: 'escalation',
      localOrCloud: 'cloud',
      outcome: result.ok ? 'ok' : 'failed',
      escalationReason: offer.reason,
      consentOrOfferId: offer.offerId,
      reservationId: rr.reservation.reservationId,
      inputTokens: result.usage?.inputTokens,
      outputTokens: result.usage?.outputTokens,
      costUsd: costUsd ?? 0,
      costStatus,
      calculatedCostUsd: costUsd,
    });
    return { ...result, costUsd, reservationId: rr.reservation.reservationId };
  }
}
