import Link from "next/link";
import { requireAuthSession, getActiveOrgContext } from "@/lib/auth/session";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);
  const params = await searchParams;

  if (!ctx || !can(ctx.role, "ops:read")) {
    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Platform Events</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          You don&apos;t have permission to view platform events.
        </p>
      </section>
    );
  }

  const eventType = typeof params.eventType === "string" ? params.eventType : undefined;
  const source = typeof params.source === "string" ? params.source : undefined;

  const events = await prisma.platformEvent.findMany({
    where: {
      orgId: ctx.orgId,
      ...(eventType ? { eventType } : {}),
      ...(source ? { source } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Get distinct event types for filtering
  const eventTypes = await prisma.platformEvent.groupBy({
    by: ["eventType"],
    where: { orgId: ctx.orgId },
    _count: true,
    orderBy: { _count: { eventType: "desc" } },
    take: 30,
  });

  return (
    <section className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Platform Events</h1>
          <p className="text-sm text-zinc-500">{events.length} events shown</p>
        </div>
        <Link href="/app/platform/ops" className="text-sm text-blue-600 hover:underline">
          ← Back to Ops
        </Link>
      </div>

      {/* Event Type Filters */}
      {eventTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/platform/ops/events"
            className={`rounded-full px-3 py-1 text-xs ${
              !eventType ? "bg-blue-100 text-blue-700" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            All
          </Link>
          {eventTypes.map((et) => (
            <Link
              key={et.eventType}
              href={`/app/platform/ops/events?eventType=${encodeURIComponent(et.eventType)}`}
              className={`rounded-full px-3 py-1 text-xs ${
                eventType === et.eventType
                  ? "bg-blue-100 text-blue-700"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              {et.eventType} ({et._count})
            </Link>
          ))}
        </div>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-zinc-400">No events recorded.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="min-w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs font-medium uppercase text-zinc-500">
              <tr>
                <th className="px-4 py-2">Event Type</th>
                <th className="px-4 py-2">Source</th>
                <th className="px-4 py-2">Entity</th>
                <th className="px-4 py-2">Actor</th>
                <th className="px-4 py-2">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.map((e) => (
                <tr key={e.id} className="hover:bg-zinc-50/50">
                  <td className="px-4 py-2 font-mono text-xs">{e.eventType}</td>
                  <td className="px-4 py-2 text-zinc-500">{e.source}</td>
                  <td className="px-4 py-2 text-zinc-500">
                    {e.entityType ? `${e.entityType}:${e.entityId?.slice(0, 8)}` : "—"}
                  </td>
                  <td className="px-4 py-2 text-zinc-400">{e.actorId?.slice(0, 8) ?? "system"}</td>
                  <td className="px-4 py-2 text-zinc-400">{e.createdAt.toISOString().slice(0, 19)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
