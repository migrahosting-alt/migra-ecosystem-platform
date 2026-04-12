import Link from "next/link";
import { requireAuthSession, getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function AlertsPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);

  if (!ctx || !can(ctx.role, "ops:read")) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Alerts</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          You don&apos;t have permission to view alerts.
        </p>
      </section>
    );
  }

  const [alerts, rules, activeCount] = await Promise.all([
    prisma.alert.findMany({
      where: {
        OR: [{ orgId: ctx.orgId }, { orgId: null }],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { rule: { select: { name: true } } },
    }),
    prisma.alertRule.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { alerts: true } } },
    }),
    prisma.alert.count({
      where: {
        status: { in: ["ACTIVE", "ACKNOWLEDGED"] },
        OR: [{ orgId: ctx.orgId }, { orgId: null }],
      },
    }),
  ]);

  return (
    <section className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Alerts</h1>
          <p className="text-sm text-zinc-500">
            {activeCount} active alert{activeCount !== 1 ? "s" : ""}
          </p>
        </div>
        <Link href="/app/platform/ops" className="text-sm text-blue-600 hover:underline">
          ← Back to Ops
        </Link>
      </div>

      {/* Active Alerts */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold">Recent Alerts</h2>
        {alerts.length === 0 ? (
          <p className="text-sm text-zinc-400">No alerts.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Title</th>
                  <th className="px-4 py-2">Rule</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Source</th>
                  <th className="px-4 py-2">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {alerts.map((a) => (
                  <tr key={a.id} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          a.severity === "CRITICAL"
                            ? "bg-red-100 text-red-700"
                            : a.severity === "WARNING"
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {a.severity}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-medium">{a.title}</td>
                    <td className="px-4 py-2 text-zinc-500">{a.rule?.name ?? "—"}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                          a.status === "ACTIVE"
                            ? "bg-red-50 text-red-600"
                            : a.status === "ACKNOWLEDGED"
                            ? "bg-yellow-50 text-yellow-600"
                            : a.status === "RESOLVED"
                            ? "bg-green-50 text-green-600"
                            : "bg-zinc-100 text-zinc-500"
                        }`}
                      >
                        {a.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-500">{a.source}</td>
                    <td className="px-4 py-2 text-zinc-400">{a.createdAt.toISOString().slice(0, 16)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Alert Rules */}
      <div className="space-y-3">
        <h2 className="text-lg font-bold">Alert Rules</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-zinc-400">No alert rules configured.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="min-w-full text-sm">
              <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
                <tr>
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Event Type</th>
                  <th className="px-4 py-2">Severity</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Fired</th>
                  <th className="px-4 py-2">Cooldown</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rules.map((r) => (
                  <tr key={r.id} className="hover:bg-zinc-50/50">
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 font-mono text-xs text-zinc-500">{r.eventType}</td>
                    <td className="px-4 py-2">{r.severity}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`text-xs ${
                          r.status === "ENABLED" ? "text-green-600" : "text-zinc-400"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-zinc-400">{r._count.alerts}</td>
                    <td className="px-4 py-2 text-zinc-400">{r.cooldownMinutes}m</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
