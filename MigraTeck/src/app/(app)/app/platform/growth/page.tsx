import { redirect } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { getJourneyDistribution, getAtRiskOrgs, getAdoptionFunnel } from "@/lib/customer-journey";
import { prisma } from "@/lib/prisma";

const stageColors: Record<string, string> = {
  ONBOARDING: "bg-gray-100 text-gray-700",
  ACTIVATED: "bg-blue-100 text-blue-700",
  ENGAGED: "bg-green-100 text-green-700",
  POWER_USER: "bg-purple-100 text-purple-700",
  AT_RISK: "bg-amber-100 text-amber-700",
  CHURNED: "bg-red-100 text-red-700",
};

export default async function GrowthPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) redirect("/app");

  const [distribution, atRiskOrgs, funnel, partnerCount, referralCount] = await Promise.all([
    getJourneyDistribution(),
    getAtRiskOrgs(10),
    getAdoptionFunnel(),
    prisma.partnerBinding.count({ where: { status: "ACTIVE" } }),
    prisma.referralConversion.count(),
  ]);

  return (
    <section className="space-y-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Platform intelligence</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Growth &amp; Ecosystem Analytics</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
          Customer lifecycle, adoption funnel, and partner performance across the MigraTeck platform.
        </p>
      </article>

      {/* Adoption Funnel */}
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-xl font-bold">Adoption Funnel</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Total orgs</p>
            <p className="mt-1 text-xl font-bold">{funnel.totalOrgs}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">With 1+ product</p>
            <p className="mt-1 text-xl font-bold">{funnel.withProduct}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Multi-product</p>
            <p className="mt-1 text-xl font-bold">{funnel.withMultiProduct}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Paying</p>
            <p className="mt-1 text-xl font-bold">{funnel.withSubscription}</p>
          </div>
        </div>
      </article>

      {/* Journey Stage Distribution */}
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-xl font-bold">Journey Stage Distribution</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Stage</th>
                <th className="pb-2 text-right font-semibold text-[var(--ink-muted)]">Count</th>
                <th className="pb-2 text-right font-semibold text-[var(--ink-muted)]">Avg Score</th>
                <th className="pb-2 text-right font-semibold text-[var(--ink-muted)]">Avg Churn Risk</th>
              </tr>
            </thead>
            <tbody>
              {distribution.map((row) => (
                <tr key={row.stage} className="border-b border-[var(--line)]">
                  <td className="py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${stageColors[row.stage] ?? "bg-gray-100 text-gray-700"}`}>
                      {row.stage}
                    </span>
                  </td>
                  <td className="py-2 text-right font-semibold">{row.count}</td>
                  <td className="py-2 text-right">{row.avgScore}</td>
                  <td className="py-2 text-right">{row.avgChurnRisk}%</td>
                </tr>
              ))}
              {distribution.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-[var(--ink-muted)]">No journey data yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* At-Risk Orgs */}
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-xl font-bold">At-Risk Organizations</h2>
          <div className="mt-4 space-y-2">
            {atRiskOrgs.map((j) => (
              <div key={j.id} className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">{j.org.name}</p>
                  <p className="text-xs text-[var(--ink-muted)]">{j.org.slug}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-red-600">{j.churnRiskScore}% risk</p>
                  <p className="text-xs text-[var(--ink-muted)]">{j.productsActive} products</p>
                </div>
              </div>
            ))}
            {atRiskOrgs.length === 0 && (
              <p className="text-sm text-[var(--ink-muted)]">No at-risk organizations.</p>
            )}
          </div>
        </article>

        {/* Partner & Referral Summary */}
        <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
          <h2 className="text-xl font-bold">Partner Program</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Active partners</p>
              <p className="mt-1 text-xl font-bold">{partnerCount}</p>
            </div>
            <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Referral conversions</p>
              <p className="mt-1 text-xl font-bold">{referralCount}</p>
            </div>
          </div>
          <div className="mt-4">
            <a href="/app/platform/partners" className="text-sm font-semibold text-[var(--brand)] hover:underline">
              View Partner Details →
            </a>
          </div>
        </article>
      </div>
    </section>
  );
}
