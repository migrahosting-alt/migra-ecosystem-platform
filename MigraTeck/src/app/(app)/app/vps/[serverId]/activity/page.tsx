import { notFound } from "next/navigation";
import { VpsAlertQueue } from "@/components/app/vps-alert-queue";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { listVpsActivity } from "@/lib/vps/data";
import { VpsSectionCard } from "@/components/app/vps-ui";

function describeEvent(eventType: string, payloadJson: unknown) {
  if (payloadJson && typeof payloadJson === "object" && payloadJson !== null && "message" in payloadJson) {
    const message = (payloadJson as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return eventType
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());
}

export default async function VpsActivityPage({ params }: { params: Promise<{ serverId: string }> }) {
  const { serverId } = await params;
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    notFound();
  }

  const activity = await listVpsActivity(serverId, membership.orgId);

  if (!activity) {
    notFound();
  }

  return (
    <div className="space-y-6">
      <VpsSectionCard title="Alert lifecycle" description="Current VPS alerts, suppression state, and incident linkage for this server.">
        <VpsAlertQueue
          serverId={serverId}
          initialAlerts={activity.alerts}
          canManage={false}
          emptyMessage="No VPS alerts are currently open for this server."
        />
      </VpsSectionCard>

      <VpsSectionCard title="Audit events" description="Forensic history for actions, policy changes, and provider-linked operations.">
        <div className="space-y-3">
          {activity.events.length ? activity.events.map((event) => (
            <div key={event.id} className="rounded-xl border border-[var(--line)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[var(--ink)]">{event.eventType}</p>
                <span className="text-xs text-[var(--ink-muted)]">{event.createdAt.toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">{describeEvent(event.eventType, event.payloadJson)}</p>
              <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                {event.severity} · {event.actorUserId || "SYSTEM"}
              </p>
            </div>
          )) : <p className="text-sm text-[var(--ink-muted)]">No audit events recorded yet.</p>}
        </div>
      </VpsSectionCard>

      <VpsSectionCard title="Action jobs" description="Long-running lifecycle requests and their current state.">
        <div className="space-y-3">
          {activity.jobs.length ? activity.jobs.map((job) => (
            <div key={job.id} className="rounded-xl border border-[var(--line)] px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold text-[var(--ink)]">{job.action}</p>
                <span className="text-xs text-[var(--ink-muted)]">{job.createdAt.toLocaleString()}</span>
              </div>
              <p className="mt-1 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                {job.status} · {job.requestedByUserId || "SYSTEM"}
              </p>
            </div>
          )) : <p className="text-sm text-[var(--ink-muted)]">No action jobs recorded yet.</p>}
        </div>
      </VpsSectionCard>
    </div>
  );
}
