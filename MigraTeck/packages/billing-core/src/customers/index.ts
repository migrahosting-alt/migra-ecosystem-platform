import type Stripe from "stripe";
import type { BillingContext } from "../context.js";
import type { BillingAccount } from "../types.js";

export interface CreateCustomerInput {
  orgId: string;
  orgName: string;
  billingEmail: string;
  billingContactName?: string;
  taxCountry?: string;
  taxState?: string;
  taxId?: string;
  metadata?: Record<string, string>;
}

export interface UpdateCustomerInput {
  billingEmail?: string;
  billingContactName?: string;
  taxCountry?: string;
  taxState?: string;
  taxId?: string;
}

/**
 * Get or create a BillingAccount and synced Stripe Customer for an org.
 */
export async function getOrCreateBillingAccount(
  ctx: BillingContext,
  input: CreateCustomerInput,
): Promise<BillingAccount> {
  const existing = await ctx.db.billingAccount.findUnique({
    where: { orgId: input.orgId },
  });

  if (existing) return existing as BillingAccount;

  // Create Stripe Customer
  const customerParams: Stripe.CustomerCreateParams = {
    name: input.orgName,
    email: input.billingEmail,
    metadata: {
      org_id: input.orgId,
      platform: "migrateck",
      ...input.metadata,
    },
  };

  if (input.taxId) {
    // Tax ID is set via a separate API call after customer creation
  }

  const stripeCustomer = await ctx.stripe.customers.create(customerParams);

  // If a tax ID was provided, attach it
  if (input.taxId && input.taxCountry) {
    try {
      await ctx.stripe.customers.createTaxId(stripeCustomer.id, {
        type: "eu_vat" as Stripe.CustomerCreateTaxIdParams.Type,
        value: input.taxId,
      });
    } catch {
      // Non-fatal — tax ID might be invalid format
    }
  }

  const account = await ctx.db.billingAccount.create({
    data: {
      orgId: input.orgId,
      stripeCustomerId: stripeCustomer.id,
      billingEmail: input.billingEmail,
      billingContactName: input.billingContactName ?? null,
      taxCountry: input.taxCountry ?? null,
      taxState: input.taxState ?? null,
      taxId: input.taxId ?? null,
      defaultCurrency: "usd",
      status: "ACTIVE",
    },
  });

  return account as BillingAccount;
}

/**
 * Update billing account details and sync to Stripe Customer.
 */
export async function updateBillingAccount(
  ctx: BillingContext,
  orgId: string,
  input: UpdateCustomerInput,
): Promise<BillingAccount> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });

  if (!account) {
    throw new Error(`No billing account found for org ${orgId}`);
  }

  // Sync to Stripe
  if (account.stripeCustomerId) {
    const stripeUpdate: Stripe.CustomerUpdateParams = {};
    if (input.billingEmail !== undefined) stripeUpdate.email = input.billingEmail;
    if (input.billingContactName !== undefined) stripeUpdate.name = input.billingContactName;

    if (Object.keys(stripeUpdate).length > 0) {
      await ctx.stripe.customers.update(account.stripeCustomerId, stripeUpdate);
    }
  }

  const updated = await ctx.db.billingAccount.update({
    where: { orgId },
    data: {
      ...(input.billingEmail !== undefined && { billingEmail: input.billingEmail }),
      ...(input.billingContactName !== undefined && { billingContactName: input.billingContactName }),
      ...(input.taxCountry !== undefined && { taxCountry: input.taxCountry }),
      ...(input.taxState !== undefined && { taxState: input.taxState }),
      ...(input.taxId !== undefined && { taxId: input.taxId }),
    },
  });

  return updated as BillingAccount;
}

/**
 * Fetch billing account by org ID.
 */
export async function getBillingAccount(
  ctx: BillingContext,
  orgId: string,
): Promise<BillingAccount | null> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { orgId },
  });
  return account as BillingAccount | null;
}

/**
 * Fetch billing account by Stripe customer ID (used in webhook processing).
 */
export async function getBillingAccountByStripeCustomer(
  ctx: BillingContext,
  stripeCustomerId: string,
): Promise<BillingAccount | null> {
  const account = await ctx.db.billingAccount.findUnique({
    where: { stripeCustomerId },
  });
  return account as BillingAccount | null;
}
