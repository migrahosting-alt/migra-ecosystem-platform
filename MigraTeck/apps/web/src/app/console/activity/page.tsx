import { redirect } from "next/navigation";
import Link from "next/link";
import { Activity, AlertTriangle } from "lucide-react";

import { getSession } from "../lib/auth";
import {
  loadAllRecentEvents,
  loadDistinctActions,
  describeAction,
} from "../lib/modules";
import { tenantPath } from "../lib/urls";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { ActivityFilterBar } from "../components/ActivityFilterBar";

export const dynamic = "force-dynamic";

export default async function GlobalActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; action?: string; failures?: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const sp = await searchParams;
  const q = (sp.q || "").trim();
  const action = (sp.action || "").trim();
  const failuresOnly = sp.failures === "1";

  const [events, distinctActions] = await Promise.all([
    loadAllRecentEvents({
      ...(q && { q }),
      ...(action && { actions: [action] }),
      failuresOnly,
      limit: 200,
    }),
    loadDistinctActions(60),
  ]);

  const failureCount = events.filter((e) => e.result === "failure").length;

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/activity"
      title="Activity"
      subtitle={`${events.length} recent event${events.length === 1 ? "" : "s"}${
        failuresOnly ? " · failures only" : ""
      }`}
    >
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-fuchsia-300" />
            All client events
          </span>
        }
        subtitle="Every lifecycle action, note, contact change, order, and worker task — across every client."
        actions={
          failureCount > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-1 text-[10px] font-medium text-rose-200">
              <AlertTriangle className="h-3 w-3" />
              {failureCount} failure{failureCount === 1 ? "" : "s"}
            </span>
          ) : null
        }
      >
        <div className="mb-3">
          <ActivityFilterBar actions={distinctActions} />
        </div>

        {events.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-slate-500">
            No matching events.
          </p>
        ) : (
          <ol className="space-y-2">
            {events.map((e) => (
              <li
                key={e.id}
                className={`rounded-lg border p-3 text-xs ${
                  e.result === "failure"
                    ? "border-rose-400/30 bg-rose-500/5"
                    : "border-white/10 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          e.result === "failure"
                            ? "font-semibold text-rose-200"
                            : "font-semibold text-slate-100"
                        }
                      >
                        {describeAction(e.action)}
                      </span>
                      {e.tenantName && (
                        <Link
                          href={tenantPath(e.tenantId)}
                          className="rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-1.5 py-0.5 text-[10px] font-medium text-fuchsia-200 hover:bg-fuchsia-500/20"
                        >
                          {e.tenantName}
                        </Link>
                      )}
                    </div>
                    <p className="mt-0.5 text-[10px] text-slate-400">
                      {e.actorEmail || "system"}
                      {e.resource && (
                        <>
                          {" "}· {e.resource}
                          {e.resourceId ? ` (${e.resourceId.slice(0, 8)})` : ""}
                        </>
                      )}
                    </p>
                    {e.reason && (
                      <p className="mt-1.5 rounded bg-slate-950/40 p-1.5 text-[10px] text-slate-300">
                        “{e.reason}”
                      </p>
                    )}
                    {e.error && (
                      <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-rose-950/40 p-1.5 text-[10px] text-rose-300">
                        {e.error}
                      </pre>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-slate-500">
                    {e.createdAt ? new Date(e.createdAt).toLocaleString() : "—"}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        )}
      </SectionCard>
    </ConsolePageShell>
  );
}
