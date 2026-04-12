import Link from "next/link";
import { Prisma } from "@prisma/client";
import { OpsJobActions } from "@/components/app/ops-job-actions";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getFilteredAuditEvents, getSloMetrics, getWorkerDashboard, OpsAccessError, resolveOpsScope } from "@/lib/ops/observability";
import { prisma } from "@/lib/prisma";

function value(input: string | string[] | undefined): string | undefined {
  if (Array.isArray(input)) {
    return input[0];
  }

  return input;
}

function prettyJson(input: Prisma.JsonValue | null): string {
  if (input === null) {
    return "-";
  }

  try {
    return JSON.stringify(input);
  } catch {
    return "-";
  }
}

export default async function OpsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireAuthSession();
  const params = await searchParams;

  let scope;
  try {
    scope = await resolveOpsScope({
      actorUserId: session.user.id,
      requestedOrgId: value(params.orgId),
      route: "/app/platform/ops",
    });
  } catch (error) {
    if (error instanceof OpsAccessError) {
      return (
        <section className="space-y-4">
          <h1 className="text-3xl font-black tracking-tight">Operations</h1>
          <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error.message}</p>
        </section>
      );
    }

    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Operations</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Forbidden</p>
      </section>
    );
  }

  const [workers, slos, filtered, webhooks, provisioningRuns, memberships] = await Promise.all([
    getWorkerDashboard(scope.orgId),
    getSloMetrics(scope.orgId),
    getFilteredAuditEvents(scope.orgId, {
      actorId: value(params.actorId),
      action: value(params.action),
      riskTier: value(params.riskTier) === "0" || value(params.riskTier) === "1" || value(params.riskTier) === "2"
        ? (Number(value(params.riskTier)) as 0 | 1 | 2)
        : undefined,
      route: value(params.route),
      from: value(params.from) ? new Date(value(params.from) as string) : undefined,
      to: value(params.to) ? new Date(value(params.to) as string) : undefined,
      limit: value(params.limit) ? Number(value(params.limit)) : 150,
    }),
    prisma.billingWebhookEvent.findMany({
      orderBy: { receivedAt: "desc" },
      take: 50,
    }),
    prisma.provisioningJob.findMany({
      where: {
        orgId: scope.orgId,
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.membership.findMany({
      where: {
        orgId: scope.orgId,
        status: "ACTIVE",
      },
      select: {
        userId: true,
        role: true,
      },
    }),
  ]);

  const roleByUser = new Map(memberships.map((item) => [item.userId, item.role]));
  const activeOrg = await getActiveOrgContext(session.user.id);

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-black tracking-tight">Operations Explorer</h1>
        <div className="flex items-center gap-3">
          <Link href="/app/platform/ops/alerts" className="text-sm font-semibold text-[var(--brand-600)]">Alerts</Link>
          <Link href="/app/platform/ops/events" className="text-sm font-semibold text-[var(--brand-600)]">Events</Link>
          <Link href="/app/platform/ops/scheduler" className="text-sm font-semibold text-[var(--brand-600)]">Scheduler</Link>
          <Link href="/app/system" className="text-sm font-semibold text-[var(--brand-600)]">System</Link>
          <Link href="/app/audit" className="text-sm font-semibold text-[var(--brand-600)]">Audit</Link>
        </div>
      </div>
      <p className="text-sm text-[var(--ink-muted)]">Scope org: {scope.orgId} ({scope.role})</p>
      <form className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 md:grid-cols-4">
        <input type="hidden" name="orgId" defaultValue={value(params.orgId) || activeOrg?.orgId || scope.orgId} />
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Actor</span>
          <input name="actorId" defaultValue={value(params.actorId) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Action</span>
          <input name="action" defaultValue={value(params.action) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Risk tier</span>
          <select name="riskTier" defaultValue={value(params.riskTier) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2">
            <option value="">Any</option>
            <option value="0">Tier 0</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Route</span>
          <input name="route" defaultValue={value(params.route) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">From</span>
          <input name="from" type="datetime-local" defaultValue={value(params.from) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">To</span>
          <input name="to" type="datetime-local" defaultValue={value(params.to) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Limit</span>
          <input name="limit" type="number" min={1} max={500} defaultValue={value(params.limit) || "150"} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="w-full rounded-xl bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white">Apply filters</button>
        </div>
      </form>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Queue depth</p>
          <p className="mt-2 text-3xl font-black">{workers.queue.pending + workers.queue.processing}</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Oldest queue age</p>
          <p className="mt-2 text-3xl font-black">{workers.queue.oldestAgeSeconds ?? 0}s</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Webhook latency p95</p>
          <p className="mt-2 text-3xl font-black">{slos.stripeWebhookProcessingLatencyMs.p95 ?? 0}ms</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Provisioning completion p95</p>
          <p className="mt-2 text-3xl font-black">{slos.provisioningJobCompletionTimeMs.p95 ?? 0}ms</p>
        </article>
      </div>

      <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
        <h2 className="text-lg font-bold">Active alerts</h2>
        {workers.alerts.length ? (
          <ul className="mt-2 space-y-1 text-sm text-amber-800">
            {workers.alerts.map((alert) => (
              <li key={alert}>- {alert}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">No active alerts.</p>
        )}
      </article>

      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Audit events ({filtered.totals.count})</h2>
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th className="px-3 py-2">Action</th>
              <th className="px-3 py-2">Actor</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Tier</th>
              <th className="px-3 py-2">Route</th>
            </tr>
          </thead>
          <tbody>
            {filtered.events.map((event) => (
              <tr key={event.id} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 text-[var(--ink-muted)]">{event.createdAt.toISOString()}</td>
                <td className="px-3 py-2 font-semibold">{event.action}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{event.userId || "system"}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{event.userId ? (roleByUser.get(event.userId) || "-") : "SYSTEM"}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{event.riskTier ?? "-"}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{event.route || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Webhook events</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
              <tr>
                <th className="px-3 py-2">Received</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Reason</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((event) => (
                <tr key={event.id} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{event.receivedAt.toISOString()}</td>
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{event.eventType}</td>
                  <td className="px-3 py-2 font-semibold">{event.status}</td>
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{event.reason || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Provisioning runs</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
              <tr>
                <th className="px-3 py-2">Created</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Attempts</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {provisioningRuns.map((run) => (
                <tr key={run.id} className="border-t border-[var(--line)]">
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{run.createdAt.toISOString()}</td>
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{run.type}</td>
                  <td className="px-3 py-2 font-semibold">{run.status}</td>
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{run.attempts}</td>
                  <td className="px-3 py-2 text-[var(--ink-muted)]">{run.lastError ? run.lastError.slice(0, 80) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </div>

      <OpsJobActions
        orgId={scope.orgId}
        jobs={provisioningRuns.map((run) => ({
          id: run.id,
          type: run.type,
          status: run.status,
          attempts: run.attempts,
          lastError: run.lastError,
        }))}
      />

      <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
        <h2 className="text-lg font-bold">Mutation denial rate</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {Math.round(slos.mutationDenialRateByReason.denialRate * 100)}% ({slos.mutationDenialRateByReason.totalDenied} / {slos.mutationDenialRateByReason.totalMutations})
        </p>
        <div className="mt-2 text-xs text-[var(--ink-muted)]">
          {slos.mutationDenialRateByReason.reasons.map((entry) => (
            <p key={entry.reason}>{entry.reason}: {entry.count}</p>
          ))}
        </div>
      </article>

      <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
        <h2 className="text-lg font-bold">Dead-letter details</h2>
        {workers.queue.deadLetterItems.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--ink-muted)]">No dead-letter provisioning items.</p>
        ) : (
          <div className="mt-2 space-y-2 text-xs text-[var(--ink-muted)]">
            {workers.queue.deadLetterItems.map((item) => (
              <pre key={item.id} className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2">
{prettyJson(item as unknown as Prisma.JsonValue)}
              </pre>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
