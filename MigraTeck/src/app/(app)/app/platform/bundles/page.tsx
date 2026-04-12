import { redirect } from "next/navigation";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function BundlesPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);
  if (!ctx || !can(ctx.role, "platform:config:manage")) redirect("/app");

  const bundles = await prisma.bundlePlan.findMany({
    orderBy: [{ sortOrder: "asc" }, { priceAmountCents: "asc" }],
  });

  return (
    <section className="space-y-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Ecosystem pricing</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight">Bundle Plans</h1>
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
          Manage multi-product bundle pricing for the MigraTeck ecosystem.
        </p>
      </article>

      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">All Bundles</h2>
          <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
            {bundles.length} bundles
          </span>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--line)]">
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Name</th>
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Products</th>
                <th className="pb-2 text-right font-semibold text-[var(--ink-muted)]">Price</th>
                <th className="pb-2 text-right font-semibold text-[var(--ink-muted)]">Savings</th>
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Public</th>
                <th className="pb-2 text-left font-semibold text-[var(--ink-muted)]">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.id} className="border-b border-[var(--line)]">
                  <td className="py-2">
                    <p className="font-semibold text-[var(--ink)]">{b.name}</p>
                    <p className="text-xs text-[var(--ink-muted)]">{b.slug}</p>
                  </td>
                  <td className="py-2">
                    <div className="flex flex-wrap gap-1">
                      {b.products.map((p) => (
                        <span key={p} className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-700">
                          {p.replace("MIGRA", "")}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-2 text-right font-semibold">${(b.priceAmountCents / 100).toFixed(2)}/{b.intervalMonths === 1 ? "mo" : `${b.intervalMonths}mo`}</td>
                  <td className="py-2 text-right text-green-600">{b.savingsPercent}%</td>
                  <td className="py-2">{b.isPublic ? "✓" : "—"}</td>
                  <td className="py-2 text-xs text-[var(--ink-muted)]">{b.stripePriceId ? "Linked" : "Not linked"}</td>
                </tr>
              ))}
              {bundles.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-4 text-center text-[var(--ink-muted)]">No bundles configured yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </article>
    </section>
  );
}
