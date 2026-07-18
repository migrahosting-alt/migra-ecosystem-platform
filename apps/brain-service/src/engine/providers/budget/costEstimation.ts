// Intelligent Provider Router — Slice 4: preflight cost estimation.
//
// Conservative by design: hard-limit enforcement uses the WORST-CASE cost
// (maximum bounded output), never an optimistic average. A record with `unknown`
// pricing yields a truthful unknown estimate rather than a silent $0.
//
// © MigraTeck LLC.

import type { PricingRecord, PricingStatus } from './pricing.js';

export interface CostEstimate {
  providerId: string;
  modelId: string;
  estimatedInputTokens: number;
  maximumOutputTokens: number;
  /** Expected-case cost (input + expected output). */
  estimatedCostUsd: number;
  /** Worst-case cost (input + MAX output, request minimum applied). Used for hard
   * enforcement. */
  worstCaseCostUsd: number;
  pricingStatus: PricingStatus;
  /** True when pricing is not trustworthy enough to price the call. */
  costUnavailable: boolean;
}

/** ~4 chars per token — a conservative bounded counter when no tokenizer is wired. */
export function estimateTokens(text: string): number {
  return Math.ceil((text ?? '').length / 4);
}

export function estimateCost(
  pricing: PricingRecord,
  estimatedInputTokens: number,
  maximumOutputTokens: number,
  opts: { expectedOutputTokens?: number } = {},
): CostEstimate {
  const expectedOutput = Math.min(opts.expectedOutputTokens ?? maximumOutputTokens, maximumOutputTokens);
  const priceOf = (inTok: number, outTok: number): number => {
    const raw = (inTok / 1_000_000) * pricing.inputCostPerMillion + (outTok / 1_000_000) * pricing.outputCostPerMillion;
    return Math.max(raw, pricing.requestMinimumUsd ?? 0);
  };
  const costUnavailable = pricing.pricingStatus === 'unknown';
  return {
    providerId: pricing.providerId,
    modelId: pricing.modelId,
    estimatedInputTokens,
    maximumOutputTokens,
    estimatedCostUsd: round(priceOf(estimatedInputTokens, expectedOutput)),
    worstCaseCostUsd: round(priceOf(estimatedInputTokens, maximumOutputTokens)),
    pricingStatus: pricing.pricingStatus,
    costUnavailable,
  };
}

function round(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
