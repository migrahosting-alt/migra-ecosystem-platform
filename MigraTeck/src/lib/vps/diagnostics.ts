import { AlertSeverity, VpsActionStatus, VpsIncidentState } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { syncVpsAlertState } from "@/lib/vps/alerts";
import { isVpsSyncStale } from "@/lib/vps/features";

export type VpsDiagnosticsState = {
  server: {
    id: string;
    status: string;
    powerState: string;
    lastSyncedAt: string | null;
  };
  provider: {
    health: "HEALTHY" | "DEGRADED" | "UNREACHABLE" | "UNKNOWN";
    lastCheckedAt: string | null;
    error: string | null;
  };
  drift: {
    detected: boolean;
    type: string | null;
    detectedAt: string | null;
  };
  alerts: {
    openCount: number;
    criticalCount: number;
    items: Array<{
      id: string;
      code: string;
      status: "ACTIVE" | "ACKNOWLEDGED" | "SUPPRESSED";
      severity: AlertSeverity;
      title: string;
      message: string;
      source: string;
      firstDetectedAt: string;
      lastDetectedAt: string;
      suppressedUntil: string | null;
      remediationAction: string | null;
      incident: {
        id: string;
        state: VpsIncidentState;
        severity: AlertSeverity;
      } | null;
    }>;
  };
  incident: {
    id: string;
    state: VpsIncidentState;
    severity: AlertSeverity;
    openedAt: string;
  } | null;
  lastJob: {
    id: string;
    type: string;
    status: VpsActionStatus;
    finishedAt: string | null;
  } | null;
  lastFailedJob: {
    id: string;
    type: string;
    status: VpsActionStatus;
    error: string | null;
    finishedAt: string | null;
  } | null;
  remediation: {
    lastRun: string | null;
    lastStatus: VpsActionStatus | null;
  };
  sla: {
    state: "HEALTHY" | "AT_RISK" | "BREACHED";
    responseDeadlineAt: string | null;
    mitigationDeadlineAt: string | null;
    breachedAt: string | null;
  } | null;
};

export type VpsDiagnosticsSummary = {
  providerHealthState: VpsDiagnosticsState["provider"]["health"];
  driftDetected: boolean;
  incidentOpen: boolean;
  lastSyncedAt: string | null;
};

function toIsoOrNull(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

function extractErrorMessage(value: unknown): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }

    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  return String(value);
}

function computeSlaState(input: {
  responseDeadlineAt: Date | null;
  mitigationDeadlineAt: Date | null;
  breachedAt: Date | null;
}) {
  const now = Date.now();
  const responseDeadline = input.responseDeadlineAt?.getTime() ?? null;
  const mitigationDeadline = input.mitigationDeadlineAt?.getTime() ?? null;

  if (
    input.breachedAt
    || (responseDeadline !== null && responseDeadline <= now)
    || (mitigationDeadline !== null && mitigationDeadline <= now)
  ) {
    return "BREACHED" as const;
  }

  const atRiskThresholdMs = 60 * 60 * 1000;
  if (
    (responseDeadline !== null && responseDeadline - now <= atRiskThresholdMs)
    || (mitigationDeadline !== null && mitigationDeadline - now <= atRiskThresholdMs)
  ) {
    return "AT_RISK" as const;
  }

  return "HEALTHY" as const;
}

export function summarizeDiagnosticsState(diagnostics: VpsDiagnosticsState): VpsDiagnosticsSummary {
  return {
    providerHealthState: diagnostics.provider.health,
    driftDetected: diagnostics.drift.detected,
    incidentOpen: Boolean(diagnostics.incident),
    lastSyncedAt: diagnostics.server.lastSyncedAt,
  };
}

export function buildVpsRecommendedActions(diagnostics: VpsDiagnosticsState): string[] {
  const actions: string[] = [];

  if (diagnostics.provider.health === "UNREACHABLE") {
    actions.push("Pause destructive changes until provider connectivity is restored and a fresh sync completes.");
  } else if (diagnostics.provider.health === "DEGRADED") {
    actions.push("Keep the server in safe mode and avoid high-risk changes until provider health returns to healthy.");
  }

  if (diagnostics.drift.detected) {
    actions.push("Run a reconcile or manual sync to bring persisted control-plane state back in line with the provider.");
  }

  if (diagnostics.lastFailedJob) {
    actions.push(`Review the failed ${diagnostics.lastFailedJob.type.toLowerCase().replace(/_/g, " ")} job before retrying automation.`);
  }

  if (diagnostics.incident) {
    actions.push("Keep the current incident open until response and mitigation deadlines are satisfied or explicitly resolved.");
  }

  if (actions.length === 0) {
    actions.push("No immediate remediation is required from the current persisted control-plane state.");
  }

  return actions;
}

export function assertDiagnosticsConsistency(diagnostics: VpsDiagnosticsState) {
  if (diagnostics.drift.detected && !diagnostics.drift.type) {
    throw new Error("Diagnostics inconsistency: drift is detected but drift.type is missing.");
  }

  if (
    diagnostics.provider.health === "UNREACHABLE"
    && !isVpsSyncStale(diagnostics.server.lastSyncedAt ? new Date(diagnostics.server.lastSyncedAt) : null)
    && !diagnostics.provider.error
  ) {
    throw new Error("Diagnostics inconsistency: unreachable provider must have stale sync data or an explicit provider error.");
  }

  if (diagnostics.incident && diagnostics.alerts.openCount === 0) {
    throw new Error("Diagnostics inconsistency: active incident exists without open alerts.");
  }

  if (diagnostics.alerts.items.length > diagnostics.alerts.openCount) {
    throw new Error("Diagnostics inconsistency: alert items cannot exceed the open alert count.");
  }

  if (diagnostics.alerts.items.some((event) => event.status === "SUPPRESSED")) {
    throw new Error("Diagnostics inconsistency: suppressed alerts must not appear in the actionable diagnostics alert queue.");
  }

  if (diagnostics.lastFailedJob && diagnostics.lastFailedJob.status !== VpsActionStatus.FAILED) {
    throw new Error("Diagnostics inconsistency: lastFailedJob must have FAILED status.");
  }

  return diagnostics;
}

export async function getServerDiagnostics(serverId: string, orgId: string): Promise<VpsDiagnosticsState | null> {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    select: {
      id: true,
      status: true,
      powerState: true,
      lastSyncedAt: true,
      providerHealthState: true,
      providerLastCheckedAt: true,
      providerError: true,
      driftDetectedAt: true,
      driftType: true,
    },
  });

  if (!server) {
    return null;
  }

  const alertEvents = await syncVpsAlertState(server.id);
  const actionableAlerts = (alertEvents || []).filter((event) => event.status === "ACTIVE" || event.status === "ACKNOWLEDGED");

  const [incident, lastJob, lastFailedJob, lastRemediation] = await Promise.all([
    prisma.vpsIncident.findFirst({
      where: {
        serverId: server.id,
        orgId,
        state: { in: [VpsIncidentState.OPEN, VpsIncidentState.ACKNOWLEDGED, VpsIncidentState.MITIGATING] },
      },
      orderBy: { openedAt: "desc" },
      select: {
        id: true,
        state: true,
        severity: true,
        openedAt: true,
        responseDeadlineAt: true,
        mitigationDeadlineAt: true,
        breachedAt: true,
      },
    }),
    prisma.vpsActionJob.findFirst({
      where: { serverId: server.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        status: true,
        finishedAt: true,
      },
    }),
    prisma.vpsActionJob.findFirst({
      where: { serverId: server.id, status: VpsActionStatus.FAILED },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        action: true,
        status: true,
        errorJson: true,
        finishedAt: true,
      },
    }),
    prisma.vpsActionJob.findFirst({
      where: { serverId: server.id, action: "MANUAL_SYNC" },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        finishedAt: true,
        createdAt: true,
      },
    }),
  ]);

  const diagnostics: VpsDiagnosticsState = {
    server: {
      id: server.id,
      status: server.status,
      powerState: server.powerState,
      lastSyncedAt: toIsoOrNull(server.lastSyncedAt),
    },
    provider: {
      health: server.providerHealthState,
      lastCheckedAt: toIsoOrNull(server.providerLastCheckedAt),
      error: server.providerError || null,
    },
    drift: {
      detected: Boolean(server.driftDetectedAt),
      type: server.driftType || null,
      detectedAt: toIsoOrNull(server.driftDetectedAt),
    },
    alerts: {
      openCount: actionableAlerts.length,
      criticalCount: actionableAlerts.filter((event) => event.severity === "CRITICAL").length,
      items: actionableAlerts.slice(0, 5).map((event) => ({
        id: event.id,
        code: event.code,
        status: event.status,
        severity: event.severity,
        title: event.title,
        message: event.message,
        source: event.source,
        firstDetectedAt: event.firstDetectedAt,
        lastDetectedAt: event.lastDetectedAt,
        suppressedUntil: event.suppressedUntil,
        remediationAction: event.remediationAction,
        incident: event.incident
          ? {
              id: event.incident.id,
              state: event.incident.state,
              severity: event.incident.severity,
            }
          : null,
      })),
    },
    incident: incident
      ? {
          id: incident.id,
          state: incident.state,
          severity: incident.severity,
          openedAt: incident.openedAt.toISOString(),
        }
      : null,
    lastJob: lastJob
      ? {
          id: lastJob.id,
          type: lastJob.action,
          status: lastJob.status,
          finishedAt: toIsoOrNull(lastJob.finishedAt),
        }
      : null,
    lastFailedJob: lastFailedJob
      ? {
          id: lastFailedJob.id,
          type: lastFailedJob.action,
          status: lastFailedJob.status,
          error: extractErrorMessage(lastFailedJob.errorJson),
          finishedAt: toIsoOrNull(lastFailedJob.finishedAt),
        }
      : null,
    remediation: {
      lastRun: toIsoOrNull(lastRemediation?.finishedAt || lastRemediation?.createdAt),
      lastStatus: lastRemediation?.status || null,
    },
    sla: incident
      ? {
          state: computeSlaState({
            responseDeadlineAt: incident.responseDeadlineAt,
            mitigationDeadlineAt: incident.mitigationDeadlineAt,
            breachedAt: incident.breachedAt,
          }),
          responseDeadlineAt: toIsoOrNull(incident.responseDeadlineAt),
          mitigationDeadlineAt: toIsoOrNull(incident.mitigationDeadlineAt),
          breachedAt: toIsoOrNull(incident.breachedAt),
        }
      : null,
  };

  if (process.env.NODE_ENV !== "production") {
    assertDiagnosticsConsistency(diagnostics);
  }

  return diagnostics;
}
