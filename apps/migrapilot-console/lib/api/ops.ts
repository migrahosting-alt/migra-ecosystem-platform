import "server-only";
import { z } from "zod";
import { apiGet, apiPost } from "./client";

/* ── Schemas ── */

export const OpsReleaseRowSchema = z.object({
  runId:       z.string(),
  env:         z.string(),
  finalStatus: z.string().optional(),
  commit:      z.string().nullable().optional(),
  branch:      z.string().nullable().optional(),
  dirty:       z.boolean().optional(),
  startedAt:   z.string().optional(),
  finishedAt:  z.string().nullable().optional(),
  stagesJson:  z.unknown().optional(),
});
export type OpsReleaseRow = z.infer<typeof OpsReleaseRowSchema>;

export const IncidentSchema = z.object({
  id:          z.string(),
  env:         z.string(),
  severity:    z.enum(["INFO", "WARN", "ERROR", "CRITICAL"]),
  status:      z.enum(["OPEN", "ACK", "RESOLVED"]),
  title:       z.string(),
  dedupeKey:   z.string().nullable().optional(),
  runId:       z.string().nullable().optional(),
  createdAt:   z.string().optional(),
  resolvedAt:  z.string().nullable().optional(),
  evidence:    z.record(z.string(), z.unknown()).optional(),
});
export type Incident = z.infer<typeof IncidentSchema>;

export const OpsApprovalSchema = z.object({
  id:            z.string(),
  env:           z.string(),
  actionKey:     z.string(),
  tier:          z.string(),
  title:         z.string(),
  why:           z.string(),
  impact:        z.string().nullable().optional(),
  payloadJson:   z.unknown(),
  verifyPlan:    z.unknown(),
  rollbackPlan:  z.unknown(),
  status:        z.enum(["PENDING", "APPROVED", "EXECUTING", "REJECTED", "EXPIRED", "EXECUTED"]),
  requestedBy:   z.string(),
  approvedBy:    z.string().nullable().optional(),
  rejectedBy:    z.string().nullable().optional(),
  dedupeKey:     z.string().nullable().optional(),
  runId:         z.string().nullable().optional(),
  missionId:     z.string().nullable().optional(),
  stepName:      z.string().nullable().optional(),
  expiresAt:     z.string(),
  approvedAt:    z.string().nullable().optional(),
  rejectedAt:    z.string().nullable().optional(),
  executedAt:    z.string().nullable().optional(),
  createdAt:     z.string(),
  updatedAt:     z.string(),
});
export type OpsApproval = z.infer<typeof OpsApprovalSchema>;

/* ── Releases ── */

export async function getReleases(env: string, limit = 50) {
  const q = env !== "all" ? `?env=${env}&limit=${limit}` : `?limit=${limit}`;
  return apiGet<{ releases: OpsReleaseRow[] }>(`/api/ops/releases${q}`);
}

export async function getRelease(runId: string) {
  return apiGet<{ release: OpsReleaseRow & { reports: unknown[] } }>(
    `/api/ops/releases/${encodeURIComponent(runId)}`
  );
}

/* ── Incidents ── */

export async function getIncidents(env: string, status?: string) {
  const q = new URLSearchParams();
  if (env !== "all") q.set("env", env);
  if (status && status !== "all") q.set("status", status);
  q.set("limit", "100");
  return apiGet<{ incidents: Incident[] }>(`/api/ops/incidents?${q.toString()}`);
}

export async function ackIncident(id: string) {
  return apiPost<{ ok: true }>("/api/ops/incidents/ack", { id });
}

export async function resolveIncident(id: string) {
  return apiPost<{ ok: true }>("/api/ops/incidents/resolve", { id });
}

/* ── Approvals ── */

export async function getOpsApprovals(status = "PENDING") {
  return apiGet<{ approvals: OpsApproval[] }>(`/api/ops/approvals?status=${status}`);
}

export async function approveOpsRequest(id: string, approvedBy = "operator") {
  return apiPost<{ id: string; status: string }>(
    `/api/ops/approvals/${id}/approve`,
    { approvedBy }
  );
}

export async function rejectOpsRequest(id: string) {
  return apiPost<{ id: string; status: string }>(`/api/ops/approvals/${id}/reject`);
}

/* ── Approvals v2 (blocked-step autonomy approvals) ── */

export async function approveOnceOps(id: string) {
  return apiPost<{ approval: OpsApproval }>("/api/ops/approvals/approve-once", { id });
}

export async function approveAlwaysOps(id: string, ttlSeconds?: number) {
  return apiPost<{ approval: OpsApproval }>("/api/ops/approvals/approve-always", {
    id,
    ...(ttlSeconds !== undefined ? { ttlSeconds } : {}),
  });
}

export async function rejectOpsApprovalV2(id: string, reason?: string) {
  return apiPost<{ approval: OpsApproval }>("/api/ops/approvals/reject", {
    id,
    ...(reason ? { reason } : {}),
  });
}

export async function executeOpsApproval(id: string) {
  return apiPost<{
    ok: boolean;
    execOk: boolean;
    proofsOk: boolean;
    durationMs: number;
    adapter?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
    proofsObserved: Array<{ kind: string; ok: boolean; detail?: string }>;
  }>("/api/ops/approvals/execute", { id });
}

export async function listOpsApprovals(
  env: "dev" | "staging" | "prod" | "all",
  status?: string,
  limit = 100
) {
  const q = new URLSearchParams();
  if (env !== "all") q.set("env", env);
  if (status) q.set("status", status);
  q.set("limit", String(Math.min(limit, 200)));
  return apiGet<{ approvals: OpsApproval[] }>(`/api/ops/approvals?${q.toString()}`);
}
