import "server-only";
import { loadTargetAudit, type TargetAuditRow, type TargetState, type TargetPlane } from "../fleet/observation";

/**
 * Hosting target reconciliation status, for the operator surfaces.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DIVISION OF RESPONSIBILITY
 *
 *   backend guard = final authority
 *   UI preflight  = operator clarity
 *
 * This module NEVER decides whether an action is permitted. It consumes the
 * verdict the control plane already computed with the same resolver that
 * enforces the block, so the page and the guard cannot disagree. If this file
 * were deleted the system would remain safe — it would just be ruder, letting
 * an operator click something that then refuses.
 *
 * That ordering matters because the first version of the audit endpoint
 * reimplemented the eligibility logic independently and promptly disagreed with
 * enforcement about 11 rows. Audit and enforcement derive from one resolver.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WORDING RULE (Slice 3I)
 *
 * An operator is not required to interpret infrastructure internals to
 * understand why a button is missing. Every state therefore carries TWO
 * registers:
 *
 *   headline   what is wrong and what it means, in plain words. No vmid,
 *              no guest hostname, no resolver code.
 *   technical  the same fact as evidence — "Recorded target: VM 108",
 *              "Resolved infrastructure role: mail-core" — behind a
 *              disclosure the operator opens only if they want it.
 *
 * The internals are useful. They are simply not the explanation.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type { TargetState, TargetPlane };
export type TargetVerdict = TargetAuditRow["verdict"];

export interface TechnicalDetail {
  label: string;
  value: string;
}

export interface TargetStatus {
  state: TargetState;
  verdict: TargetVerdict;
  /** True when guest-modifying operations must not be offered. */
  blocked: boolean;
  /** Short label for a table cell. */
  label: string;
  /** One sentence an operator can act on. No internal classification names. */
  headline: string;
  /** Second sentence: what it does and does not imply. */
  detail: string;
  /** Which model answered. Bound sites no longer consult targetJson. */
  authority: "binding" | "legacy";
  workloadKey: string | null;
  desired: TargetPlane | null;
  discovered: TargetPlane | null;
  active: TargetPlane | null;
  activeExpiresAt: string | null;
  runtimeKind: string | null;
  documentRoot: string | null;
  reconciliationReason: string | null;
  /** Engineering evidence. Secondary by construction — never the headline. */
  technical: TechnicalDetail[];
}

/** Operator-facing wording. Internal codes stay in diagnostics and audit. */
const COPY: Record<
  TargetState,
  { label: string; headline: string; detail: string; blocked: boolean }
> = {
  RECONCILED: {
    label: "Reconciled",
    headline: "Target reconciled and authorized.",
    // Deliberately NOT "healthy". Reconciled says the platform agrees with
    // itself about which server holds this site — it says nothing about whether
    // the site is up, fast, or even has content. pod 511 is the standing
    // reminder: the one consistent row, and the pod is empty.
    detail: "The platform agrees on which server holds this site. This is not a statement about the site's health.",
    blocked: false,
  },
  CONFLICT: {
    label: "Conflict",
    headline: "This site's records and its live traffic point at different servers.",
    detail:
      "No target can be chosen safely, because picking either one could send the site to the wrong place. Server-changing actions are blocked until this is resolved by a person.",
    blocked: true,
  },
  RECONCILIATION_REQUIRED: {
    label: "Reconciliation required",
    headline: "The recorded server for this site is not a valid customer workload.",
    detail:
      "The site itself is not necessarily offline. What is wrong is where the platform believes its server is, so any action that would modify a server is withheld until the record is reconciled.",
    blocked: true,
  },
  NO_TARGET: {
    label: "No target",
    headline: "No hosting server is recorded for this site.",
    detail:
      "Nothing tells the platform where this site lives, so no server-changing action can be aimed anywhere. Read-only information remains available.",
    blocked: true,
  },
};

/** Verdict-specific refinement of the headline, still free of internals. */
const VERDICT_HEADLINE: Partial<Record<TargetVerdict, string>> = {
  PHANTOM: "The server recorded for this site no longer exists.",
  WRONG_GUEST: "The recorded server belongs to another infrastructure role.",
  TERMINATED: "The hosting service record for this site has been terminated.",
};

export interface HostingTargetIndex {
  /** False when the control plane could not be reached. */
  available: boolean;
  reason?: string;
  unreconciled: number;
  total: number;
  states: Record<TargetState, number>;
  byWebsiteId: Map<string, TargetStatus>;
  byDomain: Map<string, TargetStatus>;
}

const norm = (d: string) => d.trim().toLowerCase().replace(/^www\./, "");

const buildTechnical = (row: TargetAuditRow): TechnicalDetail[] => {
  const out: TechnicalDetail[] = [];
  if (row.recordedVmid != null) out.push({ label: "Recorded target", value: `VM ${row.recordedVmid}` });
  if (row.resolvedGuest) out.push({ label: "Resolved server", value: row.resolvedGuest });
  if (row.classification) out.push({ label: "Infrastructure role", value: row.classification });
  if (row.runtimeKind) out.push({ label: "Observed runtime", value: row.runtimeKind });
  if (row.documentRoot) out.push({ label: "Document root", value: row.documentRoot });
  if (row.workloadKey) out.push({ label: "Workload identity", value: row.workloadKey });
  out.push({
    label: "Answered by",
    value: row.authority === "binding" ? "reconciled target binding" : "legacy provisioning record",
  });
  return out;
};

const toStatus = (row: TargetAuditRow): TargetStatus => {
  const state: TargetState = row.targetState ?? "RECONCILIATION_REQUIRED";
  const copy = COPY[state] ?? COPY.RECONCILIATION_REQUIRED;
  return {
    state,
    verdict: row.verdict,
    blocked: copy.blocked,
    label: copy.label,
    headline: VERDICT_HEADLINE[row.verdict] ?? copy.headline,
    detail: copy.detail,
    authority: row.authority ?? "legacy",
    workloadKey: row.workloadKey ?? null,
    desired: row.desired ?? null,
    discovered: row.discovered ?? null,
    active: row.active ?? null,
    activeExpiresAt: row.activeExpiresAt ?? null,
    runtimeKind: row.runtimeKind ?? null,
    documentRoot: row.documentRoot ?? null,
    reconciliationReason: row.reconciliationReason ?? null,
    technical: buildTechnical(row),
  };
};

const EMPTY_STATES: Record<TargetState, number> = {
  RECONCILED: 0,
  CONFLICT: 0,
  RECONCILIATION_REQUIRED: 0,
  NO_TARGET: 0,
};

export const loadHostingTargetIndex = async (): Promise<HostingTargetIndex> => {
  const audit = await loadTargetAudit();
  const byWebsiteId = new Map<string, TargetStatus>();
  const byDomain = new Map<string, TargetStatus>();

  if (!audit.available) {
    return {
      available: false,
      ...(audit.reason ? { reason: audit.reason } : {}),
      unreconciled: 0,
      total: 0,
      states: { ...EMPTY_STATES },
      byWebsiteId,
      byDomain,
    };
  }

  /* VERSION SKEW — fail honest, never guess.
   *
   * If the control plane predates target-state reporting, the rows arrive with
   * no `targetState`. Defaulting them would paint every site — Elize and Yves
   * included — as "Reconciliation required", which is a false alarm, and
   * re-deriving the state here would be the second summary implementation this
   * slice exists to prevent. So we report the index as unavailable and every
   * pill renders "Unknown". The backend guard is unaffected either way. */
  if (audit.rows.length > 0 && audit.rows.every((r) => !r.targetState)) {
    return {
      available: false,
      reason: "control plane does not report target state",
      unreconciled: 0,
      total: 0,
      states: { ...EMPTY_STATES },
      byWebsiteId,
      byDomain,
    };
  }

  const states = { ...EMPTY_STATES };
  for (const row of audit.rows) {
    const status = toStatus(row);
    states[status.state] = (states[status.state] ?? 0) + 1;
    if (row.websiteId) byWebsiteId.set(row.websiteId, status);
    if (row.domain) byDomain.set(norm(row.domain), status);
  }

  return {
    available: true,
    unreconciled: audit.unreconciled,
    total: audit.total,
    states,
    byWebsiteId,
    byDomain,
  };
};

/**
 * Look up one site. Matches by id first, then domain.
 *
 * When the control plane is unreachable we return null rather than inventing an
 * "OK": the page then shows nothing special, and the backend guard still
 * refuses anything unsafe. Absence of a warning must never be read as a
 * positive assurance.
 */
export const targetStatusFor = (
  index: HostingTargetIndex,
  site: { id?: string | null; domain?: string | null },
): TargetStatus | null => {
  if (!index.available) return null;
  if (site.id && index.byWebsiteId.has(site.id)) return index.byWebsiteId.get(site.id)!;
  if (site.domain && index.byDomain.has(norm(site.domain))) return index.byDomain.get(norm(site.domain))!;
  return null;
};
