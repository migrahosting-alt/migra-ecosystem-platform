import "server-only";

/**
 * Live infrastructure observation, read through the control authority.
 *
 * The console does not talk to Proxmox and does not hold fleet SSH. It asks
 * panel-api on migrapanel-core, which owns the privileged path, over a GET-only
 * internal-token endpoint. That is the whole reason this file is a thin client:
 * the console's job is to render truth, not to hold power.
 *
 * Everything here can fail, and failure is reported as UNKNOWN with a reason.
 * A fetch that times out tells us nothing about whether a node is up.
 */

export interface ServiceObservation {
  unit: string;
  activeState: string | null;
  subState: string | null;
  since: string | null;
  restarts: number | null;
  healthy: boolean | null;
  error?: string;
}

export interface NodeObservation {
  id: string;
  name: string;
  vmid: number | null;
  platform?: string;
  lifecycleState?: string;
  power: {
    state: string | null;
    uptimeSeconds: number | null;
    observedAt: string | null;
    source: string;
    reason?: string;
  };
  memory: {
    guestMetricsAvailable: boolean;
    /** Host accounting. NEVER render as guest memory usage or a percentage. */
    hostAllocationMB: number | null;
    hostMaxMB: number | null;
    reason: string;
  };
  services: {
    checked: number;
    observations: ServiceObservation[];
    observedAt: string | null;
    source: string;
    reason?: string;
  };
}

export interface ObservationResult {
  available: boolean;
  /** Which authority answered for power state: "Proxmox REST" or the pvesh fallback. */
  powerSource?: string;
  /** Present only when REST was bypassed — a silent downgrade must be impossible. */
  powerNotice?: string;
  /** Why nothing was observed, when nothing was. */
  reason?: string;
  observedAt: string | null;
  provenance?: {
    available: boolean;
    nodeCount?: number;
    sourceSha256?: string;
    generatedAt?: string;
    estateReconciledAt?: string;
  };
  /** Power and service coverage are counted separately: observing a guest's
   *  power needs only a vmid, reaching inside it needs a reachable address. */
  coverage: {
    targets: number;
    powerTargets?: number;
    powerObserved: number;
    serviceTargets?: number;
    servicesObserved: number;
  };
  byNodeId: Map<string, NodeObservation>;
}

const EMPTY = (reason: string): ObservationResult => ({
  available: false,
  reason,
  observedAt: null,
  coverage: { targets: 0, powerObserved: 0, servicesObserved: 0 },
  byNodeId: new Map(),
});

export const loadObservation = async (): Promise<ObservationResult> => {
  const base = (process.env.PANEL_API_BASE || "").trim();
  const token = (process.env.PANEL_INTERNAL_TOKEN || "").trim();
  if (!base) return EMPTY("PANEL_API_BASE is not configured on this host");
  if (!token) return EMPTY("no internal token is configured — the console cannot ask the control authority");

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`${base}/internal/infrastructure/observe`, {
      method: "GET",
      headers: { "x-panel-internal-token": token },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      return EMPTY(
        res.status === 401
          ? "the control authority rejected the console's internal token"
          : `control authority returned HTTP ${res.status}`,
      );
    }

    const data = (await res.json()) as {
      observedAt: string;
      powerSource?: string;
      powerNotice?: string;
      provenance: ObservationResult["provenance"];
      coverage: ObservationResult["coverage"];
      nodes: NodeObservation[];
      reason?: string;
    };

    const byNodeId = new Map<string, NodeObservation>();
    for (const n of data.nodes ?? []) byNodeId.set(n.id, n);

    return {
      available: true,
      ...(data.reason ? { reason: data.reason } : {}),
      observedAt: data.observedAt ?? null,
      // Conditional spread: under exactOptionalPropertyTypes an optional field
      // may be absent, but must never be explicitly undefined.
      ...(data.provenance ? { provenance: data.provenance } : {}),
      ...(data.powerSource ? { powerSource: data.powerSource } : {}),
      ...(data.powerNotice ? { powerNotice: data.powerNotice } : {}),
      coverage: data.coverage ?? { targets: 0, powerObserved: 0, servicesObserved: 0 },
      byNodeId,
    };
  } catch (err) {
    const name = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.name) : "network error";
    // Our inability to ask is not evidence about the estate.
    return EMPTY(`could not reach the control authority: ${name}`);
  }
};

/** Human uptime, or null. Never invents precision it does not have. */
export const uptimeLabel = (seconds: number | null): string | null => {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  const d = Math.floor(seconds / 86400);
  if (d >= 1) return `${d}d`;
  const h = Math.floor(seconds / 3600);
  if (h >= 1) return `${h}h`;
  return `${Math.floor(seconds / 60)}m`;
};

export interface PolicyEntry {
  actions: string[];
  eligibility?: "NONE" | "CANARY" | "LOW_RISK" | "PRODUCTION" | "CRITICAL";
  approvalRequired?: boolean;
  stepUpRequired?: boolean;
  policyReason?: string;
  blockedReason?: string;
  settling?: boolean;
  settlingAs?: string;
}

export interface LifecyclePolicy {
  available: boolean;
  canaryActive: boolean;
  /** vmid -> allowed actions. Absent means the server offers nothing. */
  byVmid: Map<number, PolicyEntry>;
}

/**
 * What the control authority will actually permit, per guest.
 *
 * The page asks rather than deciding for itself, so the UI cannot drift into
 * offering something the server would refuse — or hiding something it allows.
 */
export const loadLifecyclePolicy = async (): Promise<LifecyclePolicy> => {
  const base = (process.env.PANEL_API_BASE || "").trim();
  const token = (process.env.PANEL_INTERNAL_TOKEN || "").trim();
  const empty: LifecyclePolicy = { available: false, canaryActive: false, byVmid: new Map() };
  if (!base || !token) return empty;
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 12_000);
    const res = await fetch(`${base}/internal/infrastructure/lifecycle/allowed`, {
      headers: { "x-panel-internal-token": token },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return empty;
    const data = (await res.json()) as {
      canaryActive: boolean;
      targets: Array<PolicyEntry & { vmid: number }>;
    };
    const byVmid = new Map<number, PolicyEntry>();
    for (const t2 of data.targets ?? []) {
      byVmid.set(t2.vmid, {
        actions: t2.actions ?? [],
        ...(t2.blockedReason ? { blockedReason: t2.blockedReason } : {}),
        ...(t2.settling ? { settling: true, settlingAs: t2.settlingAs } : {}),
        ...(t2.eligibility ? { eligibility: t2.eligibility } : {}),
        ...(t2.policyReason ? { policyReason: t2.policyReason } : {}),
        ...(t2.approvalRequired != null ? { approvalRequired: t2.approvalRequired } : {}),
        ...(t2.stepUpRequired != null ? { stepUpRequired: t2.stepUpRequired } : {}),
      });
    }
    return { available: true, canaryActive: !!data.canaryActive, byVmid };
  } catch {
    return empty;
  }
};

/**
 * One plane of the target model.
 *
 * `null` NEVER means "fine" — it means NOT ESTABLISHED. A website that was never
 * reconciled onto the binding model has no discovered or active plane at all,
 * and an empty cell would read as "nothing wrong here" for 22 of 24 rows.
 */
export interface TargetPlane {
  vmid: number | null;
  label: string | null;
  source: string | null;
  at: string | null;
}

export type TargetState = "RECONCILED" | "CONFLICT" | "RECONCILIATION_REQUIRED" | "NO_TARGET";

export interface TargetAuditRow {
  websiteId: string;
  domain: string;
  status: string;
  recordedVmid: number | null;
  resolvedGuest: string | null;
  classification: string | null;
  verdict: "OK" | "PHANTOM" | "WRONG_GUEST" | "TERMINATED" | "NO_TARGET" | "CONFLICT";
  /** Derived once by the control plane, from the resolver that enforces. */
  targetState: TargetState;
  authority: "binding" | "legacy";
  workloadKey?: string | null;
  desired: TargetPlane | null;
  discovered: TargetPlane | null;
  active: TargetPlane | null;
  activeExpiresAt?: string | null;
  runtimeKind?: string | null;
  documentRoot?: string | null;
  reconciliationReason?: string | null;
  operatorMessage?: string;
}

export interface TargetAudit {
  available: boolean;
  reason?: string;
  unreconciled: number;
  total: number;
  rows: TargetAuditRow[];
}

/**
 * Hosting targets that cannot be trusted.
 *
 * Surfaced so an operator sees "reconciliation required" BEFORE clicking, rather
 * than discovering it from an error afterwards. Comes from the control plane,
 * which applies the same authority check that enforces the block — the page and
 * the guard cannot disagree.
 */
export const loadTargetAudit = async (): Promise<TargetAudit> => {
  const base = (process.env.PANEL_API_BASE || "").trim();
  const token = (process.env.PANEL_INTERNAL_TOKEN || "").trim();
  const empty: TargetAudit = { available: false, unreconciled: 0, total: 0, rows: [] };
  if (!base || !token) return { ...empty, reason: "control authority not configured" };
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 20_000);
    const res = await fetch(`${base}/internal/hosting/target-audit`, {
      headers: { "x-panel-internal-token": token },
      cache: "no-store",
      signal: controller.signal,
    });
    clearTimeout(t);
    if (!res.ok) return { ...empty, reason: `control authority returned HTTP ${res.status}` };
    const d = (await res.json()) as { rows: TargetAuditRow[]; unreconciled: number };
    return {
      available: true,
      unreconciled: d.unreconciled ?? 0,
      total: (d.rows ?? []).length,
      rows: d.rows ?? [],
    };
  } catch {
    return { ...empty, reason: "could not reach the control authority" };
  }
};
