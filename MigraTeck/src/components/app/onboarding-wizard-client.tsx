"use client";

import { useState } from "react";
import { ProductKey } from "@prisma/client";

type BusinessType = "freelancer" | "agency" | "smb" | "enterprise";

const BUSINESS_TYPES: { value: BusinessType; label: string; desc: string }[] = [
  { value: "freelancer", label: "Freelancer / Solopreneur", desc: "One-person business, starting lean" },
  { value: "agency", label: "Digital Agency", desc: "Managing multiple client projects" },
  { value: "smb", label: "Small / Medium Business", desc: "Growing team with multiple needs" },
  { value: "enterprise", label: "Enterprise / Multi-Location", desc: "Large organization, complex requirements" },
];

const PRODUCT_RECOMMENDATIONS: Record<BusinessType, { product: ProductKey; reason: string }[]> = {
  freelancer: [
    { product: "MIGRAHOSTING", reason: "Host your portfolio or client sites" },
    { product: "MIGRAMAIL", reason: "Professional email on your domain" },
    { product: "MIGRABUILDER", reason: "Build sites quickly with AI" },
  ],
  agency: [
    { product: "MIGRAHOSTING", reason: "Host all your client websites" },
    { product: "MIGRAMAIL", reason: "Email for every client domain" },
    { product: "MIGRADRIVE", reason: "File storage and backups" },
    { product: "MIGRAMARKET", reason: "Marketing tools for client campaigns" },
    { product: "MIGRABUILDER", reason: "Rapid site building for clients" },
  ],
  smb: [
    { product: "MIGRAHOSTING", reason: "Your business website" },
    { product: "MIGRAMAIL", reason: "Team email on your domain" },
    { product: "MIGRAVOICE", reason: "Business phone system" },
    { product: "MIGRAINTAKE", reason: "Lead capture and client forms" },
  ],
  enterprise: [
    { product: "MIGRAHOSTING", reason: "Multi-region web presence" },
    { product: "MIGRAMAIL", reason: "Organization-wide email" },
    { product: "MIGRADRIVE", reason: "Centralized file storage" },
    { product: "MIGRAVOICE", reason: "Multi-location phone system" },
    { product: "MIGRAMARKET", reason: "Marketing automation" },
    { product: "MIGRAINTAKE", reason: "Lead management pipeline" },
    { product: "MIGRAPILOT", reason: "AI operations monitoring" },
  ],
};

interface Props {
  activeProducts: ProductKey[];
  orgId: string;
}

export function OnboardingWizardClient({ activeProducts, orgId }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);

  const recommendations = businessType ? PRODUCT_RECOMMENDATIONS[businessType] : [];
  const newRecommendations = recommendations.filter(
    (r) => !activeProducts.includes(r.product)
  );

  return (
    <div className="space-y-4">
      {step === 1 && (
        <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
          <h2 className="text-xl font-bold">What describes your business?</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Select the option that best fits.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {BUSINESS_TYPES.map((bt) => (
              <button
                key={bt.value}
                className={`rounded-xl border p-4 text-left transition-all ${
                  businessType === bt.value
                    ? "border-[var(--brand)] bg-blue-50"
                    : "border-[var(--line)] bg-[var(--surface-2)] hover:border-[var(--brand)]"
                }`}
                onClick={() => setBusinessType(bt.value)}
              >
                <p className="text-sm font-semibold text-[var(--ink)]">{bt.label}</p>
                <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{bt.desc}</p>
              </button>
            ))}
          </div>
          {businessType && (
            <button
              className="mt-4 rounded-lg bg-[var(--brand)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              onClick={() => setStep(2)}
            >
              See Recommendations →
            </button>
          )}
        </article>
      )}

      {step === 2 && (
        <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
          <h2 className="text-xl font-bold">Recommended for You</h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Based on your business type, we recommend these products.
          </p>

          {activeProducts.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-green-600">Already active</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {recommendations
                  .filter((r) => activeProducts.includes(r.product))
                  .map((r) => (
                    <span key={r.product} className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                      ✓ {r.product.replace("MIGRA", "Migra")}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {newRecommendations.length > 0 && (
            <div className="mt-4 space-y-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Recommended to add</p>
              {newRecommendations.map((r) => (
                <div key={r.product} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[var(--ink)]">{r.product.replace("MIGRA", "Migra")}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{r.reason}</p>
                  </div>
                  <a
                    href={`/app/billing?product=${r.product}`}
                    className="rounded-lg bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                  >
                    Set Up
                  </a>
                </div>
              ))}
            </div>
          )}

          {newRecommendations.length === 0 && (
            <p className="mt-4 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-700">
              You already have all recommended products active! 🎉
            </p>
          )}

          <button
            className="mt-4 text-sm font-semibold text-[var(--ink-muted)] hover:underline"
            onClick={() => setStep(1)}
          >
            ← Change business type
          </button>
        </article>
      )}
    </div>
  );
}
