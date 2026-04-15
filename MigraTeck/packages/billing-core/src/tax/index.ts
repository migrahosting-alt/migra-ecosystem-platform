import type { BillingContext } from "../context.js";

/**
 * Tax is primarily handled by Stripe Tax (automatic_tax: { enabled: true }).
 * This module provides helpers for platform-side tax state management.
 */

export interface TaxInfo {
  taxCountry: string | null;
  taxState: string | null;
  taxId: string | null;
}

/**
 * Update the tax info on a billing account and sync to Stripe.
 */
export async function updateTaxInfo(
  ctx: BillingContext,
  orgId: string,
  input: TaxInfo,
): Promise<void> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });
  if (!account) {
    throw new Error(`No billing account for org ${orgId}`);
  }

  // Update local record
  await ctx.db.billingAccount.update({
    where: { orgId },
    data: {
      taxCountry: input.taxCountry,
      taxState: input.taxState,
      taxId: input.taxId,
    },
  });

  // Sync address to Stripe customer for tax calculation
  if (account.stripeCustomerId && (input.taxCountry || input.taxState)) {
    await ctx.stripe.customers.update(account.stripeCustomerId, {
      address: {
        ...(input.taxCountry ? { country: input.taxCountry } : {}),
        ...(input.taxState ? { state: input.taxState } : {}),
      },
    });
  }

  // Sync tax ID to Stripe
  if (account.stripeCustomerId && input.taxId && input.taxCountry) {
    try {
      // Remove existing tax IDs first
      const existingIds = await ctx.stripe.customers.listTaxIds(account.stripeCustomerId);
      for (const id of existingIds.data) {
        await ctx.stripe.customers.deleteTaxId(account.stripeCustomerId, id.id);
      }

      // Add new tax ID
      await ctx.stripe.customers.createTaxId(account.stripeCustomerId, {
        type: inferTaxIdType(input.taxCountry),
        value: input.taxId,
      });
    } catch {
      // Non-fatal — tax ID format might be invalid
    }
  }
}

/**
 * Get tax info for an org.
 */
export async function getTaxInfo(
  ctx: BillingContext,
  orgId: string,
): Promise<TaxInfo> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });
  return {
    taxCountry: account?.taxCountry ?? null,
    taxState: account?.taxState ?? null,
    taxId: account?.taxId ?? null,
  };
}

function inferTaxIdType(country: string): any {
  const map: Record<string, string> = {
    US: "us_ein",
    CA: "ca_bn",
    GB: "gb_vat",
    AU: "au_abn",
    NZ: "nz_gst",
  };
  // Default to EU VAT for European countries
  const euCountries = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"]);
  if (euCountries.has(country)) return "eu_vat";
  return map[country] ?? "eu_vat";
}
