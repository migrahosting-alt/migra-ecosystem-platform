import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canManageBilling, can } from "@/lib/rbac";
import { stripeBillingEnabled } from "@/lib/env";
import { PRODUCT_CATALOG } from "@/lib/constants";
import { buildMigraHostingRequestAccessHref, MIGRAHOSTING_PRICING_POSITIONING, MIGRAHOSTING_VPS_PLANS } from "@/lib/migrahosting-pricing";
import { ManageSubscriptionButton, SubscribeButton } from "@/components/billing/billing-actions";
import Link from "next/link";

function statusBadge(status: string) {
  const colors: Record<string, string> = {
    ACTIVE: "bg-green-100 text-green-700",
    TRIALING: "bg-blue-100 text-blue-700",
    PAST_DUE: "bg-yellow-100 text-yellow-700",
    CANCELED: "bg-red-100 text-red-700",
    INCOMPLETE: "bg-gray-100 text-gray-500",
    UNPAID: "bg-red-100 text-red-700",
    PAUSED: "bg-gray-100 text-gray-500",
  };

  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${colors[status] || "bg-gray-100 text-gray-500"}`}>
      {status}
    </span>
  );
}

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatTierPrice(tier: { monthlyPrice: number; contactSales?: boolean }): string {
  if (tier.contactSales) return "Custom";
  if (tier.monthlyPrice === 0) return "Free";
   const dollars = tier.monthlyPrice / 100;
   return priceFormatter.format(dollars).replace(/\.5(?!\d)/, ".50");
}

function tierActionLabel(tier: { monthlyPrice: number; contactSales?: boolean }): string {
  if (tier.contactSales) return "Contact Sales";
  if (tier.monthlyPrice === 0) return "Get Started";
  return "Subscribe";
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    return <p>No organization context available.</p>;
  }

  if (!canManageBilling(membership.role)) {
    await writeAuditLog({
      actorId: session.user.id,
      actorRole: membership.role,
      orgId: membership.orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      resourceType: "permission",
      resourceId: "billing:manage",
      riskTier: 1,
      metadata: {
        route: "/app/billing",
      },
    });

    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Your role does not permit billing controls.
      </p>
    );
  }

  const [subscriptions, bindings, entitlements] = await Promise.all([
    prisma.billingSubscription.findMany({
      where: { orgId: membership.orgId },
      orderBy: { createdAt: "desc" },
    }),
    can(membership.role, "platform:config:manage")
      ? prisma.billingEntitlementBinding.findMany({ orderBy: { createdAt: "desc" } })
      : Promise.resolve([]),
    prisma.orgEntitlement.findMany({
      where: { orgId: membership.orgId },
    }),
  ]);

  const hasActiveSubscription = subscriptions.some(
    (s) => s.status === "ACTIVE" || s.status === "TRIALING",
  );

  // Resolve subscribe-from-pricing flow
  const requestedPriceId = typeof params.priceId === "string" ? params.priceId : undefined;
  let subscribeTarget: { product: (typeof PRODUCT_CATALOG)[number]; tier: (typeof PRODUCT_CATALOG)[number]["pricing"] extends (infer T)[] | undefined ? T : never; priceId: string } | undefined;
  if (requestedPriceId && stripeBillingEnabled) {
    for (const p of PRODUCT_CATALOG) {
      const tier = p.pricing?.find((t) => t.stripePriceId === requestedPriceId);
      if (tier?.stripePriceId) {
        subscribeTarget = { product: p, tier, priceId: tier.stripePriceId };
        break;
      }
    }
  }

  const entitledProducts = new Set(entitlements.map((e) => e.product));
  const purchasableProducts = PRODUCT_CATALOG.filter(
    (p) => p.purchasable && p.pricing?.length && !entitledProducts.has(p.key),
  );

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Billing</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Manage subscriptions, view invoices, and add products to your organization.
          </p>
        </div>
        {hasActiveSubscription && <ManageSubscriptionButton />}
      </div>

      {/* Subscribe from Pricing Page */}
      {subscribeTarget && (
        <article className="rounded-2xl border-2 border-[var(--brand-600)] bg-[var(--brand-50)] p-6">
          <h2 className="text-lg font-bold">Confirm Subscription</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            You selected the <strong>{subscribeTarget.tier.name}</strong> plan for{" "}
            <strong>{subscribeTarget.product.name}</strong>.
            {subscribeTarget.tier.monthlyPrice > 0 && !subscribeTarget.tier.contactSales
              ? ` ${formatTierPrice(subscribeTarget.tier)}/mo with a 14-day free trial.`
              : ""}
          </p>
          <div className="mt-4">
            <SubscribeButton
              priceId={subscribeTarget.priceId}
              label={subscribeTarget.tier.monthlyPrice === 0 ? "Get Started Free" : "Start 14-Day Free Trial"}
              highlighted
            />
          </div>
        </article>
      )}

      {/* Checkout Result */}
      {params.checkout === "success" && (
        <article className="rounded-2xl border border-green-200 bg-green-50 p-5">
          <h2 className="text-lg font-bold text-green-800">Subscription Created!</h2>
          <p className="mt-1 text-sm text-green-700">
            Your subscription is being activated. It may take a few moments for entitlements to appear.
          </p>
        </article>
      )}
      {params.checkout === "cancelled" && (
        <article className="rounded-2xl border border-yellow-200 bg-yellow-50 p-5">
          <p className="text-sm text-yellow-800">
            Checkout was cancelled. You can try again from the pricing page or below.
          </p>
        </article>
      )}

      {/* Active Subscriptions */}
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-lg font-bold">Active Subscriptions</h2>
        {!subscriptions.length ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">No subscriptions yet. Subscribe to a product below to get started.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {subscriptions.map((row) => {
              return (
                <div key={row.id} className="rounded-xl border border-[var(--line)] p-4">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-sm">{row.externalSubscriptionId}</p>
                    {statusBadge(row.status)}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--ink-muted)]">
                    <span>Period: {row.currentPeriodStart?.toLocaleDateString() || "-"} — {row.currentPeriodEnd?.toLocaleDateString() || "-"}</span>
                    {row.cancelAtPeriodEnd && <span className="text-red-600 font-semibold">Cancels at period end</span>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </article>

      {/* Entitlements */}
      {entitlements.length > 0 && (
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Product Entitlements</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {entitlements.map((ent) => {
              const product = PRODUCT_CATALOG.find((p) => p.key === ent.product);
              return (
                <div key={ent.id} className="rounded-xl border border-[var(--line)] p-3">
                  <p className="font-semibold text-sm">{product?.name || ent.product}</p>
                  <div className="mt-1">{statusBadge(ent.status)}</div>
                </div>
              );
            })}
          </div>
        </article>
      )}

      <article className="rounded-2xl border border-[var(--line)] bg-[linear-gradient(180deg,#08101f_0%,#0f1a33_100%)] p-5 text-white">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{MIGRAHOSTING_PRICING_POSITIONING.eyebrow}</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight">MigraHosting VPS Plans</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-300">{MIGRAHOSTING_PRICING_POSITIONING.description}</p>
          </div>
          <Link
            href={buildMigraHostingRequestAccessHref()}
            className="inline-flex items-center justify-center rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-400"
          >
            Request Infrastructure Review
          </Link>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {MIGRAHOSTING_VPS_PLANS.map((plan) => (
            <div
              key={plan.slug}
              className={`rounded-2xl border p-4 ${plan.highlighted ? "border-emerald-400 bg-white/10" : "border-slate-700 bg-white/5"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-bold">{plan.name}</p>
                  <p className="mt-1 text-3xl font-black">{formatTierPrice({ monthlyPrice: plan.monthlyPriceCents })}<span className="ml-1 text-sm font-medium text-slate-300">/mo</span></p>
                </div>
                {plan.badge ? (
                  <span className="rounded-full bg-emerald-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
                    {plan.badge}
                  </span>
                ) : null}
              </div>
              <div className="mt-3 space-y-1 text-sm text-slate-300">
                <p>{plan.vcpu} vCPU cores</p>
                <p>{plan.memoryGb} GB RAM</p>
                <p>{plan.storageGb} GB NVMe SSD</p>
                <p>Billed yearly at {formatTierPrice({ monthlyPrice: plan.annualPriceCents })} when annualized.</p>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-slate-200">
                {plan.highlights.map((feature) => (
                  <li key={feature}>&#10003; {feature}</li>
                ))}
              </ul>
              <Link
                href={buildMigraHostingRequestAccessHref(plan.slug, "monthly")}
                className="mt-4 inline-flex items-center justify-center rounded-xl border border-emerald-400/50 px-3 py-2 text-sm font-semibold text-emerald-200 transition hover:border-emerald-300 hover:text-white"
              >
                Request {plan.name}
              </Link>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-slate-400">{MIGRAHOSTING_PRICING_POSITIONING.footnote}</p>
      </article>

      {/* Available Products to Subscribe */}
      {stripeBillingEnabled && purchasableProducts.length > 0 && (
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Add Products</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Subscribe to additional products for your organization.</p>
          <div className="mt-4 space-y-6">
            {purchasableProducts.map((product) => (
              <div key={product.key}>
                <h3 className="font-semibold">{product.name}</h3>
                <p className="text-xs text-[var(--ink-muted)]">{product.description}</p>
                <div className={`mt-3 grid gap-3 ${product.pricing!.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : "sm:grid-cols-3"}`}>
                  {product.pricing!.map((tier) => (
                    <div
                      key={`${product.key}-${tier.name}`}
                      className={`flex flex-col rounded-xl border p-4 ${
                        tier.highlighted ? "border-[var(--brand-600)]" : "border-[var(--line)]"
                      }`}
                    >
                      <p className="font-semibold text-sm">{tier.name}</p>
                      <p className="mt-1 text-2xl font-black">
                        {formatTierPrice(tier)}
                        {!tier.contactSales && tier.monthlyPrice > 0 && <span className="text-sm font-normal text-[var(--ink-muted)]">/mo</span>}
                      </p>
                      <ul className="mt-2 flex-1 space-y-1">
                        {tier.features.map((f) => (
                          <li key={f} className="text-xs text-[var(--ink-muted)]">&#10003; {f}</li>
                        ))}
                      </ul>
                      {tier.contactSales ? (
                        <div className="mt-3">
                          <Link
                            href="/contact"
                            className={`block rounded-xl px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                              tier.highlighted
                                ? "bg-[var(--brand-600)] text-white hover:bg-[var(--brand-700)]"
                                : "border border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-2)]"
                            }`}
                          >
                            {tierActionLabel(tier)}
                          </Link>
                        </div>
                      ) : tier.stripePriceId ? (
                        <div className="mt-3">
                          <SubscribeButton
                            priceId={tier.stripePriceId}
                            label={tierActionLabel(tier)}
                            highlighted={tier.highlighted ?? false}
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </article>
      )}

      {/* Price bindings (platform admin only) */}
      {bindings.length > 0 && (
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-lg font-bold">Price Bindings</h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Platform admin — maps Stripe prices to product entitlements.</p>
          <div className="mt-3 space-y-3">
            {bindings.map((row) => (
              <div key={row.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
                <p className="font-mono text-xs">{row.externalPriceId}</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  Product: {row.product} · Active status: {row.statusOnActive}
                </p>
              </div>
            ))}
          </div>
        </article>
      )}
    </section>
  );
}
