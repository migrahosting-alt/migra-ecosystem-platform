import {
  AlertSeverity,
  AlertStatus,
  Prisma,
  VpsAlertEventStatus,
  VpsIncidentState,
  VpsProviderHealthState,
  VpsActionStatus,
} from "@prisma/client";
import { acknowledgeAlert, raiseAlert, resolveAlert, silenceAlert } from "@/lib/alerts";
import { emitPlatformEvent } from "@/lib/platform-events";
import { prisma } from "@/lib/prisma";
import { writeVpsAuditEvent } from "@/lib/vps/audit";

type AlertSignal = {
  title: string;
  message: string;
  source: string;
  detailJson?: Prisma.InputJsonValue | undefined;
};

type VpsAlertSnapshot = {
  server: {
    id: string;
    orgId: string;
    name: string;
    providerSlug: string;
    providerHealthState: VpsProviderHealthState;
    providerLastCheckedAt: Date | null;
    providerError: string | null;
    driftDetectedAt: Date | null;
    driftType: string | null;
    lastSyncedAt: Date | null;
  };
  latestJob: {
    id: string;
    action: string;
    status: VpsActionStatus;
    errorJson: Prisma.JsonValue | null;
    finishedAt: Date | null;
    createdAt: Date;
  } | null;
};

type BuiltInVpsAlertRule = {
  code: string;
  name: string;
  description: string;
  severity: AlertSeverity;
  escalationEnabled: boolean;
  responseSlaMinutes?: number | undefined;
  mitigationSlaMinutes?: number | undefined;
  suppressionMinutes: number;
  remediationAction?: string | undefined;
  evaluate: (snapshot: VpsAlertSnapshot) => AlertSignal | null;
};

export type VpsAlertEventView = {
  id: string;
  alertId: string | null;
  code: string;
  name: string;
  status: VpsAlertEventStatus;
  severity: AlertSeverity;
  title: string;
  message: string;
  source: string;
  firstDetectedAt: string;
  lastDetectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  suppressedUntil: string | null;
  remediationAction: string | null;
  detail: Prisma.JsonValue | null;
  alertStatus: AlertStatus | null;
  incident: {
    id: string;
    state: VpsIncidentState;
    severity: AlertSeverity;
    openedAt: string;
    responseDeadlineAt: string | null;
    mitigationDeadlineAt: string | null;
    breachedAt: string | null;
  } | null;
};

const OPEN_EVENT_STATUSES = [VpsAlertEventStatus.ACTIVE, VpsAlertEventStatus.ACKNOWLEDGED] as const;
const INCIDENT_OPEN_STATES: VpsIncidentState[] = [
  VpsIncidentState.OPEN,
  VpsIncidentState.ACKNOWLEDGED,
  VpsIncidentState.MITIGATING,
];
export const VPS_OPEN_ALERT_EVENT_STATUSES = OPEN_EVENT_STATUSES;

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function extractErrorMessage(value: Prisma.JsonValue | null): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
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

function getRuleMetadata(rule: { metadataJson: Prisma.JsonValue | null }) {
  if (!rule.metadataJson || typeof rule.metadataJson !== "object" || Array.isArray(rule.metadataJson)) {
    return {} as { remediationAction?: string };
  }

  return rule.metadataJson as { remediationAction?: string };
}

function buildEventFingerprint(serverId: string, code: string) {
  return `${serverId}:${code}`;
}

function auditSeverityForAlert(severity: AlertSeverity) {
  switch (severity) {
    case AlertSeverity.CRITICAL:
      return "CRITICAL" as const;
    case AlertSeverity.WARNING:
      return "WARNING" as const;
    default:
      return "INFO" as const;
  }
}

function formatActionLabel(action: string) {
  return action.toLowerCase().replace(/_/g, " ");
}

const BUILT_IN_VPS_ALERT_RULES: BuiltInVpsAlertRule[] = [
  {
    code: "PROVIDER_UNREACHABLE",
    name: "Provider unreachable",
    description: "The provider API is unreachable, so the control plane cannot verify or safely reconcile server state.",
    severity: AlertSeverity.CRITICAL,
    escalationEnabled: true,
    responseSlaMinutes: 15,
    mitigationSlaMinutes: 60,
    suppressionMinutes: 30,
    remediationAction: "MANUAL_SYNC",
    evaluate(snapshot) {
      if (snapshot.server.providerHealthState !== VpsProviderHealthState.UNREACHABLE) {
        return null;
      }

      return {
        title: "Provider unreachable",
        message: snapshot.server.providerError
          ? `Provider connectivity failed: ${snapshot.server.providerError}`
          : "Provider connectivity failed and the control plane can no longer verify the server state.",
        source: "vps-provider",
        detailJson: jsonValue({
          providerSlug: snapshot.server.providerSlug,
          providerHealthState: snapshot.server.providerHealthState,
          providerError: snapshot.server.providerError,
          providerLastCheckedAt: snapshot.server.providerLastCheckedAt?.toISOString() || null,
          lastSyncedAt: snapshot.server.lastSyncedAt?.toISOString() || null,
        }),
      };
    },
  },
  {
    code: "PROVIDER_DEGRADED",
    name: "Provider degraded",
    description: "The provider API is responding with degraded health signals and high-risk actions should remain restricted.",
    severity: AlertSeverity.WARNING,
    escalationEnabled: false,
    suppressionMinutes: 60,
    remediationAction: "MANUAL_SYNC",
    evaluate(snapshot) {
      if (snapshot.server.providerHealthState !== VpsProviderHealthState.DEGRADED) {
        return null;
      }

      return {
        title: "Provider degraded",
        message: snapshot.server.providerError
          ? `Provider health is degraded: ${snapshot.server.providerError}`
          : "Provider health is degraded and destructive actions should remain gated.",
        source: "vps-provider",
        detailJson: jsonValue({
          providerSlug: snapshot.server.providerSlug,
          providerHealthState: snapshot.server.providerHealthState,
          providerError: snapshot.server.providerError,
          providerLastCheckedAt: snapshot.server.providerLastCheckedAt?.toISOString() || null,
        }),
      };
    },
  },
  {
    code: "CONTROL_PLANE_DRIFT",
    name: "Control-plane drift detected",
    description: "Persisted VPS state differs from the provider and should be reconciled before additional automation runs.",
    severity: AlertSeverity.WARNING,
    escalationEnabled: false,
    suppressionMinutes: 120,
    remediationAction: "MANUAL_SYNC",
    evaluate(snapshot) {
      if (!snapshot.server.driftDetectedAt) {
        return null;
      }

      return {
        title: "Control-plane drift detected",
        message: snapshot.server.driftType
          ? `Drift detected: ${snapshot.server.driftType}`
          : "Drift was detected between the provider and persisted control-plane state.",
        source: "vps-reconcile",
        detailJson: jsonValue({
          driftType: snapshot.server.driftType,
          driftDetectedAt: snapshot.server.driftDetectedAt.toISOString(),
          lastSyncedAt: snapshot.server.lastSyncedAt?.toISOString() || null,
        }),
      };
    },
  },
  {
    code: "LATEST_JOB_FAILED",
    name: "Latest action failed",
    description: "The latest VPS action job failed and requires review before automation is retried.",
    severity: AlertSeverity.WARNING,
    escalationEnabled: false,
    suppressionMinutes: 60,
    evaluate(snapshot) {
      if (!snapshot.latestJob || snapshot.latestJob.status !== VpsActionStatus.FAILED) {
        return null;
      }

      const errorMessage = extractErrorMessage(snapshot.latestJob.errorJson);

      return {
        title: "Latest action failed",
        message: errorMessage
          ? `The latest ${formatActionLabel(snapshot.latestJob.action)} job failed: ${errorMessage}`
          : `The latest ${formatActionLabel(snapshot.latestJob.action)} job failed and requires review before retrying automation.`,
        source: "vps-jobs",
        detailJson: jsonValue({
          jobId: snapshot.latestJob.id,
          action: snapshot.latestJob.action,
          status: snapshot.latestJob.status,
          finishedAt: snapshot.latestJob.finishedAt?.toISOString() || null,
          error: errorMessage,
        }),
      };
    },
  },
];

type ExistingEventRecord = Prisma.VpsAlertEventGetPayload<{
  include: {
    rule: true;
    alert: {
      select: {
        id: true;
        status: true;
        acknowledgedAt: true;
        resolvedAt: true;
      };
    };
  };
}>;

async function ensureVpsAlertRules(orgId: string) {
  await Promise.all(BUILT_IN_VPS_ALERT_RULES.map((rule) => prisma.vpsAlertRule.upsert({
    where: {
      orgId_code: {
        orgId,
        code: rule.code,
      },
    },
    update: {
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      escalationEnabled: rule.escalationEnabled,
      responseSlaMinutes: rule.responseSlaMinutes ?? null,
      mitigationSlaMinutes: rule.mitigationSlaMinutes ?? null,
      suppressionMinutes: rule.suppressionMinutes,
      metadataJson: jsonValue({ remediationAction: rule.remediationAction || null }),
      status: "ENABLED",
    },
    create: {
      orgId,
      code: rule.code,
      name: rule.name,
      description: rule.description,
      severity: rule.severity,
      escalationEnabled: rule.escalationEnabled,
      responseSlaMinutes: rule.responseSlaMinutes ?? null,
      mitigationSlaMinutes: rule.mitigationSlaMinutes ?? null,
      suppressionMinutes: rule.suppressionMinutes,
      metadataJson: jsonValue({ remediationAction: rule.remediationAction || null }),
    },
  })));

  return prisma.vpsAlertRule.findMany({
    where: {
      orgId,
      code: { in: BUILT_IN_VPS_ALERT_RULES.map((rule) => rule.code) },
      status: "ENABLED",
    },
  });
}

async function createOrRefreshIncident(input: {
  alertId: string;
  orgId: string;
  serverId: string;
  severity: AlertSeverity;
  responseSlaMinutes?: number | null | undefined;
  mitigationSlaMinutes?: number | null | undefined;
  actorUserId?: string | null | undefined;
}) {
  const now = new Date();
  const existingIncident = await prisma.vpsIncident.findFirst({
    where: { alertId: input.alertId },
    orderBy: { openedAt: "desc" },
  });

  const responseDeadlineAt = input.responseSlaMinutes ? new Date(now.getTime() + input.responseSlaMinutes * 60 * 1000) : null;
  const mitigationDeadlineAt = input.mitigationSlaMinutes ? new Date(now.getTime() + input.mitigationSlaMinutes * 60 * 1000) : null;

  if (existingIncident) {
    if (INCIDENT_OPEN_STATES.includes(existingIncident.state)) {
      return prisma.vpsIncident.update({
        where: { id: existingIncident.id },
        data: {
          severity: input.severity,
        },
      });
    }

    const reopened = await prisma.vpsIncident.update({
      where: { id: existingIncident.id },
      data: {
        state: VpsIncidentState.OPEN,
        severity: input.severity,
        openedAt: now,
        responseDeadlineAt,
        mitigationDeadlineAt,
        breachedAt: null,
      },
    });

    await emitPlatformEvent({
      eventType: "incident.created",
      source: "vps-alert-engine",
      orgId: input.orgId,
      actorId: input.actorUserId || undefined,
      entityType: "VPS_SERVER",
      entityId: input.serverId,
      payload: jsonValue({ incidentId: reopened.id, alertId: input.alertId, severity: input.severity, reopened: true }),
    });

    return reopened;
  }

  const incident = await prisma.vpsIncident.create({
    data: {
      serverId: input.serverId,
      orgId: input.orgId,
      alertId: input.alertId,
      state: VpsIncidentState.OPEN,
      severity: input.severity,
      responseDeadlineAt,
      mitigationDeadlineAt,
    },
  });

  await emitPlatformEvent({
    eventType: "incident.created",
    source: "vps-alert-engine",
    orgId: input.orgId,
    actorId: input.actorUserId || undefined,
    entityType: "VPS_SERVER",
    entityId: input.serverId,
    payload: jsonValue({ incidentId: incident.id, alertId: input.alertId, severity: input.severity }),
  });

  return incident;
}

async function resolveIncidentForAlert(input: {
  alertId: string;
  orgId: string;
  serverId: string;
  actorUserId?: string | null | undefined;
}) {
  const incident = await prisma.vpsIncident.findFirst({
    where: {
      alertId: input.alertId,
      state: { in: INCIDENT_OPEN_STATES },
    },
    orderBy: { openedAt: "desc" },
  });

  if (!incident) {
    return null;
  }

  const resolved = await prisma.vpsIncident.update({
    where: { id: incident.id },
    data: { state: VpsIncidentState.RESOLVED },
  });

  await emitPlatformEvent({
    eventType: "incident.resolved",
    source: "vps-alert-engine",
    orgId: input.orgId,
    actorId: input.actorUserId || undefined,
    entityType: "VPS_SERVER",
    entityId: input.serverId,
    payload: jsonValue({ incidentId: resolved.id, alertId: input.alertId }),
  });

  return resolved;
}

async function synchronizeIncidentSla(orgId: string, serverId: string) {
  const now = new Date();
  const incidents = await prisma.vpsIncident.findMany({
    where: {
      orgId,
      serverId,
      state: { in: INCIDENT_OPEN_STATES },
    },
    select: {
      id: true,
      breachedAt: true,
      responseDeadlineAt: true,
      mitigationDeadlineAt: true,
    },
  });

  for (const incident of incidents) {
    const responseBreached = incident.responseDeadlineAt && incident.responseDeadlineAt <= now;
    const mitigationBreached = incident.mitigationDeadlineAt && incident.mitigationDeadlineAt <= now;

    if ((responseBreached || mitigationBreached) && !incident.breachedAt) {
      await prisma.vpsIncident.update({
        where: { id: incident.id },
        data: { breachedAt: now },
      });
    }
  }
}

async function activateEvent(input: {
  server: VpsAlertSnapshot["server"];
  rule: Awaited<ReturnType<typeof ensureVpsAlertRules>>[number];
  signal: AlertSignal;
  existing: ExistingEventRecord | undefined;
  actorUserId?: string | null | undefined;
}) {
  const now = new Date();
  const metadata = getRuleMetadata(input.rule);
  const suppressionExpired = Boolean(
    input.existing
    && input.existing.status === VpsAlertEventStatus.SUPPRESSED
    && (!input.existing.suppressedUntil || input.existing.suppressedUntil <= now),
  );
  const suppressedActive = Boolean(
    input.existing
    && input.existing.status === VpsAlertEventStatus.SUPPRESSED
    && input.existing.suppressedUntil
    && input.existing.suppressedUntil > now,
  );
  const reopening = !input.existing || input.existing.status === VpsAlertEventStatus.RESOLVED || suppressionExpired;

  let linkedAlertId = input.existing?.alertId || null;
  if (!suppressedActive) {
    const linkedAlert = input.existing?.alert || null;
    if (!linkedAlert || linkedAlert.status === AlertStatus.RESOLVED || linkedAlert.status === AlertStatus.SILENCED || reopening) {
      const createdAlert = await raiseAlert({
        orgId: input.server.orgId,
        severity: input.rule.severity,
        title: `${input.server.name}: ${input.signal.title}`,
        message: input.signal.message,
        source: input.signal.source,
        entityType: "VPS_SERVER",
        entityId: input.server.id,
        metadata: jsonValue({
          serverId: input.server.id,
          ruleCode: input.rule.code,
          remediationAction: metadata.remediationAction || null,
        }),
      });
      linkedAlertId = createdAlert?.id || null;
    }
  }

  const nextStatus = suppressedActive
    ? VpsAlertEventStatus.SUPPRESSED
    : input.existing?.status === VpsAlertEventStatus.ACKNOWLEDGED && !reopening
      ? VpsAlertEventStatus.ACKNOWLEDGED
      : VpsAlertEventStatus.ACTIVE;

  const event = input.existing
    ? await prisma.vpsAlertEvent.update({
        where: { id: input.existing.id },
        data: {
          alertId: linkedAlertId,
          status: nextStatus,
          severity: input.rule.severity,
          title: input.signal.title,
          message: input.signal.message,
          source: input.signal.source,
          detailJson: input.signal.detailJson ?? Prisma.JsonNull,
          resolvedAt: null,
          firstDetectedAt: reopening ? now : input.existing.firstDetectedAt,
          lastDetectedAt: reopening ? now : input.existing.lastDetectedAt,
          suppressedUntil: suppressedActive ? input.existing.suppressedUntil : null,
        },
      })
    : await prisma.vpsAlertEvent.create({
        data: {
          orgId: input.server.orgId,
          serverId: input.server.id,
          ruleId: input.rule.id,
          alertId: linkedAlertId,
          status: nextStatus,
          fingerprint: buildEventFingerprint(input.server.id, input.rule.code),
          severity: input.rule.severity,
          title: input.signal.title,
          message: input.signal.message,
          source: input.signal.source,
          detailJson: input.signal.detailJson ?? Prisma.JsonNull,
          firstDetectedAt: now,
          lastDetectedAt: now,
        },
      });

  if (reopening || !input.existing) {
    await writeVpsAuditEvent({
      orgId: input.server.orgId,
      serverId: input.server.id,
      actorUserId: input.actorUserId || null,
      eventType: `ALERT_${input.rule.code}_${input.existing ? "REOPENED" : "OPENED"}`,
      severity: auditSeverityForAlert(input.rule.severity),
      metadataJson: {
        alertEventId: event.id,
        alertId: linkedAlertId,
        ruleCode: input.rule.code,
        message: input.signal.message,
      },
    });
  }

  if (input.rule.escalationEnabled && linkedAlertId && !suppressedActive) {
    await createOrRefreshIncident({
      alertId: linkedAlertId,
      orgId: input.server.orgId,
      serverId: input.server.id,
      severity: input.rule.severity,
      responseSlaMinutes: input.rule.responseSlaMinutes,
      mitigationSlaMinutes: input.rule.mitigationSlaMinutes,
      actorUserId: input.actorUserId,
    });
  }

  return event;
}

async function resolveEvent(input: {
  event: ExistingEventRecord;
  actorUserId?: string | null | undefined;
}) {
  const now = new Date();

  const updated = await prisma.vpsAlertEvent.update({
    where: { id: input.event.id },
    data: {
      status: VpsAlertEventStatus.RESOLVED,
      resolvedAt: now,
      suppressedUntil: null,
    },
  });

  if (input.event.alertId) {
    const alert = await prisma.alert.findUnique({ where: { id: input.event.alertId } });
    if (alert && alert.status !== AlertStatus.RESOLVED) {
      await resolveAlert(input.event.alertId, input.actorUserId || "system").catch(async () => {
        await prisma.alert.update({
          where: { id: input.event.alertId as string },
          data: {
            status: AlertStatus.RESOLVED,
            resolvedAt: now,
            resolvedBy: input.actorUserId || "system",
          },
        });
      });
    }

    await resolveIncidentForAlert({
      alertId: input.event.alertId,
      orgId: input.event.orgId,
      serverId: input.event.serverId,
      actorUserId: input.actorUserId,
    });
  }

  await writeVpsAuditEvent({
    orgId: input.event.orgId,
    serverId: input.event.serverId,
    actorUserId: input.actorUserId || null,
    eventType: `ALERT_${input.event.rule.code}_RESOLVED`,
    severity: auditSeverityForAlert(input.event.severity),
    metadataJson: {
      alertEventId: input.event.id,
      alertId: input.event.alertId,
      ruleCode: input.event.rule.code,
      message: input.event.message,
    },
  });

  return updated;
}

export async function syncVpsAlertState(serverId: string, context?: { actorUserId?: string | null }) {
  const server = await prisma.vpsServer.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      orgId: true,
      name: true,
      providerSlug: true,
      providerHealthState: true,
      providerLastCheckedAt: true,
      providerError: true,
      driftDetectedAt: true,
      driftType: true,
      lastSyncedAt: true,
    },
  });

  if (!server) {
    return null;
  }

  const latestJob = await prisma.vpsActionJob.findFirst({
    where: { serverId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      action: true,
      status: true,
      errorJson: true,
      finishedAt: true,
      createdAt: true,
    },
  });

  const rules = await ensureVpsAlertRules(server.orgId);
  const existingEvents = await prisma.vpsAlertEvent.findMany({
    where: {
      serverId,
      ruleId: { in: rules.map((rule) => rule.id) },
    },
    include: {
      rule: true,
      alert: {
        select: {
          id: true,
          status: true,
          acknowledgedAt: true,
          resolvedAt: true,
        },
      },
    },
  });

  const existingByCode = new Map(existingEvents.map((event) => [event.rule.code, event]));
  const ruleByCode = new Map(rules.map((rule) => [rule.code, rule]));
  const snapshot: VpsAlertSnapshot = { server, latestJob };

  for (const builtInRule of BUILT_IN_VPS_ALERT_RULES) {
    const rule = ruleByCode.get(builtInRule.code);
    if (!rule) {
      continue;
    }

    const signal = builtInRule.evaluate(snapshot);
    const existing = existingByCode.get(builtInRule.code);

    if (!signal) {
      if (existing && existing.status !== VpsAlertEventStatus.RESOLVED) {
        await resolveEvent({
          event: existing,
          actorUserId: context?.actorUserId,
        });
      }
      continue;
    }

    await activateEvent({
      server,
      rule,
      signal,
      existing,
      actorUserId: context?.actorUserId,
    });
  }

  await synchronizeIncidentSla(server.orgId, server.id);

  return listVpsAlertEvents(server.id, server.orgId);
}

export async function listVpsAlertEvents(
  serverId: string,
  orgId: string,
  options?: { includeResolved?: boolean | undefined } | undefined,
) {
  const events = await prisma.vpsAlertEvent.findMany({
    where: {
      serverId,
      orgId,
      ...(options?.includeResolved ? {} : { status: { not: VpsAlertEventStatus.RESOLVED } }),
    },
    orderBy: [
      { lastDetectedAt: "desc" },
      { createdAt: "desc" },
    ],
    include: {
      rule: true,
      alert: {
        select: {
          id: true,
          status: true,
          acknowledgedAt: true,
          resolvedAt: true,
          vpsIncidents: {
            orderBy: { openedAt: "desc" },
            take: 1,
            select: {
              id: true,
              state: true,
              severity: true,
              openedAt: true,
              responseDeadlineAt: true,
              mitigationDeadlineAt: true,
              breachedAt: true,
            },
          },
        },
      },
    },
  });

  return events.map((event) => {
    const incident = event.alert?.vpsIncidents[0] || null;
    const metadata = getRuleMetadata(event.rule);

    return {
      id: event.id,
      alertId: event.alertId,
      code: event.rule.code,
      name: event.rule.name,
      status: event.status,
      severity: event.severity,
      title: event.title,
      message: event.message,
      source: event.source,
      firstDetectedAt: event.firstDetectedAt.toISOString(),
      lastDetectedAt: event.lastDetectedAt.toISOString(),
      acknowledgedAt: event.acknowledgedAt?.toISOString() || null,
      acknowledgedBy: event.acknowledgedBy || null,
      resolvedAt: event.resolvedAt?.toISOString() || null,
      suppressedUntil: event.suppressedUntil?.toISOString() || null,
      remediationAction: metadata.remediationAction || null,
      detail: event.detailJson,
      alertStatus: event.alert?.status || null,
      incident: incident
        ? {
            id: incident.id,
            state: incident.state,
            severity: incident.severity,
            openedAt: incident.openedAt.toISOString(),
            responseDeadlineAt: incident.responseDeadlineAt?.toISOString() || null,
            mitigationDeadlineAt: incident.mitigationDeadlineAt?.toISOString() || null,
            breachedAt: incident.breachedAt?.toISOString() || null,
          }
        : null,
    };
  });
}

export async function applyVpsAlertEventAction(input: {
  orgId: string;
  serverId: string;
  alertEventId: string;
  actorUserId: string;
  action: "acknowledge" | "resolve" | "suppress";
  suppressMinutes?: number | undefined;
}) {
  const event = await prisma.vpsAlertEvent.findFirst({
    where: {
      id: input.alertEventId,
      orgId: input.orgId,
      serverId: input.serverId,
    },
    include: {
      rule: true,
      alert: {
        select: {
          id: true,
          status: true,
          acknowledgedAt: true,
          resolvedAt: true,
        },
      },
    },
  });

  if (!event) {
    return null;
  }

  const now = new Date();

  switch (input.action) {
    case "acknowledge": {
      const updated = await prisma.vpsAlertEvent.update({
        where: { id: event.id },
        data: {
          status: VpsAlertEventStatus.ACKNOWLEDGED,
          acknowledgedAt: now,
          acknowledgedBy: input.actorUserId,
        },
      });

      if (event.alertId) {
        const alert = await prisma.alert.findUnique({ where: { id: event.alertId } });
        if (alert && alert.status === AlertStatus.ACTIVE) {
          await acknowledgeAlert(event.alertId, input.actorUserId);
        }

        await prisma.vpsIncident.updateMany({
          where: {
            alertId: event.alertId,
            state: { in: INCIDENT_OPEN_STATES },
          },
          data: { state: VpsIncidentState.ACKNOWLEDGED },
        });
      }

      await writeVpsAuditEvent({
        orgId: event.orgId,
        serverId: event.serverId,
        actorUserId: input.actorUserId,
        eventType: `ALERT_${event.rule.code}_ACKNOWLEDGED`,
        severity: auditSeverityForAlert(event.severity),
        metadataJson: { alertEventId: event.id, alertId: event.alertId },
      });

      return updated;
    }
    case "resolve": {
      return resolveEvent({
        event,
        actorUserId: input.actorUserId,
      });
    }
    case "suppress": {
      const suppressMinutes = Math.max(5, Math.min(input.suppressMinutes ?? event.rule.suppressionMinutes, 24 * 60));
      const suppressedUntil = new Date(now.getTime() + suppressMinutes * 60 * 1000);
      const updated = await prisma.vpsAlertEvent.update({
        where: { id: event.id },
        data: {
          status: VpsAlertEventStatus.SUPPRESSED,
          acknowledgedAt: now,
          acknowledgedBy: input.actorUserId,
          suppressedUntil,
        },
      });

      if (event.alertId) {
        await silenceAlert(event.alertId).catch(async () => {
          await prisma.alert.update({
            where: { id: event.alertId as string },
            data: { status: AlertStatus.SILENCED },
          });
        });

        await resolveIncidentForAlert({
          alertId: event.alertId,
          orgId: event.orgId,
          serverId: event.serverId,
          actorUserId: input.actorUserId,
        });
      }

      await writeVpsAuditEvent({
        orgId: event.orgId,
        serverId: event.serverId,
        actorUserId: input.actorUserId,
        eventType: `ALERT_${event.rule.code}_SUPPRESSED`,
        severity: auditSeverityForAlert(event.severity),
        metadataJson: { alertEventId: event.id, alertId: event.alertId, suppressedUntil: suppressedUntil.toISOString() },
      });

      return updated;
    }
    default:
      return null;
  }
}