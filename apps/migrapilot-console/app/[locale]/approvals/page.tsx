"use client";

import { useEffect, useState } from "react";

import type { ApprovalRecord } from "@/lib/shared/types";
import { ApprovalCard } from "@/components/ApprovalCard";
import type { EnvName, RiskTier } from "@/lib/ui-contracts";

interface OpsApproval {
  id: string;
  env: string;
  actionKey: string;
  tier: string;
  title: string;
  why: string;
  payloadJson: unknown;
  verifyPlan: unknown;
  rollbackPlan: unknown;
  status: string;
  requestedBy: string;
  approvedBy: string | null;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export default function ApprovalsPage() {
  /* ── T3 Approvals (existing) ── */
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);

  /* ── Ops Approvals (new) ── */
  const [opsApprovals, setOpsApprovals] = useState<OpsApproval[]>([]);
  const [opsLoading, setOpsLoading] = useState(false);

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
      const res = await fetch("/api/ops/approvals?status=PENDING", { cache: "no-store" });
      const payload = (await res.json()) as { ok: boolean; data?: { approvals: OpsApproval[] }; error?: string };
      if (payload.ok) setOpsApprovals(payload.data?.approvals ?? []);
    } finally {
      setOpsLoading(false);
    }
  }

  useEffect(() => {
    void loadApprovals();
    void loadOpsApprovals();
  }, []);

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
    const res = await fetch(`/api/ops/approvals/${id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approvedBy: "operator" }),
    });
    const payload = (await res.json()) as { ok: boolean; error?: string };
    setMessage(payload.ok ? `Ops approval ${id} approved` : payload.error ?? "Failed");
    await loadOpsApprovals();
  }

  async function opsReject(id: string) {
    const res = await fetch(`/api/ops/approvals/${id}/reject`, { method: "POST" });
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
                status={oap.status as "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED" | "EXECUTED"}
                title={oap.title}
                why={oap.why}
                expiresAtText={formatExpiry(oap.expiresAt)}
                verificationPlanSummary={planSummary(oap.verifyPlan)}
                rollbackPlanSummary={planSummary(oap.rollbackPlan)}
                payloadPreview={JSON.stringify(oap.payloadJson, null, 2)}
                warningText={oap.env === "prod" ? "This action targets the production environment." : undefined}
                onApproveOnce={() => { void opsApproveOnce(oap.id); }}
                onApproveAlways={() => { void opsApproveOnce(oap.id); }}
                onReject={() => { void opsReject(oap.id); }}
              />
            ))}
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
