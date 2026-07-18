// Intelligent Provider Router — Slice 4: provider/model pricing model.
//
// Bounded pricing METADATA only (never secrets). Pricing is CONFIGURED (owner-set,
// e.g. a provider's declared cost) or supplied via an operator config file with an
// explicit status. Pricing is NEVER scraped or discovered in the execution path.
// Cloud execution under hard budget enforcement requires `verified` or explicitly
// owner-approved `configured` pricing — `estimated`/`unknown` fail closed.
//
// © MigraTeck LLC.

export type PricingStatus = 'verified' | 'configured' | 'estimated' | 'unknown';

export interface PricingRecord {
  providerId: string;
  modelId: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  cachedInputCostPerMillion?: number;
  requestMinimumUsd?: number;
  effectiveFrom?: string;
  source: string;
  pricingStatus: PricingStatus;
}

/** Statuses that MAY execute under hard budget enforcement. */
export function isTrustedForHardEnforcement(status: PricingStatus): boolean {
  return status === 'verified' || status === 'configured';
}

export class PricingBook {
  private readonly byKey = new Map<string, PricingRecord>();

  constructor(records: PricingRecord[] = []) {
    for (const r of records) this.byKey.set(key(r.providerId, r.modelId), r);
  }

  /** Exact (provider, model) price, or a provider-wide fallback, or an `unknown`
   * record so callers always get a truthful status rather than a silent 0. */
  get(providerId: string, modelId: string): PricingRecord {
    return (
      this.byKey.get(key(providerId, modelId)) ??
      this.byKey.get(key(providerId, '*')) ?? {
        providerId,
        modelId,
        inputCostPerMillion: 0,
        outputCostPerMillion: 0,
        source: 'none',
        pricingStatus: 'unknown',
      }
    );
  }

  list(): PricingRecord[] {
    return [...this.byKey.values()];
  }

  has(providerId: string, modelId: string): boolean {
    return this.byKey.has(key(providerId, modelId)) || this.byKey.has(key(providerId, '*'));
  }
}

function key(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}
