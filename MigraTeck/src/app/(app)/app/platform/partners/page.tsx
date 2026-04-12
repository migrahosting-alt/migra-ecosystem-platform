import { redirect } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { listPartners } from "@/lib/partners";
import { prisma } from "@/lib/prisma";

const tierColors: Record<string, string> = {
  REFERRAL: "bg-gray-100 text-gray-700",
  AFFILIATE: "bg-blue-100 text-blue-700",
  RESELLER: "bg-purple-100 text-purple-700",
  AGENCY: "bg-green-100 text-green-700",
};

const statusColors: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-700",
  ACTIVE: "bg-green-100 text-green-700",
  SUSPENDED: "bg-red-100 text-red-700",
  REVOKED: "bg-gray-100 text-gray-700",
};

export default async function PartnersPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) redirect("/app");

  const partners = await listPartners();
  const conversionStats = await prisma.referralConversion.aggregate({
    _sum: { revenueAmountCents: true, commissionAmountCents: true },
    _count: true,
  });

  return (
    <section className="space-y-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Partner management</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Partner Program</h1>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Total partners</p>
            <p className="mt-1 text-xl font-bold">{partners.length}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Total conversions</p>
            <p className="mt-1 text-xl font-bold">{conversionStats._count}</p>
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Revenue attributed</p>
            <p className="mt-1 text-xl font-bold">
              ${((conversionStats._sum.revenueAmountCents ?? 0) / 100).toFixed(2)}
            </p>
          </div>
        </div>
      </article>

      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-xl font-bold">All Partners</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Organization</th>
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Tier</th>
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Status</th>
                <th className="pb-2 text-right font-semibold text-[var(--ink-muted)]">Commission</th>
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Contact</th>
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Applied</th>
              </tr>
            </thead>
            <tbody>
              {partners.map((p) => (
                <tr key={p.id} className="border-b border-[var(--line)]">
                  <td className="py-2 font-semibold text-[var(--ink)]">{p.org.name}</td>
                  <td className="py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${tierColors[p.tier] ?? ""}`}>
                      {p.tier}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusColors[p.status] ?? ""}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="py-2 text-right">{p.commissionPct}%</td>
                  <td className="py-2 text-[var(--ink-muted)]">{p.contactEmail ?? "—"}</td>
                  <td className="py-2 text-[var(--ink-muted)]">{p.createdAt.toLocaleDateString()}</td>
                </tr>
              ))}
              {partners.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-[var(--ink-muted)]">No partners yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
