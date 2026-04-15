"use client";

import Link from "next/link";
import { useState } from "react";
import { buildMigraHostingRequestAccessHref, MIGRAHOSTING_PRICING_POSITIONING, MIGRAHOSTING_VPS_PLANS } from "@/lib/migrahosting-pricing";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatPrice(cents: number) {
  return currencyFormatter.format(cents / 100);
}

type BillingCycle = "monthly" | "yearly";

export function MigraHostingVpsPricing() {
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly");

  return (
    <section className="mb-16 rounded-[2rem] border border-[var(--line)] bg-[linear-gradient(180deg,#ffffff_0%,#f4f8ff_100%)] p-6 shadow-sm md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-600)]">{MIGRAHOSTING_PRICING_POSITIONING.eyebrow}</p>
          <h2 className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">{MIGRAHOSTING_PRICING_POSITIONING.title}</h2>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">{MIGRAHOSTING_PRICING_POSITIONING.description}</p>
        </div>

        <div className="inline-flex rounded-2xl border border-[var(--line)] bg-white p-1 shadow-sm">
          {(["monthly", "yearly"] as BillingCycle[]).map((cycle) => (
            <button
              key={cycle}
              type="button"
              className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${billingCycle === cycle ? "bg-[var(--brand-600)] text-white" : "text-[var(--ink-muted)] hover:text-[var(--ink)]"}`}
              onClick={() => setBillingCycle(cycle)}
            >
              {cycle === "monthly" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {MIGRAHOSTING_VPS_PLANS.map((plan) => {
          const displayPrice = billingCycle === "monthly" ? plan.monthlyPriceCents : plan.annualEquivalentMonthlyCents;
          const billingLine =
            billingCycle === "monthly"
              ? "Billed monthly."
              : `Billed yearly. Pay ${formatPrice(plan.annualPriceCents)} today.`;
          const requestAccessHref = buildMigraHostingRequestAccessHref(plan.slug, billingCycle);

          return (
            <article
              key={plan.slug}
              className={`relative flex flex-col rounded-[1.6rem] border bg-[#08101f] p-6 text-white shadow-[0_18px_48px_rgba(8,16,31,0.18)] ${plan.highlighted ? "border-emerald-400 shadow-[0_24px_60px_rgba(16,185,129,0.18)]" : "border-slate-800"}`}
            >
              {plan.badge ? (
                <span className="absolute -top-3 left-6 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-white">
                  {plan.badge}
                </span>
              ) : null}

              <div>
                <p className="text-xl font-black tracking-tight">{plan.name.replace(" ", "")}</p>
                <div className="mt-3 flex items-end gap-1">
                  <span className="text-5xl font-black tracking-tight">{formatPrice(displayPrice)}</span>
                  <span className="pb-1 text-sm text-slate-300">/mo</span>
                </div>
                <div className="mt-3 space-y-1 text-sm text-slate-300">
                  <p>{plan.vcpu} vCPU cores</p>
                  <p>{plan.memoryGb} GB RAM</p>
                  <p>{plan.storageGb} GB NVMe SSD</p>
                  <p>{billingLine}</p>
                </div>
              </div>

              <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-100">
                {plan.highlights.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <span className="mt-0.5 text-emerald-400">&#10003;</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              <Link
                href={requestAccessHref}
                className={`mt-6 inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold transition ${plan.highlighted ? "bg-emerald-500 text-white hover:bg-emerald-400" : "bg-[linear-gradient(90deg,#cf47ff_0%,#ff9a3c_100%)] text-white hover:opacity-95"}`}
              >
                Request {plan.name} Review
              </Link>
            </article>
          );
        })}
      </div>

      <div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] bg-white/70 px-5 py-4 text-sm text-[var(--ink-muted)]">
        {MIGRAHOSTING_PRICING_POSITIONING.footnote}
      </div>
    </section>
  );
}