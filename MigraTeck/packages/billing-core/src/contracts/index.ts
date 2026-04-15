/**
 * Contracts module — manages enterprise contract terms and SLA bindings.
 * Used for enterprise deals that go beyond standard self-serve pricing.
 */

export interface ContractTerms {
  orgId: string;
  annualCommitment?: number;
  discountPercent?: number;
  customPricing?: Record<string, number>;
  slaLevel?: "standard" | "premium" | "enterprise";
  paymentTerms?: "net_15" | "net_30" | "net_60" | "net_90";
  autoRenew?: boolean;
  startDate: Date;
  endDate: Date;
  notes?: string;
}

/**
 * Contracts are stored as part of the quote/subscription metadata.
 * This module provides type-safe helpers for contract management.
 * Full implementation will be built in the enterprise sales slice.
 */

export function validateContractTerms(terms: ContractTerms): string[] {
  const errors: string[] = [];

  if (terms.endDate <= terms.startDate) {
    errors.push("Contract end date must be after start date");
  }

  if (terms.discountPercent !== undefined && (terms.discountPercent < 0 || terms.discountPercent > 100)) {
    errors.push("Discount percent must be between 0 and 100");
  }

  if (terms.annualCommitment !== undefined && terms.annualCommitment < 0) {
    errors.push("Annual commitment must be non-negative");
  }

  return errors;
}

export function calculateContractDiscount(
  baseAmount: number,
  terms: ContractTerms,
): number {
  if (!terms.discountPercent) return baseAmount;
  return Math.round(baseAmount * (1 - terms.discountPercent / 100));
}
