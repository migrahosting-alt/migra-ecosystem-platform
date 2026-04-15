import { ProductKey, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripe } from "@/lib/billing/stripe-client";

// ── Plan catalog queries ──

export async function getPublicPlans(product?: ProductKey) {
  return prisma.billingPlan.findMany({
    where: {
      isPublic: true,
      ...(product ? { product } : {}),
    },
    orderBy: [{ product: "asc" }, { sortOrder: "asc" }],
  });
}

export async function getPlanBySlug(slug: string) {
  return prisma.billingPlan.findUnique({ where: { slug } });
}

export async function getPlanByStripePriceId(priceId: string) {
  return prisma.billingPlan.findUnique({ where: { stripePriceId: priceId } });
}

// ── Checkout session ──

interface CreateCheckoutInput {
  orgId: string;
  planSlug: string;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export async function createCheckoutSession(input: CreateCheckoutInput) {
  const plan = await prisma.billingPlan.findUnique({
    where: { slug: input.planSlug },
  });

  if (!plan || !plan.stripePriceId) {
    throw new Error("Plan not found or not linked to Stripe.");
  }

  // Find or create billing customer
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
        ...(input.customerEmail ? { email: input.customerEmail } : {}),
      },
    });
  }

  const session = await stripe.checkout.sessions.create({
    customer: billingCustomer.stripeCustomerId,
    mode: "subscription",
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    ...(plan.trialDays > 0
      ? { subscription_data: { trial_period_days: plan.trialDays } }
      : {}),
    metadata: {
      orgId: input.orgId,
      planSlug: plan.slug,
      product: plan.product,
    },
  });

  return { sessionId: session.id, url: session.url };
}

// ── Customer portal ──

export async function createBillingPortalSession(orgId: string, returnUrl: string) {
  const billingCustomer = await prisma.billingCustomer.findFirst({
    where: { orgId, provider: "STRIPE" },
  });

  if (!billingCustomer) {
    throw new Error("No billing customer found for this organization.");
  }

  const stripe = getStripe();
  const portalSession = await stripe.billingPortal.sessions.create({
    customer: billingCustomer.stripeCustomerId,
    return_url: returnUrl,
  });

  return { url: portalSession.url };
}

// ── Plan management (admin) ──

interface UpsertPlanInput {
  product: ProductKey;
  name: string;
  slug: string;
  stripePriceId?: string | null;
  intervalMonths?: number;
  priceAmountCents: number;
  currency?: string;
  features?: Record<string, unknown>;
  trialDays?: number;
  isPublic?: boolean;
  sortOrder?: number;
}

export async function upsertPlan(input: UpsertPlanInput) {
  return prisma.billingPlan.upsert({
    where: { slug: input.slug },
    update: {
      product: input.product,
      name: input.name,
      ...(input.stripePriceId !== undefined
        ? { stripePriceId: input.stripePriceId }
        : {}),
      ...(input.intervalMonths != null ? { intervalMonths: input.intervalMonths } : {}),
      priceAmountCents: input.priceAmountCents,
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.features
        ? { features: input.features as unknown as Prisma.InputJsonValue }
        : {}),
      ...(input.trialDays != null ? { trialDays: input.trialDays } : {}),
      ...(input.isPublic != null ? { isPublic: input.isPublic } : {}),
      ...(input.sortOrder != null ? { sortOrder: input.sortOrder } : {}),
    },
    create: {
      product: input.product,
      name: input.name,
      slug: input.slug,
      ...(input.stripePriceId ? { stripePriceId: input.stripePriceId } : {}),
      intervalMonths: input.intervalMonths ?? 1,
      priceAmountCents: input.priceAmountCents,
      currency: input.currency ?? "usd",
      ...(input.features
        ? { features: input.features as unknown as Prisma.InputJsonValue }
        : {}),
      trialDays: input.trialDays ?? 0,
      isPublic: input.isPublic ?? true,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}
