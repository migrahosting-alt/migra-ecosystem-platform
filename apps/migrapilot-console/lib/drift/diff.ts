import type {
  DriftChangedItem,
  DriftClassification,
  DriftDiffResult,
  DriftDomain,
  DriftEdge,
  DriftPod,
  DriftService,
  DriftSnapshot,
  DriftTenant
} from "./types";

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function changedKeys<T extends object>(before: T, after: T): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  const beforeRecord = before as Record<string, unknown>;
  const afterRecord = after as Record<string, unknown>;
  for (const key of Array.from(keys).sort()) {
    if (stableJson(beforeRecord[key]) !== stableJson(afterRecord[key])) {
      changed.push(key);
    }
  }
  return changed;
}

function diffByKey<T extends object>(
  beforeItems: T[],
  afterItems: T[],
  getKey: (item: T) => string
): {
  added: T[];
  removed: T[];
  changed: Array<DriftChangedItem<T>>;
} {
  const beforeMap = new Map<string, T>(beforeItems.map((item) => [getKey(item), item]));
  const afterMap = new Map<string, T>(afterItems.map((item) => [getKey(item), item]));

  const added: T[] = [];
  const removed: T[] = [];
  const changed: Array<DriftChangedItem<T>> = [];

  for (const [key, item] of afterMap.entries()) {
    if (!beforeMap.has(key)) {
      added.push(item);
    }
  }

  for (const [key, item] of beforeMap.entries()) {
    const next = afterMap.get(key);
    if (!next) {
      removed.push(item);
      continue;
    }
    const keys = changedKeys(item, next);
    if (keys.length > 0) {
      changed.push({
        id: key,
        before: item,
        after: next,
        changedKeys: keys
      });
    }
  }

  return {
    added,
    removed,
    changed
  };
}

function diffEdges(beforeEdges: DriftEdge[], afterEdges: DriftEdge[]): { added: DriftEdge[]; removed: DriftEdge[] } {
  const toKey = (edge: DriftEdge) => `${edge.from}|${edge.to}|${edge.type ?? ""}`;
  const beforeMap = new Map(beforeEdges.map((edge) => [toKey(edge), edge]));
  const afterMap = new Map(afterEdges.map((edge) => [toKey(edge), edge]));

  const added: DriftEdge[] = [];
  const removed: DriftEdge[] = [];

  for (const [key, edge] of afterMap.entries()) {
    if (!beforeMap.has(key)) {
      added.push(edge);
    }
  }

  for (const [key, edge] of beforeMap.entries()) {
    if (!afterMap.has(key)) {
      removed.push(edge);
    }
  }

  return { added, removed };
}

function pushTenant(set: Set<string>, value: string | null | undefined): void {
  if (typeof value === "string" && value.trim()) {
    set.add(value.trim());
  }
}

function countClassification(map: { internal: number; client: number }, value: DriftClassification | null | undefined): void {
  if (value === "internal") map.internal += 1;
  if (value === "client") map.client += 1;
}

function isClassificationFlip(before: DriftClassification | null, after: DriftClassification | null): boolean {
  if (!before || !after) {
    return false;
  }
  return (
    (before === "internal" && after === "client") ||
    (before === "client" && after === "internal")
  );
}

export function diffSnapshots(previous: DriftSnapshot, next: DriftSnapshot): DriftDiffResult {
  const tenantsDiff = diffByKey(previous.state.tenants, next.state.tenants, (item) => item.tenantId);
  const podsDiff = diffByKey(previous.state.pods, next.state.pods, (item) => item.podId);
  const domainsDiff = diffByKey(previous.state.domains, next.state.domains, (item) => item.domain);
  const servicesDiff = diffByKey(previous.state.services, next.state.services, (item) => item.serviceId);
  const edgesDiff = diffEdges(previous.state.topology.edges, next.state.topology.edges);

  const affectedTenants = new Set<string>();
  const affectedClassification = { internal: 0, client: 0 };

  for (const item of tenantsDiff.added) {
    pushTenant(affectedTenants, item.tenantId);
    countClassification(affectedClassification, item.classification);
  }
  for (const item of tenantsDiff.removed) {
    pushTenant(affectedTenants, item.tenantId);
    countClassification(affectedClassification, item.classification);
  }
  for (const item of tenantsDiff.changed) {
    pushTenant(affectedTenants, item.before.tenantId);
    pushTenant(affectedTenants, item.after.tenantId);
    countClassification(affectedClassification, item.before.classification);
    countClassification(affectedClassification, item.after.classification);
  }

  for (const item of podsDiff.added) {
    pushTenant(affectedTenants, item.tenantId);
    countClassification(affectedClassification, item.classification);
  }
  for (const item of podsDiff.removed) {
    pushTenant(affectedTenants, item.tenantId);
    countClassification(affectedClassification, item.classification);
  }
  for (const item of podsDiff.changed) {
    pushTenant(affectedTenants, item.before.tenantId);
    pushTenant(affectedTenants, item.after.tenantId);
    countClassification(affectedClassification, item.before.classification);
    countClassification(affectedClassification, item.after.classification);
  }

  for (const item of domainsDiff.added) {
    pushTenant(affectedTenants, item.tenantId);
    countClassification(affectedClassification, item.classification);
  }
  for (const item of domainsDiff.removed) {
    pushTenant(affectedTenants, item.tenantId);
    countClassification(affectedClassification, item.classification);
  }
  for (const item of domainsDiff.changed) {
    pushTenant(affectedTenants, item.before.tenantId);
    pushTenant(affectedTenants, item.after.tenantId);
    countClassification(affectedClassification, item.before.classification);
    countClassification(affectedClassification, item.after.classification);
  }

  for (const item of servicesDiff.added) {
    countClassification(affectedClassification, item.classification);
  }
  for (const item of servicesDiff.removed) {
    countClassification(affectedClassification, item.classification);
  }
  for (const item of servicesDiff.changed) {
    countClassification(affectedClassification, item.before.classification);
    countClassification(affectedClassification, item.after.classification);
  }

  const previousTenantById = new Map<string, DriftTenant>(
    previous.state.tenants.map((tenant) => [tenant.tenantId, tenant])
  );

  const criticalChecks: boolean[] = [];
  criticalChecks.push(
    servicesDiff.removed.some((service) => service.classification === "internal")
  );
  criticalChecks.push(
    podsDiff.removed.some((pod) => {
      if (pod.classification !== "client" || !pod.tenantId) {
        return false;
      }
      const tenant = previousTenantById.get(pod.tenantId);
      return tenant?.status === "active";
    })
  );
  criticalChecks.push(
    domainsDiff.changed.some(
      (entry) => entry.changedKeys.includes("tenantId") && entry.before.tenantId !== entry.after.tenantId
    )
  );
  criticalChecks.push(
    tenantsDiff.changed.some((entry) => isClassificationFlip(entry.before.classification, entry.after.classification)) ||
      podsDiff.changed.some((entry) => isClassificationFlip(entry.before.classification, entry.after.classification)) ||
      domainsDiff.changed.some((entry) => isClassificationFlip(entry.before.classification, entry.after.classification)) ||
      servicesDiff.changed.some((entry) => isClassificationFlip(entry.before.classification, entry.after.classification))
  );

  const warnChecks: boolean[] = [];
  warnChecks.push(
    podsDiff.changed.some((entry) => entry.changedKeys.includes("status"))
  );
  warnChecks.push(
    tenantsDiff.changed.some((entry) => entry.changedKeys.includes("plan")) ||
      podsDiff.changed.some((entry) => entry.changedKeys.includes("plan"))
  );
  warnChecks.push(edgesDiff.added.length > 0 || edgesDiff.removed.length > 0);

  let severity: "info" | "warn" | "critical" = "info";
  if (criticalChecks.some(Boolean)) {
    severity = "critical";
  } else if (warnChecks.some(Boolean)) {
    severity = "warn";
  }

  const totalAdded =
    tenantsDiff.added.length +
    podsDiff.added.length +
    domainsDiff.added.length +
    servicesDiff.added.length +
    edgesDiff.added.length;
  const totalRemoved =
    tenantsDiff.removed.length +
    podsDiff.removed.length +
    domainsDiff.removed.length +
    servicesDiff.removed.length +
    edgesDiff.removed.length;
  const totalChanged =
    tenantsDiff.changed.length +
    podsDiff.changed.length +
    domainsDiff.changed.length +
    servicesDiff.changed.length;

  return {
    added: {
      tenants: tenantsDiff.added,
      pods: podsDiff.added,
      domains: domainsDiff.added,
      services: servicesDiff.added,
      edges: edgesDiff.added
    },
    removed: {
      tenants: tenantsDiff.removed,
      pods: podsDiff.removed,
      domains: domainsDiff.removed,
      services: servicesDiff.removed,
      edges: edgesDiff.removed
    },
    changed: {
      tenants: tenantsDiff.changed,
      pods: podsDiff.changed,
      domains: domainsDiff.changed,
      services: servicesDiff.changed
    },
    summary: {
      totalAdded,
      totalRemoved,
      totalChanged,
      affectedTenants: Array.from(affectedTenants).sort(),
      affectedClassification,
      severity
    }
  };
}
