import type {
  DriftClassification,
  DriftDomain,
  DriftEdge,
  DriftPod,
  DriftService,
  DriftSnapshot,
  DriftSnapshotState,
  DriftTenant
} from "./types";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asClassificationOrNull(value: unknown): DriftClassification | null {
  if (value === "internal" || value === "client") {
    return value;
  }
  return null;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeTenant(raw: unknown): DriftTenant | null {
  const item = asRecord(raw);
  const tenantId = asStringOrNull(item.tenantId);
  if (!tenantId) {
    return null;
  }

  return {
    tenantId,
    name: asStringOrNull(item.name),
    status: asStringOrNull(item.status),
    plan: asStringOrNull(item.plan),
    classification: asClassificationOrNull(item.classification),
    ownerOrg: asStringOrNull(item.ownerOrg),
    environment: asStringOrNull(item.environment)
  };
}

function normalizePod(raw: unknown): DriftPod | null {
  const item = asRecord(raw);
  const podId = asStringOrNull(item.podId);
  if (!podId) {
    return null;
  }
  return {
    podId,
    tenantId: asStringOrNull(item.tenantId),
    namespace: asStringOrNull(item.namespace),
    status: asStringOrNull(item.status),
    plan: asStringOrNull(item.plan),
    classification: asClassificationOrNull(item.classification),
    ownerOrg: asStringOrNull(item.ownerOrg),
    environment: asStringOrNull(item.environment)
  };
}

function normalizeDomain(raw: unknown): DriftDomain | null {
  const item = asRecord(raw);
  const domain = asStringOrNull(item.domain);
  if (!domain) {
    return null;
  }

  return {
    domain,
    tenantId: asStringOrNull(item.tenantId),
    podId: asStringOrNull(item.podId),
    type: asStringOrNull(item.type),
    status: asStringOrNull(item.status),
    classification: asClassificationOrNull(item.classification),
    ownerOrg: asStringOrNull(item.ownerOrg),
    environment: asStringOrNull(item.environment)
  };
}

function normalizeService(raw: unknown): DriftService | null {
  const item = asRecord(raw);
  const serviceId = asStringOrNull(item.serviceId);
  if (!serviceId) {
    return null;
  }
  return {
    serviceId,
    type: asStringOrNull(item.type),
    host: asStringOrNull(item.host),
    notes: asStringOrNull(item.notes),
    privateAccess: asStringOrNull(item.privateAccess),
    status: asStringOrNull(item.status),
    classification: asClassificationOrNull(item.classification),
    ownerOrg: asStringOrNull(item.ownerOrg),
    environment: asStringOrNull(item.environment)
  };
}

function normalizeEdge(raw: unknown): DriftEdge | null {
  const item = asRecord(raw);
  const from = asStringOrNull(item.from);
  const to = asStringOrNull(item.to);
  if (!from || !to) {
    return null;
  }
  return {
    from,
    to,
    type: asStringOrNull(item.type)
  };
}

export function normalizeInventoryState(raw: {
  tenants?: unknown;
  pods?: unknown;
  domains?: unknown;
  services?: unknown;
  edges?: unknown;
}): DriftSnapshotState {
  const tenants = asArray(raw.tenants)
    .map((item) => normalizeTenant(item))
    .filter((item): item is DriftTenant => Boolean(item))
    .sort((a, b) => compareStrings(a.tenantId, b.tenantId));

  const pods = asArray(raw.pods)
    .map((item) => normalizePod(item))
    .filter((item): item is DriftPod => Boolean(item))
    .sort((a, b) => compareStrings(a.podId, b.podId));

  const domains = asArray(raw.domains)
    .map((item) => normalizeDomain(item))
    .filter((item): item is DriftDomain => Boolean(item))
    .sort((a, b) => compareStrings(a.domain, b.domain));

  const services = asArray(raw.services)
    .map((item) => normalizeService(item))
    .filter((item): item is DriftService => Boolean(item))
    .sort((a, b) => compareStrings(a.serviceId, b.serviceId));

  const edges = asArray(raw.edges)
    .map((item) => normalizeEdge(item))
    .filter((item): item is DriftEdge => Boolean(item))
    .sort((a, b) => {
      const from = compareStrings(a.from, b.from);
      if (from !== 0) {
        return from;
      }
      const to = compareStrings(a.to, b.to);
      if (to !== 0) {
        return to;
      }
      return compareStrings(a.type ?? "", b.type ?? "");
    });

  return {
    tenants,
    pods,
    domains,
    services,
    topology: {
      edges
    }
  };
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stabilize(value), null, 2);
}

function stabilize(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stabilize(item));
  }
  if (typeof value !== "object") {
    return value;
  }

  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort(compareStrings);
  const output: Record<string, unknown> = {};
  for (const key of keys) {
    output[key] = stabilize(input[key]);
  }
  return output;
}

export function snapshotClassificationSummary(snapshot: Pick<DriftSnapshot, "state">): {
  internal: number;
  client: number;
} {
  let internal = 0;
  let client = 0;

  for (const tenant of snapshot.state.tenants) {
    if (tenant.classification === "internal") internal += 1;
    if (tenant.classification === "client") client += 1;
  }

  return {
    internal,
    client
  };
}
