import Link from "next/link";
import { requireAuthSession, getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function SchedulerPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);

  if (!ctx || !can(ctx.role, "platform:config:manage")) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Scheduled Tasks</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          You don&apos;t have permission to manage scheduled tasks.
        </p>
      </section>
    );
  }

  const tasks = await prisma.scheduledTask.findMany({
    orderBy: [{ status: "asc" }, { nextRunAt: "asc" }],
    take: 100,
  });

  const statusCounts = {
    active: tasks.filter((t) => t.status === "ACTIVE").length,
    paused: tasks.filter((t) => t.status === "PAUSED").length,
    failed: tasks.filter((t) => t.status === "FAILED").length,
    completed: tasks.filter((t) => t.status === "COMPLETED").length,
  };

  return (
    <section className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Scheduled Tasks</h1>
          <p className="text-sm text-zinc-500">
            {statusCounts.active} active · {statusCounts.paused} paused · {statusCounts.failed} failed
          </p>
        </div>
        <Link href="/app/platform/ops" className="text-sm text-blue-600 hover:underline">
          ← Back to Ops
        </Link>
      </div>

      {tasks.length === 0 ? (
        <p className="text-sm text-zinc-400">No scheduled tasks.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Handler</th>
                <th className="px-4 py-2">Schedule</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Next Run</th>
                <th className="px-4 py-2">Last Run</th>
                <th className="px-4 py-2">Retries</th>
                <th className="px-4 py-2">Error</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {tasks.map((t) => (
                <tr key={t.id} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-2 font-medium">{t.name}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">{t.handler}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-500">
                    {t.cronExpression ?? (t.runAt ? `at ${t.runAt.toISOString().slice(0, 16)}` : "—")}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs ${
                        t.status === "ACTIVE"
                          ? "bg-green-50 text-green-600"
                          : t.status === "PAUSED"
                          ? "bg-yellow-50 text-yellow-600"
                          : t.status === "FAILED"
                          ? "bg-red-50 text-red-600"
                          : "bg-zinc-100 text-zinc-500"
                      }`}
                    >
                      {t.status}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-zinc-400">
                    {t.nextRunAt?.toISOString().slice(0, 16) ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">
                    {t.lastRunAt?.toISOString().slice(0, 16) ?? "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">
                    {t.retryCount}/{t.maxRetries}
                  </td>
                  <td className="max-w-[200px] truncate px-4 py-2 text-xs text-red-500">
                    {t.lastError ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
