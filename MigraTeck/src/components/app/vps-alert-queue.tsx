"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/button";
import type { VpsAlertEventView } from "@/lib/vps/alerts";

type AlertQueueResponse = {
  items: VpsAlertEventView[];
};

function statusTone(status: VpsAlertEventView["status"]) {
  switch (status) {
    case "ACTIVE":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "ACKNOWLEDGED":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "SUPPRESSED":
      return "border-sky-200 bg-sky-50 text-sky-800";
    default:
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
}

function severityTone(severity: VpsAlertEventView["severity"]) {
  switch (severity) {
    case "CRITICAL":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "WARNING":
      return "border-amber-200 bg-amber-50 text-amber-800";
    default:
      return "border-slate-200 bg-slate-100 text-slate-700";
  }
}

export function VpsAlertQueue({
  serverId,
  initialAlerts,
  canManage,
  emptyMessage,
}: {
  serverId: string;
  initialAlerts: VpsAlertEventView[];
  canManage: boolean;
  emptyMessage: string;
}) {
  const [alerts, setAlerts] = useState(initialAlerts);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(alertEventId: string, action: "acknowledge" | "resolve" | "suppress", suppressMinutes?: number) {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);

        const response = await fetch(`/api/vps/servers/${serverId}/alerts/${alertEventId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ action, suppressMinutes }),
        });

        const payload = (await response.json().catch(() => ({}))) as { error?: string } & AlertQueueResponse;
        if (!response.ok) {
          throw new Error(payload.error || "Unable to update VPS alert.");
        }

        setAlerts(payload.items || []);
        setMessage(
          action === "acknowledge"
            ? "Alert acknowledged."
            : action === "resolve"
              ? "Alert resolved."
              : `Alert suppressed for ${suppressMinutes || 60} minutes.`,
        );
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to update VPS alert.");
      }
    });
  }

  if (!alerts.length) {
    return <p className="text-sm text-[var(--ink-muted)]">{emptyMessage}</p>;
  }

  return (
    <div className="space-y-3">
      {alerts.map((alert) => (
        <div key={alert.id} className="rounded-xl border border-[var(--line)] px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold text-[var(--ink)]">{alert.title}</p>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${severityTone(alert.severity)}`}>
                  {alert.severity}
                </span>
                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${statusTone(alert.status)}`}>
                  {alert.status}
                </span>
              </div>
              <p className="mt-2 text-sm text-[var(--ink-muted)]">{alert.message}</p>
              <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                {alert.code} · Last detected {new Date(alert.lastDetectedAt).toLocaleString()}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {alert.remediationAction ? `Recommended remediation: ${alert.remediationAction}. ` : ""}
                {alert.incident ? `Incident ${alert.incident.id} is ${alert.incident.state.toLowerCase()}.` : "No active incident is linked to this alert."}
              </p>
              {alert.suppressedUntil ? (
                <p className="mt-1 text-xs text-[var(--ink-muted)]">Suppressed until {new Date(alert.suppressedUntil).toLocaleString()}.</p>
              ) : null}
            </div>
            {canManage ? (
              <div className="flex flex-wrap gap-2">
                {alert.status !== "ACKNOWLEDGED" && alert.status !== "RESOLVED" ? (
                  <ActionButton variant="secondary" onClick={() => runAction(alert.id, "acknowledge")} disabled={isPending}>
                    {isPending ? "Working..." : "Acknowledge"}
                  </ActionButton>
                ) : null}
                {alert.status !== "RESOLVED" ? (
                  <ActionButton variant="secondary" onClick={() => runAction(alert.id, "suppress", 60)} disabled={isPending}>
                    {isPending ? "Working..." : "Suppress 60m"}
                  </ActionButton>
                ) : null}
                {alert.status !== "RESOLVED" ? (
                  <ActionButton onClick={() => runAction(alert.id, "resolve")} disabled={isPending}>
                    {isPending ? "Working..." : "Resolve"}
                  </ActionButton>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ))}

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
    </div>
  );
}