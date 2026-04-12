export type DriftClassification = "internal" | "client";
export type DriftClassificationFilter = DriftClassification | "all";

export interface DriftTenant {
  tenantId: string;
  name: string | null;
  status: string | null;
  plan: string | null;
  classification: DriftClassification | null;
  ownerOrg: string | null;
  environment: string | null;
}

export interface DriftPod {
  podId: string;
  tenantId: string | null;
  namespace: string | null;
  status: string | null;
  plan: string | null;
  classification: DriftClassification | null;
  ownerOrg: string | null;
  environment: string | null;
}

export interface DriftDomain {
  domain: string;
  tenantId: string | null;
  podId: string | null;
  type: string | null;
  status: string | null;
  classification: DriftClassification | null;
  ownerOrg: string | null;
  environment: string | null;
}

export interface DriftService {
  serviceId: string;
  type: string | null;
  host: string | null;
  notes: string | null;
  privateAccess: string | null;
  status: string | null;
  classification: DriftClassification | null;
  ownerOrg: string | null;
  environment: string | null;
}

export interface DriftEdge {
  from: string;
  to: string;
  type: string | null;
}

export interface DriftSnapshotState {
  tenants: DriftTenant[];
  pods: DriftPod[];
  domains: DriftDomain[];
  services: DriftService[];
  topology: {
    edges: DriftEdge[];
  };
}

export interface DriftSnapshot {
  snapshotId: string;
  ts: string;
  environment: string;
  classification: DriftClassificationFilter;
  source: "inventory";
  note: string | null;
  registryHash: string | null;
  classificationSummary: {
    internal: number;
    client: number;
  };
  state: DriftSnapshotState;
}

export interface DriftChangedItem<T> {
  id: string;
  before: T;
  after: T;
  changedKeys: string[];
}

export interface DriftDiffResult {
  added: {
    tenants: DriftTenant[];
    pods: DriftPod[];
    domains: DriftDomain[];
    services: DriftService[];
    edges: DriftEdge[];
  };
  removed: {
    tenants: DriftTenant[];
    pods: DriftPod[];
    domains: DriftDomain[];
    services: DriftService[];
    edges: DriftEdge[];
  };
  changed: {
    tenants: DriftChangedItem<DriftTenant>[];
    pods: DriftChangedItem<DriftPod>[];
    domains: DriftChangedItem<DriftDomain>[];
    services: DriftChangedItem<DriftService>[];
  };
  summary: {
    totalAdded: number;
    totalRemoved: number;
    totalChanged: number;
    affectedTenants: string[];
    affectedClassification: {
      internal: number;
      client: number;
    };
    severity: "info" | "warn" | "critical";
  };
  correlation?: DriftCorrelation;
}

export interface DriftCorrelationImpact {
  tenantIds?: string[];
  domains?: string[];
  podIds?: string[];
  serviceIds?: string[];
}

export interface DriftCorrelationCandidate {
  kind: "mission" | "journal";
  missionId?: string;
  runId?: string;
  journalEntryId?: string;
  jobId?: string;
  toolName?: string;
  ts?: string;
  score: number;
  reasons: string[];
  impacted: DriftCorrelationImpact;
}

export interface DriftCorrelation {
  window: {
    fromTs: string;
    toTs: string;
  };
  candidates: DriftCorrelationCandidate[];
  best?: DriftCorrelationCandidate;
  summary: string;
}

export interface DriftDiffRecord {
  diffId: string;
  fromSnapshotId: string;
  toSnapshotId: string;
  ts: string;
  environment: string;
  classification: DriftClassificationFilter;
  diff: DriftDiffResult;
}

export interface DriftSnapshotMeta {
  snapshotId: string;
  ts: string;
  environment: string;
  classification: DriftClassificationFilter;
  note: string | null;
  prevSnapshotId: string | null;
  diffId: string | null;
  severity: "info" | "warn" | "critical" | null;
  affectedTenants: string[];
}

export interface DriftIndex {
  snapshots: DriftSnapshotMeta[];
  diffs: Array<{
    diffId: string;
    fromSnapshotId: string;
    toSnapshotId: string;
    ts: string;
    environment: string;
    classification: DriftClassificationFilter;
    severity: "info" | "warn" | "critical";
  }>;
}

export interface CreateSnapshotInput {
  environment: "dev" | "stage" | "staging" | "prod" | "test";
  classification: DriftClassificationFilter;
  note?: string;
}

export interface CreateSnapshotResult {
  snapshot: DriftSnapshot;
  meta: DriftSnapshotMeta;
  previousSnapshotId: string | null;
  diffRecord: DriftDiffRecord | null;
}
