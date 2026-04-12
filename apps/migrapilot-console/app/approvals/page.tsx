"use client";

import { useEffect, useState } from "react";

import type { ApprovalRecord } from "../../lib/shared/types";
import { ApprovalCard } from "../../components/ApprovalCard";
import type { EnvName, RiskTier } from "../../lib/ui-contracts";
import { useApprovalsSSE } from "../../lib/sse/useApprovalsSSE";

interface OpsApproval {
  id: string;
  env: string;
  actionKey: string;
  tier: string;
  title: string;
  why: string;
  impact?: string | null;
  payloadJson: unknown;
  verifyPlan: unknown;
  rollbackPlan: unknown;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  stepName?: string | null;
  missionId?: string | null;
  dedupeKey?: string | null;
  runId?: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

interface ApprovalGrant {
  id: string;
  env: string;
  actionKey: string;
  expiresAt: string;
  createdAt: string;
  createdBy: string | null;
}

export default function ApprovalsPage() {
  /* ── T3 Approvals (existing) ── */
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  /* ── Ops Approvals (new) ── */
  const [opsApprovals, setOpsApprovals] = useState<OpsApproval[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);

  /* ── Approve-Always Grants ── */
  const [grants, setGrants] = useState<ApprovalGrant[]>([]);
  const [grantsLoading, setGrantsLoading] = useState(false);

  async function loadApprovals() {
    const response = await fetch("/api/approvals", { cache: "no-store" });
    const payload = (await response.json()) as {
      ok: boolean;
      data: { approvals: ApprovalRecord[] };
    };
    if (payload.ok) {
      setApprovals(payload.data.approvals);
    }
  }

  async function loadOpsApprovals() {
    setOpsLoading(true);
    try {
      const [pendingRes, executingRes] = await Promise.all([
        fetch("/api/ops/approvals?status=PENDING", { cache: "no-store" }),
        fetch("/api/ops/approvals?status=EXECUTING", { cache: "no-store" }),
      ]);
      type Payload = { ok: boolean; data?: { approvals: OpsApproval[] }; error?: string };
      const [pendingPayload, executingPayload] = (await Promise.all([
        pendingRes.json(),
        executingRes.json(),
      ])) as [Payload, Payload];
      const all = [
        ...(pendingPayload.ok ? (pendingPayload.data?.approvals ?? []) : []),
        ...(executingPayload.ok ? (executingPayload.data?.approvals ?? []) : []),
      ];
      setOpsApprovals(all);
    } finally {
      setOpsLoading(false);
    }
  }

  useEffect(() => {
    void loadApprovals();
    void loadOpsApprovals();
    void loadGrants();
  }, []);

  async function loadGrants() {
    setGrantsLoading(true);
    try {
      const res = await fetch("/api/ops/approvals/grants", { cache: "no-store" });
      const payload = (await res.json()) as { ok: boolean; data?: { grants: ApprovalGrant[] } };
      if (payload.ok) setGrants(payload.data?.grants ?? []);
    } finally {
      setGrantsLoading(false);
    }
  }

  async function revokeGrant(id: string) {
    const res = await fetch(`/api/ops/approvals/grants/${id}`, { method: "DELETE" });
    const payload = (await res.json()) as { ok: boolean; error?: string };
    setMessage(payload.ok ? "Grant revoked" : payload.error ?? "Revoke failed");
    await loadGrants();
  }

  /* ── Auto-refresh every 5 s while any approval is executing ── */
  useEffect(() => {
    const hasExecuting = opsApprovals.some((a) => a.status === "EXECUTING");
    if (!hasExecuting) return;
    const timer = setInterval(() => { void loadOpsApprovals(); }, 5000);
    return () => clearInterval(timer);
  }, [opsApprovals]);

  /* ── Real-time SSE updates (all envs) ── */
  useApprovalsSSE({
    env: "all",
    onEvent: () => { void loadOpsApprovals(); },
  });

  async function approve(approvalId: string) {
    const code = codes[approvalId] ?? "";
    const response = await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", humanKeyTurnCode: code })
    });
    const payload = (await response.json()) as {
      ok: boolean;
      error?: { message: string };
    };
    setMessage(payload.ok ? `Approved ${approvalId}` : payload.error?.message ?? "Approval failed");
    await loadApprovals();
  }

  async function reject(approvalId: string) {
    await fetch(`/api/approvals/${approvalId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "reject" })
    });
    await loadApprovals();
  }

  async function opsApproveOnce(id: string) {
    const res = await fetch("/api/ops/approvals/approve-once", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = (await res.json()) as { ok: boolean; error?: string };
    setMessage(payload.ok ? `Ops approval ${id} approved` : payload.error ?? "Failed");
    await loadOpsApprovals();
  }

  async function opsApproveAlways(id: string) {
    const res = await fetch("/api/ops/approvals/approve-always", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = (await res.json()) as { ok: boolean; error?: string };
    setMessage(payload.ok ? `Ops approval ${id} set to Approve Always` : payload.error ?? "Failed");
    await loadOpsApprovals();
    await loadGrants(); // Approve Always creates a grant — refresh it immediately
  }

  async function opsReject(id: string) {
    const res = await fetch("/api/ops/approvals/reject", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const payload = (await res.json()) as { ok: boolean; error?: string };
    setMessage(payload.ok ? `Ops approval ${id} rejected` : payload.error ?? "Failed");
    await loadOpsApprovals();
  }

  function formatExpiry(iso: string): string {
    const d = new Date(iso);
    const now = Date.now();
    const diffMs = d.getTime() - now;
    if (diffMs < 0) return "expired";
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return d.toLocaleDateString();
  }

  function planSummary(val: unknown): string | undefined {
    if (!val) return undefined;
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (typeof obj.summary === "string") return obj.summary;
      const keys = Object.keys(obj);
      if (keys.length > 0) return keys.slice(0, 3).join(", ");
    }
    if (typeof val === "string") return val;
    return undefined;
  }

  function executionSummaryOf(payloadJson: unknown): string | undefined {
    if (!payloadJson || typeof payloadJson !== "object") return undefined;
    const exec = (payloadJson as Record<string, unknown>)._execution as Record<string, unknown> | undefined;
    if (!exec) return undefined;
    const dur = typeof exec.durationMs === "number" ? `${exec.durationMs}ms` : null;
    const tail = dur ? ` · ${dur}` : "";
    if (exec.ok) return `Last execution: OK${tail}`;
    const errMsg = typeof exec.error === "string" ? ` — ${exec.error.slice(0, 80)}` : "";
    return `Last execution: FAILED${tail}${errMsg}`;
  }

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Approvals</h2>
      {message ? <div className="small" style={{ marginBottom: 10, padding: "6px 10px", background: "var(--surface-2)", borderRadius: 6 }}>{message}</div> : null}

      {/* ── Ops Approval Requests (autonomy engine) ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Ops Approval Requests</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              Pending autonomy engine actions requiring human authorization.
            </div>
          </div>
          <button onClick={() => void loadOpsApprovals()} disabled={opsLoading} style={{ fontSize: 11 }}>
            {opsLoading ? "..." : "Refresh"}
          </button>
        </div>

        {opsApprovals.length === 0 ? (
          <div className="small" style={{ color: "var(--ok)", padding: "16px 10px", textAlign: "center" }}>
            No pending ops approvals.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {opsApprovals.map((oap) => (
              <ApprovalCard
                key={oap.id}
                id={oap.id}
                env={(oap.env as EnvName) || "prod"}
                tier={(oap.tier as RiskTier) || "T2"}
                status={oap.status as "PENDING" | "APPROVED" | "EXECUTING" | "REJECTED" | "EXPIRED" | "EXECUTED"}
                title={oap.title}
                why={oap.why}
                impactSummary={oap.impact ?? undefined}
                expiresAtText={formatExpiry(oap.expiresAt)}
                verificationPlanSummary={planSummary(oap.verifyPlan)}
                rollbackPlanSummary={planSummary(oap.rollbackPlan)}
                payloadPreview={JSON.stringify(oap.payloadJson, null, 2)}
                executionSummary={executionSummaryOf(oap.payloadJson)}
                warningText={oap.env === "prod" ? "This action targets the production environment." : undefined}
                onApproveOnce={() => { void opsApproveOnce(oap.id); }}
                onApproveAlways={() => { void opsApproveAlways(oap.id); }}
                onReject={() => { void opsReject(oap.id); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Approve-Always Grants ── */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Approve-Always Grants</div>
            <div className="small" style={{ color: "var(--muted)" }}>
              Active blanket approvals. Revoke to re-require human confirmation.
            </div>
          </div>
          <button onClick={() => void loadGrants()} disabled={grantsLoading} style={{ fontSize: 11 }}>
            {grantsLoading ? "..." : "Refresh"}
          </button>
        </div>
        {grants.length === 0 ? (
          <div className="small" style={{ color: "var(--muted)", padding: "12px 10px", textAlign: "center" }}>
            No active grants.
          </div>
        ) : (
          <div className="scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Env</th>
                  <th>Action Key</th>
                  <th>Expires</th>
                  <th>Granted By</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td>{g.env}</td>
                    <td className="small" style={{ fontFamily: "monospace" }}>{g.actionKey}</td>
                    <td className="small">{new Date(g.expiresAt).toLocaleDateString()}</td>
                    <td className="small">{g.createdBy ?? "—"}</td>
                    <td>
                      <button
                        onClick={() => void revokeGrant(g.id)}
                        style={{ fontSize: 11, color: "var(--danger)", borderColor: "var(--danger)" }}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Divider ── */}
      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 16, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Tier 3 Approvals</div>
        <p className="small" style={{ color: "var(--muted)", margin: 0 }}>
          Review pending high-risk actions, enter human key turn code, and execute approved job envelopes.
        </p>
      </div>

      <div className="scroll" style={{ marginTop: 12 }}>
        <table className="table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Tool</th>
              <th>Status</th>
              <th>Risk</th>
              <th>Run</th>
              <th>Human Key Turn</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {approvals.map((approval) => (
              <tr key={approval.id}>
                <td>{approval.id}</td>
                <td>{approval.toolName}</td>
                <td>{approval.status}</td>
                <td>{approval.risk}</td>
                <td>{approval.runId}</td>
                <td>
                  <input
                    placeholder="ABC123"
                    value={codes[approval.id] ?? ""}
                    onChange={(event) =>
                      setCodes((previous) => ({
                        ...previous,
                        [approval.id]: event.target.value
                      }))
                    }
                  />
                </td>
                <td style={{ display: "flex", gap: 8 }}>
                  <button disabled={approval.status !== "pending"} onClick={() => void approve(approval.id)}>
                    Approve
                  </button>
                  <button disabled={approval.status !== "pending"} onClick={() => void reject(approval.id)}>
                    Reject
                  </button>
                </td>
              </tr>
            ))}
            {approvals.length === 0 ? (
              <tr>
                <td colSpan={7} className="small" style={{ color: "var(--muted)" }}>
                  No approval requests.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
