import { ProductKey } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/billing/stripe-client";

// ─── Bundle Queries ─────────────────────────────────────────────────────

export async function getPublicBundles() {
  return prisma.bundlePlan.findMany({
    where: { isPublic: true },
    orderBy: [{ sortOrder: "asc" }, { priceAmountCents: "asc" }],
  });
}

export async function getBundleBySlug(slug: string) {
  return prisma.bundlePlan.findUnique({ where: { slug } });
}

// ─── Bundle CRUD (Admin) ────────────────────────────────────────────────

interface CreateBundleInput {
  name: string;
  slug: string;
  products: ProductKey[];
  priceAmountCents: number;
  savingsPercent?: number | undefined;
  stripePriceId?: string | undefined;
  intervalMonths?: number | undefined;
  features?: Record<string, unknown> | undefined;
  trialDays?: number | undefined;
  isPublic?: boolean | undefined;
  sortOrder?: number | undefined;
}

export async function createBundlePlan(input: CreateBundleInput) {
  const data: Record<string, unknown> = {
    name: input.name,
    slug: input.slug,
    products: input.products,
    priceAmountCents: input.priceAmountCents,
  };
  if (input.savingsPercent !== undefined) data.savingsPercent = input.savingsPercent;
  if (input.stripePriceId !== undefined) data.stripePriceId = input.stripePriceId;
  if (input.intervalMonths !== undefined) data.intervalMonths = input.intervalMonths;
  if (input.features !== undefined) data.features = input.features;
  if (input.trialDays !== undefined) data.trialDays = input.trialDays;
  if (input.isPublic !== undefined) data.isPublic = input.isPublic;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;

  return prisma.bundlePlan.create({
    data: data as Parameters<typeof prisma.bundlePlan.create>[0]["data"],
  });
}

export async function updateBundlePlan(
  bundleId: string,
  updates: Partial<Omit<CreateBundleInput, "slug">>
) {
  const data: Record<string, unknown> = {};
  if (updates.name !== undefined) data.name = updates.name;
  if (updates.products !== undefined) data.products = updates.products;
  if (updates.priceAmountCents !== undefined) data.priceAmountCents = updates.priceAmountCents;
  if (updates.savingsPercent !== undefined) data.savingsPercent = updates.savingsPercent;
  if (updates.stripePriceId !== undefined) data.stripePriceId = updates.stripePriceId;
  if (updates.intervalMonths !== undefined) data.intervalMonths = updates.intervalMonths;
  if (updates.features !== undefined) data.features = updates.features;
  if (updates.trialDays !== undefined) data.trialDays = updates.trialDays;
  if (updates.isPublic !== undefined) data.isPublic = updates.isPublic;
  if (updates.sortOrder !== undefined) data.sortOrder = updates.sortOrder;

  return prisma.bundlePlan.update({
    where: { id: bundleId },
    data: data as Parameters<typeof prisma.bundlePlan.update>[0]["data"],
  });
}

export async function deleteBundlePlan(bundleId: string) {
  return prisma.bundlePlan.delete({ where: { id: bundleId } });
}

// ─── Bundle Checkout ────────────────────────────────────────────────────

interface BundleCheckoutInput {
  orgId: string;
  bundleSlug: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string | undefined;
}

export async function createBundleCheckout(input: BundleCheckoutInput) {
  const bundle = await prisma.bundlePlan.findUnique({
    where: { slug: input.bundleSlug },
  });
  if (!bundle || !bundle.stripePriceId) {
    throw new Error("Bundle not found or not linked to Stripe.");
  }

  let billingCustomer = await prisma.billingCustomer.findFirst({
    where: { orgId: input.orgId, provider: "STRIPE" },
  });

  const stripe = getStripe();

  if (!billingCustomer) {
    const customer = await stripe.customers.create({
      ...(input.customerEmail ? { email: input.customerEmail } : {}),
      metadata: { orgId: input.orgId },
    });

    billingCustomer = await prisma.billingCustomer.create({
      data: {
        orgId: input.orgId,
        provider: "STRIPE",
        stripeCustomerId: customer.id,
      },
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: billingCustomer.stripeCustomerId,
    line_items: [{ price: bundle.stripePriceId, quantity: 1 }],
    mode: "subscription",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: {
      orgId: input.orgId,
      bundleSlug: bundle.slug,
      bundleProducts: bundle.products.join(","),
    },
    ...(bundle.trialDays > 0
      ? { subscription_data: { trial_period_days: bundle.trialDays } }
      : {}),
  });

  return { sessionId: session.id, url: session.url };
}

// ─── Calculate Bundle Savings ───────────────────────────────────────────

export async function calculateBundleSavings(products: ProductKey[]) {
  const plans = await prisma.billingPlan.findMany({
    where: {
      product: { in: products },
      isPublic: true,
    },
    orderBy: { priceAmountCents: "asc" },
  });

  // Take the cheapest plan per product
  const seen = new Set<string>();
  let separateTotal = 0;
  for (const plan of plans) {
    if (!seen.has(plan.product)) {
      seen.add(plan.product);
      separateTotal += plan.priceAmountCents;
    }
  }

  const bundle = await prisma.bundlePlan.findFirst({
    where: {
      isPublic: true,
      products: { hasEvery: products },
    },
    orderBy: { priceAmountCents: "asc" },
  });

  if (!bundle) return null;

  return {
    separateTotalCents: separateTotal,
    bundlePriceCents: bundle.priceAmountCents,
    savingsCents: separateTotal - bundle.priceAmountCents,
    savingsPercent: separateTotal > 0
      ? Math.round(((separateTotal - bundle.priceAmountCents) / separateTotal) * 100)
      : 0,
    bundle,
  };
}
