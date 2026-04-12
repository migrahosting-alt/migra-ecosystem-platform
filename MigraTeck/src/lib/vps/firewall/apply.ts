import { Prisma, VpsActionStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getControlPlaneRestriction } from "@/lib/vps/access";
import { denyServerAccess, requireRole } from "@/lib/vps/authz";
import { getVpsProviderAdapter } from "@/lib/vps/providers";
import { diffFirewallState } from "@/lib/vps/firewall/diff";
import { canonicalRuleToRuleRecord, canonicalStateFromProfile, sanitizeCanonicalState } from "@/lib/vps/firewall/normalize";
import { assessFirewallRisk } from "@/lib/vps/firewall/safety";
import { classifyProviderHealth, healthyProviderState } from "@/lib/vps/server-state";
import { firewallTemplates } from "@/lib/vps/firewall/templates";
import type { CanonicalFirewallState, FirewallApplyPreview } from "@/lib/vps/firewall/types";
import { validateFirewallState } from "@/lib/vps/firewall/validation";
import { getActiveFirewallProfile, getPrimaryProviderBinding } from "@/lib/vps/queries";

function jsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

async function loadFirewallServer(serverId: string, orgId: string) {
  const server = await prisma.vpsServer.findFirst({
    where: { id: serverId, orgId },
    include: {
      firewallProfiles: {
        include: {
          rules: {
            orderBy: { priority: "asc" },
          },
        },
        orderBy: [
          { isActive: "desc" },
          { updatedAt: "desc" },
        ],
      },
      providerBindings: {
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!server) {
    throw Object.assign(new Error("VPS server not found."), { httpStatus: 404 });
  }

  return server;
}

function resolveProviderRef(server: Awaited<ReturnType<typeof loadFirewallServer>>) {
  const binding = getPrimaryProviderBinding(server);
  return {
    providerSlug: binding?.providerSlug || server.providerSlug,
    providerServerId: binding?.providerServerId || server.providerServerId,
    instanceId: server.instanceId,
    publicIpv4: server.publicIpv4,
    name: server.name,
  };
}

function currentProfiles(server: Awaited<ReturnType<typeof loadFirewallServer>>) {
  const draft = server.firewallProfiles.find((profile) => profile.status === "DRAFT") || null;
  const active = getActiveFirewallProfile(server.firewallProfiles);
  return { draft, active };
}

async function upsertDraftProfile(serverId: string, state: CanonicalFirewallState) {
  const existingDraft = await prisma.vpsFirewallProfile.findFirst({
    where: { serverId, status: "DRAFT" },
    include: { rules: true },
  });

  const profileData = {
    name: state.profileName || "Managed Firewall",
    status: "DRAFT" as const,
    defaultInboundAction: state.inboundDefaultAction,
    defaultOutboundAction: state.outboundDefaultAction,
    antiLockoutEnabled: state.antiLockoutEnabled,
    rollbackWindowSec: state.rollbackWindowSec,
    protectionMode: "control-plane-managed",
    providerVersion: state.providerVersion || null,
    lastError: state.lastError || null,
    isActive: false,
  };

  const profile = existingDraft
    ? await prisma.vpsFirewallProfile.update({
      where: { id: existingDraft.id },
      data: profileData,
    })
    : await prisma.vpsFirewallProfile.create({
      data: {
        serverId,
        ...profileData,
      },
    });

  await prisma.vpsFirewallRule.deleteMany({ where: { profileId: profile.id } });
  if (state.rules.length) {
    await prisma.vpsFirewallRule.createMany({
      data: state.rules.map((rule) => ({
        profileId: profile.id,
        ...canonicalRuleToRuleRecord(rule),
      })),
    });
  }

  return prisma.vpsFirewallProfile.findUniqueOrThrow({
    where: { id: profile.id },
    include: {
      rules: {
        orderBy: { priority: "asc" },
      },
    },
  });
}

export async function saveFirewallDraft(input: {
  serverId: string;
  orgId: string;
  state: CanonicalFirewallState;
}) {
  await loadFirewallServer(input.serverId, input.orgId);
  const state = sanitizeCanonicalState(input.state);
  const validation = validateFirewallState(state, 22);
  const draft = await upsertDraftProfile(input.serverId, state);

  return {
    state: canonicalStateFromProfile({
      server: { firewallEnabled: true },
      profile: draft,
    }),
    validation,
    templates: firewallTemplates,
  };
}

export async function previewFirewallProfile(input: {
  serverId: string;
  orgId: string;
  state?: CanonicalFirewallState | undefined;
}) {
  const server = await loadFirewallServer(input.serverId, input.orgId);
  const { draft, active } = currentProfiles(server);

  const nextState = sanitizeCanonicalState(
    input.state
      || canonicalStateFromProfile({ server, profile: draft || active }),
  );

  const currentState = canonicalStateFromProfile({ server, profile: active });
  const validation = validateFirewallState(nextState, server.sshPort);
  const diff = diffFirewallState(currentState, nextState);

  return {
    diff,
    validation,
    currentState,
    nextState,
  };
}

async function createFirewallAudit(input: {
  orgId: string;
  serverId: string;
  actorUserId: string;
  relatedJobId: string;
  eventType: string;
  severity?: "INFO" | "WARNING" | "ERROR" | "CRITICAL" | undefined;
  metadata: Record<string, unknown>;
}) {
  await prisma.vpsAuditEvent.create({
    data: {
      orgId: input.orgId,
      serverId: input.serverId,
      actorUserId: input.actorUserId,
      relatedJobId: input.relatedJobId,
      eventType: input.eventType,
      severity: input.severity || "INFO",
      payloadJson: jsonValue(input.metadata),
    },
  });
}

function toActionStatus(status: "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED") {
  if (status === "RUNNING") return VpsActionStatus.RUNNING;
  if (status === "PENDING" || status === "QUEUED") return VpsActionStatus.QUEUED;
  if (status === "FAILED") return VpsActionStatus.FAILED;
  return VpsActionStatus.SUCCEEDED;
}

async function applyStateToProfile(profileId: string, state: CanonicalFirewallState, input: {
  status: "ACTIVE" | "APPLYING" | "FAILED";
  jobId: string;
  lastError?: string | null | undefined;
  rollbackPendingUntil?: Date | null | undefined;
}) {
  await prisma.$transaction(async (tx) => {
    await tx.vpsFirewallProfile.updateMany({
      where: { serverId: (await tx.vpsFirewallProfile.findUniqueOrThrow({ where: { id: profileId }, select: { serverId: true } })).serverId },
      data: { isActive: false },
    });

    await tx.vpsFirewallProfile.update({
      where: { id: profileId },
      data: {
        name: state.profileName || "Managed Firewall",
        status: input.status,
        defaultInboundAction: state.inboundDefaultAction,
        defaultOutboundAction: state.outboundDefaultAction,
        antiLockoutEnabled: state.antiLockoutEnabled,
        rollbackWindowSec: state.rollbackWindowSec,
        lastApplyJobId: input.jobId,
        lastAppliedAt: input.status === "FAILED" ? undefined : new Date(),
        lastError: input.lastError || null,
        isActive: input.status !== "FAILED",
        rollbackPendingUntil: input.rollbackPendingUntil || null,
        confirmedAt: null,
        lastKnownGoodJson: input.status === "FAILED" ? undefined : jsonValue(state),
      },
    });

    await tx.vpsFirewallRule.deleteMany({ where: { profileId } });
    if (state.rules.length) {
      await tx.vpsFirewallRule.createMany({
        data: state.rules.map((rule) => ({ profileId, ...canonicalRuleToRuleRecord(rule) })),
      });
    }
  });
}

export async function applyFirewallProfile(input: {
  serverId: string;
  orgId: string;
  actorUserId: string;
  actorRole: "OWNER" | "ADMIN" | "BILLING" | "MEMBER" | "READONLY";
  sourceIp?: string | undefined;
  state?: CanonicalFirewallState | undefined;
}) {
  const server = await loadFirewallServer(input.serverId, input.orgId);
  const resolvedRole = await requireRole({
    actor: {
      userId: input.actorUserId,
      orgId: input.orgId,
      role: input.actorRole,
      sourceIp: input.sourceIp,
    },
    serverId: server.id,
    allowed: ["OWNER", "ADMIN"],
    action: "UPDATE_FIREWALL",
    sourceIp: input.sourceIp,
  });
  const restriction = getControlPlaneRestriction({
    providerHealthState: server.providerHealthState,
    action: "UPDATE_FIREWALL",
  });

  if (restriction.blocked) {
    await denyServerAccess({
      actor: {
        userId: input.actorUserId,
        orgId: input.orgId,
      },
      serverId: server.id,
      sourceIp: input.sourceIp,
      action: "UPDATE_FIREWALL",
      requiredRole: "PROVIDER_HEALTHY",
      actualRole: resolvedRole.role,
      reason: restriction.reason,
    });
    throw Object.assign(new Error(restriction.reason), { httpStatus: 403 });
  }
  const { draft, active } = currentProfiles(server);
  const state = sanitizeCanonicalState(input.state || canonicalStateFromProfile({ server, profile: draft || active }));
  const validation = validateFirewallState(state, server.sshPort);

  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors.join(" | ")), { httpStatus: 400 });
  }

  const preview: FirewallApplyPreview = diffFirewallState(canonicalStateFromProfile({ server, profile: active }), state);
  const safety = assessFirewallRisk(state);
  const provider = getVpsProviderAdapter(resolveProviderRef(server).providerSlug);
  if (!provider.capabilities.firewallWrite) {
    throw Object.assign(new Error("Selected provider does not support firewall writes."), { httpStatus: 409 });
  }

  const persistedDraft = draft || await upsertDraftProfile(server.id, state);

  const job = await prisma.vpsActionJob.create({
    data: {
      serverId: server.id,
      orgId: server.orgId,
      action: "UPDATE_FIREWALL",
      status: VpsActionStatus.QUEUED,
      requestedByUserId: input.actorUserId,
      requestJson: jsonValue(state),
      startedAt: new Date(),
    },
  });

  await createFirewallAudit({
    orgId: server.orgId,
    serverId: server.id,
    actorUserId: input.actorUserId,
    relatedJobId: job.id,
    eventType: "FIREWALL_UPDATE_REQUESTED",
    severity: "WARNING",
    metadata: {
      antiLockoutEnabled: state.antiLockoutEnabled,
      rollbackWindowSec: state.rollbackWindowSec,
      riskLevel: preview.riskLevel,
      warnings: [...validation.warnings, ...preview.warnings, ...safety.warnings],
    },
  });

  let result;

  try {
    result = await provider.updateFirewall(resolveProviderRef(server), { firewall: state });
    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: healthyProviderState().providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: null,
      },
    });
  } catch (error) {
    const health = classifyProviderHealth(error);
    await prisma.vpsServer.update({
      where: { id: server.id },
      data: {
        providerHealthState: health.providerHealthState,
        providerLastCheckedAt: new Date(),
        providerError: health.providerError,
      },
    });
    throw error;
  }
  const nextStatus = toActionStatus(result.status);
  const rollbackPendingUntil = preview.riskLevel === "HIGH" && state.antiLockoutEnabled
    ? new Date(Date.now() + state.rollbackWindowSec * 1000)
    : null;

  await prisma.vpsActionJob.update({
    where: { id: job.id },
    data: {
      status: nextStatus,
      providerRequestId: result.providerRequestId || null,
      providerTaskId: result.providerTaskId || result.providerRequestId || null,
      resultJson: jsonValue(result.raw || result),
      errorJson: nextStatus === VpsActionStatus.FAILED ? jsonValue({ message: result.message || "provider_firewall_update_failed" }) : Prisma.JsonNull,
      finishedAt: nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? null : new Date(),
      nextPollAt: nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? new Date(Date.now() + 15000) : null,
    },
  });

  await applyStateToProfile(persistedDraft.id, state, {
    status: nextStatus === VpsActionStatus.FAILED ? "FAILED" : nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? "APPLYING" : "ACTIVE",
    jobId: job.id,
    lastError: nextStatus === VpsActionStatus.FAILED ? result.message || "Provider update failed." : null,
    rollbackPendingUntil,
  });

  await prisma.vpsServer.update({
    where: { id: server.id },
    data: {
      firewallEnabled: nextStatus !== VpsActionStatus.FAILED,
      firewallProfileName: state.profileName || persistedDraft.name,
      lastSyncedAt: new Date(),
    },
  });

  return {
    jobId: job.id,
    result,
    preview,
    rollbackPendingUntil: rollbackPendingUntil?.toISOString() || null,
  };
}

export async function rollbackFirewallProfile(input: {
  serverId: string;
  orgId: string;
  actorUserId: string;
}) {
  const server = await loadFirewallServer(input.serverId, input.orgId);
  const { active } = currentProfiles(server);
  if (!active?.lastKnownGoodJson || typeof active.lastKnownGoodJson !== "object") {
    throw Object.assign(new Error("No last known good firewall profile is available for rollback."), { httpStatus: 409 });
  }

  const state = sanitizeCanonicalState(active.lastKnownGoodJson as CanonicalFirewallState);
  const provider = getVpsProviderAdapter(resolveProviderRef(server).providerSlug);
  if (!provider.capabilities.firewallWrite) {
    throw Object.assign(new Error("Selected provider does not support firewall rollback."), { httpStatus: 409 });
  }

  const job = await prisma.vpsActionJob.create({
    data: {
      serverId: server.id,
      orgId: server.orgId,
      action: "ROLLBACK_FIREWALL",
      status: VpsActionStatus.QUEUED,
      requestedByUserId: input.actorUserId,
      requestJson: jsonValue(state),
      startedAt: new Date(),
    },
  });

  await createFirewallAudit({
    orgId: server.orgId,
    serverId: server.id,
    actorUserId: input.actorUserId,
    relatedJobId: job.id,
    eventType: "FIREWALL_ROLLBACK_TRIGGERED",
    severity: "WARNING",
    metadata: { profileId: active.id },
  });

  const result = await provider.updateFirewall(resolveProviderRef(server), { firewall: state });
  const nextStatus = toActionStatus(result.status);
  await prisma.vpsActionJob.update({
    where: { id: job.id },
    data: {
      status: nextStatus,
      providerRequestId: result.providerRequestId || null,
      providerTaskId: result.providerTaskId || result.providerRequestId || null,
      resultJson: jsonValue(result.raw || result),
      errorJson: nextStatus === VpsActionStatus.FAILED ? jsonValue({ message: result.message || "provider_firewall_rollback_failed" }) : Prisma.JsonNull,
      finishedAt: nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? null : new Date(),
    },
  });

  await applyStateToProfile(active.id, state, {
    status: nextStatus === VpsActionStatus.FAILED ? "FAILED" : nextStatus === VpsActionStatus.QUEUED || nextStatus === VpsActionStatus.RUNNING ? "APPLYING" : "ACTIVE",
    jobId: job.id,
    lastError: nextStatus === VpsActionStatus.FAILED ? result.message || "Provider rollback failed." : null,
    rollbackPendingUntil: null,
  });

  return { jobId: job.id, result };
}

export async function confirmFirewallProfile(input: {
  serverId: string;
  orgId: string;
  actorUserId: string;
}) {
  const server = await loadFirewallServer(input.serverId, input.orgId);
  const { active } = currentProfiles(server);
  if (!active) {
    throw Object.assign(new Error("No active firewall profile found."), { httpStatus: 404 });
  }

  await prisma.vpsFirewallProfile.update({
    where: { id: active.id },
    data: {
      rollbackPendingUntil: null,
      confirmedAt: new Date(),
    },
  });

  await createFirewallAudit({
    orgId: server.orgId,
    serverId: server.id,
    actorUserId: input.actorUserId,
    relatedJobId: active.lastApplyJobId || "",
    eventType: "FIREWALL_UPDATED",
    metadata: { confirmed: true, profileId: active.id },
  });

  return { confirmed: true };
}

export async function syncFirewallStateFromProvider(input: {
  serverId: string;
  orgId: string;
}) {
  const server = await loadFirewallServer(input.serverId, input.orgId);
  const provider = getVpsProviderAdapter(resolveProviderRef(server).providerSlug);
  if (!provider.capabilities.firewallRead) {
    const { active } = currentProfiles(server);
    return canonicalStateFromProfile({ server, profile: active });
  }

  const providerState = sanitizeCanonicalState(await provider.getFirewall(resolveProviderRef(server)));
  const { active } = currentProfiles(server);
  if (!active) {
    const created = await upsertDraftProfile(server.id, {
      ...providerState,
      profileName: providerState.profileName || "Imported Provider Firewall",
      status: "ACTIVE",
      isEnabled: server.firewallEnabled,
      isActive: true,
    });
    await prisma.vpsFirewallProfile.update({
      where: { id: created.id },
      data: { status: "ACTIVE", isActive: true },
    });
    return canonicalStateFromProfile({ server, profile: created });
  }

  const localState = canonicalStateFromProfile({ server, profile: active });
  const drift = diffFirewallState(localState, providerState);
  if (drift.added.length || drift.removed.length || drift.changed.length) {
    await prisma.vpsFirewallProfile.update({
      where: { id: active.id },
      data: {
        driftDetectedAt: new Date(),
        driftSummaryJson: jsonValue({
          added: drift.added.length,
          removed: drift.removed.length,
          changed: drift.changed.length,
          warnings: drift.warnings,
        }),
      },
    });
  } else {
    await prisma.vpsFirewallProfile.update({
      where: { id: active.id },
      data: {
        driftDetectedAt: null,
        driftSummaryJson: Prisma.JsonNull,
      },
    });
  }

  const refreshed = await prisma.vpsFirewallProfile.findUniqueOrThrow({
    where: { id: active.id },
    include: {
      rules: {
        orderBy: { priority: "asc" },
      },
    },
  });

  return canonicalStateFromProfile({ server, profile: refreshed });
}
