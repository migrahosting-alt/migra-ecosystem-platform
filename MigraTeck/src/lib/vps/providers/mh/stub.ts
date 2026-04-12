import { Prisma, ServerPowerState, SupportTier, VpsBillingCycle, VpsStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ProviderActionResult, ProviderServerRef, ProviderServerSummary } from "@/lib/vps/providers";

type MhStubRecord = Awaited<ReturnType<typeof loadMhStubRecord>>;
type MhStubPersistedState = Partial<Record<keyof ProviderServerSummary, unknown>> & Record<string, unknown>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function asOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function asDateString(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function asStatus(value: unknown, fallback: VpsStatus) {
  return typeof value === "string" && value in VpsStatus ? (value as VpsStatus) : fallback;
}

function asPowerState(value: unknown, fallback: ServerPowerState) {
  return typeof value === "string" && value in ServerPowerState ? (value as ServerPowerState) : fallback;
}

function asBillingCycle(value: unknown, fallback: VpsBillingCycle) {
  return typeof value === "string" && value in VpsBillingCycle ? (value as VpsBillingCycle) : fallback;
}

function asSupportTier(value: unknown, fallback?: SupportTier | null) {
  if (typeof value === "string" && value in SupportTier) {
    return value as SupportTier;
  }

  return fallback ?? undefined;
}

function asJsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function stripNestedProviderState(value: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (!value) {
    return {};
  }

  const { lastKnownProviderStateJson: _ignored, ...rest } = value;
  return rest;
}

async function loadMhStubRecord(ref: ProviderServerRef) {
  const ors: Prisma.VpsServerWhereInput[] = [];

  if (ref.providerServerId) {
    ors.push({ providerServerId: ref.providerServerId });
  }

  if (ref.instanceId) {
    ors.push({ instanceId: ref.instanceId });
  }

  if (!ors.length) {
    return null;
  }

  return prisma.vpsServer.findFirst({
    where: {
      providerSlug: "mh",
      OR: ors,
    },
    include: {
      providerBindings: {
        where: { providerSlug: "mh" },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });
}

function stubBinding(record: MhStubRecord) {
  return record?.providerBindings[0] || null;
}

function persistedState(record: MhStubRecord) {
  const bindingState = stubBinding(record)?.lastKnownStateJson;
  if (isObject(bindingState)) {
    return bindingState as MhStubPersistedState;
  }

  return isObject(record?.lastKnownProviderStateJson) ? (record.lastKnownProviderStateJson as MhStubPersistedState) : null;
}

function isStubBinding(record: MhStubRecord) {
  const metadata = stubBinding(record)?.metadataJson;
  return isObject(metadata) && metadata.mode === "stub";
}

function buildMhStubState(ref: ProviderServerRef, record: MhStubRecord): ProviderServerSummary {
  const persisted: Record<string, unknown> = stripNestedProviderState(persistedState(record));
  const providerServerId = record?.providerServerId || stubBinding(record)?.providerServerId || ref.providerServerId || ref.instanceId;
  const region = record?.region || "us-east";

  return {
    providerSlug: "mh",
    providerServerId,
    ...(record?.providerRegionId || stubBinding(record)?.providerRegionId ? { providerRegionId: record?.providerRegionId || stubBinding(record)?.providerRegionId || undefined } : {}),
    ...(record?.providerPlanId || stubBinding(record)?.providerPlanId ? { providerPlanId: record?.providerPlanId || stubBinding(record)?.providerPlanId || undefined } : {}),
    name: asString(persisted?.name, record?.name || ref.name),
    hostname: asString(persisted?.hostname, record?.hostname || `${ref.instanceId}.migrateck.local`),
    instanceId: asString(persisted?.instanceId, record?.instanceId || ref.instanceId),
    status: asStatus(persisted?.status, record?.status || VpsStatus.RUNNING),
    powerState: asPowerState(persisted?.powerState, record?.powerState || ServerPowerState.ON),
    publicIpv4: asString(persisted?.publicIpv4, record?.publicIpv4 || ref.publicIpv4),
    ...(asOptionalString(persisted?.privateIpv4) || record?.privateIpv4 ? { privateIpv4: asOptionalString(persisted?.privateIpv4) || record?.privateIpv4 || undefined } : {}),
    ...(asOptionalString(persisted?.gatewayIpv4) || record?.gatewayIpv4 ? { gatewayIpv4: asOptionalString(persisted?.gatewayIpv4) || record?.gatewayIpv4 || undefined } : {}),
    ...(asOptionalString(persisted?.privateNetwork) || record?.privateNetwork ? { privateNetwork: asOptionalString(persisted?.privateNetwork) || record?.privateNetwork || undefined } : {}),
    sshPort: asNumber(persisted?.sshPort, record?.sshPort || 22),
    defaultUsername: asString(persisted?.defaultUsername, record?.defaultUsername || "root"),
    region: asString(persisted?.region, region),
    ...(asOptionalString(persisted?.datacenterLabel) || record?.datacenterLabel ? { datacenterLabel: asOptionalString(persisted?.datacenterLabel) || record?.datacenterLabel || undefined } : {}),
    imageSlug: asString(persisted?.imageSlug, record?.imageSlug || "ubuntu-24.04"),
    osName: asString(persisted?.osName, record?.osName || "Ubuntu 24.04"),
    ...(asOptionalString(persisted?.imageVersion) || record?.imageVersion ? { imageVersion: asOptionalString(persisted?.imageVersion) || record?.imageVersion || undefined } : {}),
    ...(asOptionalString(persisted?.virtualizationType) || record?.virtualizationType ? { virtualizationType: asOptionalString(persisted?.virtualizationType) || record?.virtualizationType || undefined } : {}),
    planSlug: asString(persisted?.planSlug, record?.planSlug || "vps-4x8"),
    ...(asOptionalString(persisted?.planName) || record?.planName ? { planName: asOptionalString(persisted?.planName) || record?.planName || undefined } : {}),
    vcpu: asNumber(persisted?.vcpu, record?.vcpu || 4),
    memoryMb: asNumber(persisted?.memoryMb, record?.memoryMb || 8192),
    diskGb: asNumber(persisted?.diskGb, record?.diskGb || 160),
    bandwidthTb: asNumber(persisted?.bandwidthTb, record?.bandwidthTb || 5),
    bandwidthUsedGb: asNumber(persisted?.bandwidthUsedGb, record?.bandwidthUsedGb || 0),
    ...(asOptionalString(persisted?.reverseDns) || record?.reverseDns ? { reverseDns: asOptionalString(persisted?.reverseDns) || record?.reverseDns || undefined } : {}),
    ...(asOptionalString(persisted?.reverseDnsStatus) || record?.reverseDnsStatus ? { reverseDnsStatus: asOptionalString(persisted?.reverseDnsStatus) || record?.reverseDnsStatus || undefined } : {}),
    firewallEnabled: asBoolean(persisted?.firewallEnabled, record?.firewallEnabled ?? true),
    ...(asOptionalString(persisted?.firewallProfileName) || record?.firewallProfileName ? { firewallProfileName: asOptionalString(persisted?.firewallProfileName) || record?.firewallProfileName || undefined } : {}),
    monitoringEnabled: asBoolean(persisted?.monitoringEnabled, record?.monitoringEnabled ?? true),
    ...(asOptionalString(persisted?.monitoringStatus) || record?.monitoringStatus ? { monitoringStatus: asOptionalString(persisted?.monitoringStatus) || record?.monitoringStatus || undefined } : {}),
    backupsEnabled: asBoolean(persisted?.backupsEnabled, record?.backupsEnabled ?? true),
    ...(asOptionalString(persisted?.backupRegion) || record?.backupRegion ? { backupRegion: asOptionalString(persisted?.backupRegion) || record?.backupRegion || undefined } : {}),
    snapshotCount: asNumber(persisted?.snapshotCount, record?.snapshotCountCached || 0),
    ...(asDateString(persisted?.nextInvoiceAt) || record?.nextInvoiceAt ? { nextInvoiceAt: asDateString(persisted?.nextInvoiceAt) || record?.nextInvoiceAt?.toISOString() } : {}),
    ...(asDateString(persisted?.renewalAt) || record?.renewalAt ? { renewalAt: asDateString(persisted?.renewalAt) || record?.renewalAt?.toISOString() } : {}),
    billingCycle: asBillingCycle(persisted?.billingCycle, record?.billingCycle || VpsBillingCycle.MONTHLY),
    monthlyPriceCents: asNumber(persisted?.monthlyPriceCents, record?.monthlyPriceCents || 0),
    billingCurrency: asString(persisted?.billingCurrency, record?.billingCurrency || "USD"),
    ...(typeof persisted?.supportTier === "string" || record?.supportTier
      ? { supportTier: asSupportTier(persisted?.supportTier, record?.supportTier) }
      : {}),
    ...(asOptionalString(persisted?.supportTicketUrl) || record?.supportTicketUrl ? { supportTicketUrl: asOptionalString(persisted?.supportTicketUrl) || record?.supportTicketUrl || undefined } : {}),
    ...(asOptionalString(persisted?.supportDocsUrl) || record?.supportDocsUrl ? { supportDocsUrl: asOptionalString(persisted?.supportDocsUrl) || record?.supportDocsUrl || undefined } : {}),
    rescueEnabled: asBoolean(persisted?.rescueEnabled, record?.rescueEnabled ?? false),
  };
}

async function persistMhStubState(ref: ProviderServerRef, nextState: ProviderServerSummary, action: string) {
  const record = await loadMhStubRecord(ref);
  if (!record) {
    return;
  }

  const binding = stubBinding(record);
  const payload = {
    ...stripNestedProviderState(nextState as unknown as Record<string, unknown>),
    source: "mh_stub",
    lastAction: action,
    lastActionAt: new Date().toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    if (binding) {
      const metadata = isObject(binding.metadataJson) ? binding.metadataJson : {};
      await tx.vpsProviderBinding.update({
        where: { id: binding.id },
        data: {
          metadataJson: asJsonValue({
            ...metadata,
            mode: "stub",
            source: "control_loop",
            lastAction: action,
          }),
          lastKnownStateJson: asJsonValue(payload),
          lastSyncedAt: new Date(),
        },
      });
    }

    await tx.vpsServer.update({
      where: { id: record.id },
      data: {
        lastKnownProviderStateJson: asJsonValue(payload),
      },
    });
  });
}

function actionResult(message: string, state: ProviderServerSummary): ProviderActionResult {
  const serializedState = {
    ...stripNestedProviderState(state as unknown as Record<string, unknown>),
    source: "mh_stub",
  };

  return {
    accepted: true,
    status: "SUCCEEDED",
    message,
    serverPatch: {
      status: state.status,
      powerState: state.powerState,
      publicIpv4: state.publicIpv4,
      ...(typeof state.rescueEnabled === "boolean" ? { rescueEnabled: state.rescueEnabled } : {}),
      lastKnownProviderStateJson: serializedState,
    },
    raw: serializedState,
  };
}

export async function shouldUseMhStub(ref: ProviderServerRef) {
  const record = await loadMhStubRecord(ref);
  return isStubBinding(record);
}

export async function listMhStubServers() {
  const rows = await prisma.vpsServer.findMany({
    where: { providerSlug: "mh" },
    include: {
      providerBindings: {
        where: { providerSlug: "mh" },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return rows
    .filter((row) => isStubBinding(row))
    .map((row) => buildMhStubState({
      providerSlug: "mh",
      providerServerId: row.providerServerId,
      instanceId: row.instanceId,
      publicIpv4: row.publicIpv4,
      name: row.name,
    }, row));
}

export async function getMhStubServer(ref: ProviderServerRef) {
  return buildMhStubState(ref, await loadMhStubRecord(ref));
}

export async function mhStubPowerOn(ref: ProviderServerRef) {
  const nextState = {
    ...(await getMhStubServer(ref)),
    status: VpsStatus.RUNNING,
    powerState: ServerPowerState.ON,
  } satisfies ProviderServerSummary;

  await persistMhStubState(ref, nextState, "POWER_ON");
  return actionResult("Power on complete", nextState);
}

export async function mhStubPowerOff(ref: ProviderServerRef) {
  const nextState = {
    ...(await getMhStubServer(ref)),
    status: VpsStatus.STOPPED,
    powerState: ServerPowerState.OFF,
  } satisfies ProviderServerSummary;

  await persistMhStubState(ref, nextState, "POWER_OFF");
  return actionResult("Power off complete", nextState);
}

export async function mhStubReboot(ref: ProviderServerRef) {
  const nextState = {
    ...(await getMhStubServer(ref)),
    status: VpsStatus.RUNNING,
    powerState: ServerPowerState.ON,
  } satisfies ProviderServerSummary;

  await persistMhStubState(ref, nextState, "REBOOT");
  return actionResult("Reboot complete", nextState);
}

export async function mhStubEnableRescue(ref: ProviderServerRef) {
  const nextState = {
    ...(await getMhStubServer(ref)),
    status: VpsStatus.RESCUED,
    powerState: ServerPowerState.ON,
    rescueEnabled: true,
  } satisfies ProviderServerSummary;

  await persistMhStubState(ref, nextState, "ENABLE_RESCUE");
  return actionResult("Rescue enabled", nextState);
}

export async function mhStubDisableRescue(ref: ProviderServerRef) {
  const nextState = {
    ...(await getMhStubServer(ref)),
    status: VpsStatus.RUNNING,
    powerState: ServerPowerState.ON,
    rescueEnabled: false,
  } satisfies ProviderServerSummary;

  await persistMhStubState(ref, nextState, "DISABLE_RESCUE");
  return actionResult("Rescue disabled", nextState);
}