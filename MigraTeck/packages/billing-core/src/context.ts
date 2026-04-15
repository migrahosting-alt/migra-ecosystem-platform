import Stripe from "stripe";

export interface BillingContext {
  stripe: Stripe;
  db: BillingDb;
}

/**
 * Prisma-like DB interface that consumers inject.
 * Each app passes its own Prisma client instance.
 */
export interface BillingDb {
  billingAccount: PrismaDelegate;
  billingSubscription: PrismaDelegate;
  billingSubscriptionItem: PrismaDelegate;
  billingInvoice: PrismaDelegate;
  billingPaymentMethod: PrismaDelegate;
  billingUsageEvent: PrismaDelegate;
  billingEntitlementSnapshot: PrismaDelegate;
  billingQuote: PrismaDelegate;
  billingWebhookEvent: PrismaDelegate;
  billingAdjustment: PrismaDelegate;
  $transaction: <T>(fn: (tx: BillingDb) => Promise<T>) => Promise<T>;
}

/** Minimal Prisma delegate shape — consumers provide the real Prisma client. */
export interface PrismaDelegate {
  findUnique: (args: any) => Promise<any>;
  findFirst: (args: any) => Promise<any>;
  findMany: (args: any) => Promise<any>;
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  upsert: (args: any) => Promise<any>;
  delete: (args: any) => Promise<any>;
  count: (args: any) => Promise<number>;
}

export function createBillingContext(opts: {
  stripeSecretKey: string;
  stripeApiVersion?: string;
  db: BillingDb;
}): BillingContext {
  const stripe = new Stripe(opts.stripeSecretKey, {
    apiVersion: "2025-04-30.basil" as Stripe.LatestApiVersion,
    typescript: true,
  });
  return { stripe, db: opts.db };
}
