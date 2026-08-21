"use client";

import { useEffect, useState } from "react";

/* ── Types ── */

interface PlaybookRow {
  id: string;
  name: string;
  description: string;
  category: string;
  tags: string[];
  stepCount: number;
  version: number;
  isPublished: boolean;
  stage: string;
  minTrustScore: number;
  createdAt: string;
  updatedAt: string;
}

interface PromotionRecord {
  id: string;
  fromStage: string;
  toStage: string;
  decision: string;
  decidedBy: string;
  notes: string | null;
  changeTicketRef: string | null;
  gateReport: { gate: string; passed: boolean; detail: string }[] | null;
  createdAt: string;
}

interface SuggestionRecord {
  id: string;
  playbookId: string;
  fromStage: string;
  toStage: string;
  gateReport: { gate: string; passed: boolean; detail: string }[];
  headline: string | null;
  primaryCheck: { gate: string; passed: boolean; detail: string } | null;
  expiresAt: string | null;
  lastEvaluatedAt: string | null;
  status: string;
  createdAt: string;
  playbook?: { id: string; name: string; stage: string; version: number; updatedAt: string };
}

interface BatchPromotionItem {
  id: string;
  playbookId: string;
  playbookVersion: number;
  suggestionId: string | null;
  fromStage: string;
  toStage: string;
  okToPromote: boolean;
  promoted: boolean;
  error: string | null;
  promotedAt: string | null;
  attempt: number;
  gateReport: { gate: string; passed: boolean; detail: string }[];
}

interface BatchPromotion {
  id: string;
  status: string;
  createdBy: string | null;
  requiresTier2: boolean;
  stopOnFailure: boolean;
  notes: string | null;
  summary: { total: number; ok: number; blocked: number; requiresTier2: boolean; stages: Record<string, number> } | null;
  results: { total: number; promoted: number; failed: number; skipped: number; stoppedEarly: boolean } | null;
  approvedAt: string | null;
  approvedBy: string | null;
  deniedAt: string | null;
  deniedBy: string | null;
  decisionReason: string | null;
  items: BatchPromotionItem[];
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastHeartbeatAt: string | null;
  executionAttempt: number;
  executeNonce: string | null;
  runRef: string | null;
  stuckDetectedAt: string | null;
  stuckReason: string | null;
}

const API = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

/* ── Helpers ── */

function fmtDate(s: string) { return new Date(s).toLocaleString(); }

const STAGE_COLORS: Record<string, string> = {
  DRAFT: "var(--fg-dim)",
  TESTED: "#dcdcaa",
  APPROVED: "#4ec9b0",
  LOCKED: "#569cd6",
};

const STAGE_ORDER = ["DRAFT", "TESTED", "APPROVED", "LOCKED"];

function stageBadge(stage: string) {
  const color = STAGE_COLORS[stage] ?? "var(--fg)";
  return (
    <span style={{
      color,
      background: `${color}18`,
      padding: "3px 10px",
      borderRadius: "4px",
      fontSize: "11px",
      fontWeight: 600,
      letterSpacing: "0.5px",
    }}>
      {stage}
    </span>
  );
}

/* ── Promote Dialog ── */

function PromoteDialog({
  playbook,
  onClose,
  onPromoted,
}: {
  playbook: PlaybookRow;
  onClose: () => void;
  onPromoted: (pb: PlaybookRow) => void;
}) {
  const [notes, setNotes] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  const [promoting, setPromoting] = useState(false);
  const [result, setResult] = useState<{
    promoted: boolean;
    blocked?: string;
    gateReport?: { gate: string; passed: boolean; detail: string }[];
  } | null>(null);

  const nextStage = STAGE_ORDER[STAGE_ORDER.indexOf(playbook.stage) + 1] ?? null;
  const needsTicket = playbook.stage === "APPROVED";

  const handlePromote = async () => {
    setPromoting(true);
    setResult(null);
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/${playbook.id}/promote`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: notes || undefined,
          changeTicketRef: ticketRef || undefined,
        }),
      });
      const j = await res.json();
      if (j.ok && j.data) {
        setResult({ promoted: true, gateReport: j.data.gateReport });
        onPromoted({ ...playbook, stage: j.data.toStage });
      } else {
        setResult({
          promoted: false,
          blocked: j.blocked ?? j.error ?? "Promotion blocked",
          gateReport: j.gateReport,
        });
      }
    } catch (e: any) {
      setResult({ promoted: false, blocked: e.message });
    }
    setPromoting(false);
  };

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
    }}
    onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          padding: 24,
          width: 480,
          maxHeight: "80vh",
          overflow: "auto",
        }}
        onClick={e => e.stopPropagation()}
      >
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--fg-bright)" }}>
          Promote: {playbook.name}
        </h3>
        <div style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 4, marginBottom: 16 }}>
          {stageBadge(playbook.stage)} → {nextStage ? stageBadge(nextStage) : "—"}
        </div>

        {!nextStage ? (
          <div style={{ color: "var(--fg-dim)", fontSize: 13 }}>Already at terminal stage.</div>
        ) : (
          <>
            <label style={{ fontSize: 12, color: "var(--fg-dim)", display: "block", marginBottom: 4 }}>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={2}
              style={{
                width: "100%",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 8,
                color: "var(--fg)",
                fontSize: 12,
                resize: "vertical",
                marginBottom: 12,
              }}
            />

            {needsTicket && (
              <>
                <label style={{ fontSize: 12, color: "#dcdcaa", display: "block", marginBottom: 4 }}>
                  Change Ticket Reference (required for LOCKED)
                </label>
                <input
                  value={ticketRef}
                  onChange={e => setTicketRef(e.target.value)}
                  placeholder="e.g. JIRA-1234"
                  style={{
                    width: "100%",
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    padding: 8,
                    color: "var(--fg)",
                    fontSize: 12,
                    marginBottom: 12,
                  }}
                />
              </>
            )}

            <button
              onClick={handlePromote}
              disabled={promoting || (needsTicket && !ticketRef.trim())}
              style={{
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 20px",
                fontSize: 13,
                fontWeight: 600,
                cursor: promoting ? "wait" : "pointer",
                opacity: promoting || (needsTicket && !ticketRef.trim()) ? 0.5 : 1,
              }}
            >
              {promoting ? "Promoting…" : `Promote to ${nextStage}`}
            </button>
          </>
        )}

        {/* Result */}
        {result && (
          <div style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            background: result.promoted ? "rgba(78,201,176,0.1)" : "rgba(241,76,76,0.1)",
            border: `1px solid ${result.promoted ? "rgba(78,201,176,0.3)" : "rgba(241,76,76,0.3)"}`,
          }}>
            <div style={{
              fontSize: 13,
              fontWeight: 600,
              color: result.promoted ? "#4ec9b0" : "#f14c4c",
              marginBottom: 8,
            }}>
              {result.promoted ? "Promoted successfully!" : "Promotion blocked"}
            </div>
            {result.blocked && (
              <div style={{ fontSize: 12, color: "var(--fg-dim)", marginBottom: 8 }}>{result.blocked}</div>
            )}
            {result.gateReport && result.gateReport.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {result.gateReport.map((g, i) => (
                  <div key={i} style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: g.passed ? "#4ec9b0" : "#f14c4c",
                    padding: "2px 8px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 4,
                  }}>
                    {g.passed ? "✓" : "✗"} {g.gate}: {g.detail}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 16px",
              color: "var(--fg-dim)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Batch Preview + Plan Modal ── */

const STATUS_COLORS: Record<string, string> = {
  PLANNED: "#dcdcaa",
  WAITING_APPROVAL: "#ce9178",
  RUNNING: "#569cd6",
  SUCCEEDED: "#4ec9b0",
  PARTIAL: "#dcdcaa",
  FAILED: "#f14c4c",
  CANCELED: "var(--fg-dim)",
};

interface PreviewItem {
  suggestionId: string;
  fingerprint: string;
  playbook: { id: string; name: string; version: number; stage: string };
  fromStage: string;
  toStage: string;
  okToPromote: boolean;
  gateReport: { gate: string; passed: boolean; detail: string }[];
  primaryCheck: { gate: string; passed: boolean; detail: string } | null;
  safety: { blastRadius: string; rollbackHint: string };
}

interface PreviewResult {
  total: number;
  ready: number;
  blocked: number;
  requiresTier2: boolean;
  transitions: string[];
  items: PreviewItem[];
}

function BatchPlanModal({
  selectedSuggestionIds,
  onClose,
  onDone,
}: {
  selectedSuggestionIds: string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [step, setStep] = useState<"previewing" | "preview" | "planning" | "plan" | "executing" | "done">("previewing");
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [batch, setBatch] = useState<BatchPromotion | null>(null);
  const [summary, setSummary] = useState<{
    total: number; ok: number; blocked: number; requiresTier2: boolean;
    stages: Record<string, number>;
  } | null>(null);
  const [notes, setNotes] = useState("");
  const [ticketRef, setTicketRef] = useState("");
  const [stopOnFailure, setStopOnFailure] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedSafety, setExpandedSafety] = useState<Set<string>>(new Set());

  // Preview on mount
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API}/api/pilot/playbooks/promotions/batch/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ suggestionIds: selectedSuggestionIds }),
        });
        const j = await res.json();
        if (j.ok && j.data) {
          setPreview(j.data);
          setStep("preview");
        } else {
          setError(j.error ?? "Failed to preview batch");
        }
      } catch (e: any) {
        setError(e.message);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePlan = async () => {
    setStep("planning");
    setError(null);
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/promotions/batch/plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suggestionIds: selectedSuggestionIds, notes: notes || undefined, stopOnFailure }),
      });
      const j = await res.json();
      if (j.ok && j.data) {
        setBatch(j.data.batch);
        setSummary(j.data.summary);
        setStep("plan");
      } else {
        setError(j.error ?? "Failed to plan batch");
        setStep("preview");
      }
    } catch (e: any) {
      setError(e.message);
      setStep("preview");
    }
  };

  const handleApprove = async () => {
    if (!batch) return;
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/promotions/batch/${batch.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Approved via UI" }),
      });
      const j = await res.json();
      if (j.ok && j.data) {
        setBatch(j.data);
      } else {
        setError(j.error ?? "Failed to approve batch");
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleDeny = async () => {
    if (!batch) return;
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/promotions/batch/${batch.id}/deny`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Denied via UI" }),
      });
      const j = await res.json();
      if (j.ok && j.data) {
        setBatch(j.data);
        setStep("done");
      } else {
        setError(j.error ?? "Failed to deny batch");
      }
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleExecute = async () => {
    if (!batch) return;
    setStep("executing");
    setError(null);
    try {
      const nonce = crypto.randomUUID();
      const res = await fetch(`${API}/api/pilot/playbooks/promotions/batch/${batch.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopOnFailure,
          changeTicketRef: ticketRef || undefined,
          executeNonce: nonce,
        }),
      });
      const j = await res.json();
      if (j.ok && j.data) {
        if (j.data.alreadyRunning) {
          setError("Batch is already running — polling for updates…");
        } else if (j.data.alreadyFinished) {
          setBatch(j.data.batch);
          setStep("done");
          return;
        }
        setBatch(j.data.batch);
        setStep("done");
      } else {
        setError(j.error ?? "Execution failed");
        setStep("plan");
      }
    } catch (e: any) {
      setError(e.message);
      setStep("plan");
    }
  };

  const handleRetry = async () => {
    if (!batch) return;
    setStep("executing");
    setError(null);
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/promotions/batch/${batch.id}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stopOnFailure,
          changeTicketRef: ticketRef || undefined,
        }),
      });
      const j = await res.json();
      if (j.ok && j.data) {
        setBatch(j.data.batch);
        setStep("done");
      } else {
        setError(j.error ?? "Retry failed");
        setStep("done");
      }
    } catch (e: any) {
      setError(e.message);
      setStep("done");
    }
  };

  const isApproved = batch?.status === "PLANNED";
  const needsApproval = batch?.status === "WAITING_APPROVAL";
  const isRunning = batch?.status === "RUNNING";
  const isRetryable = batch?.status === "PARTIAL" || batch?.status === "FAILED";
  const isDone = batch?.status === "SUCCEEDED" || batch?.status === "PARTIAL" || batch?.status === "FAILED" || batch?.status === "CANCELED";
  const needsTicket = batch?.items.some(i => i.toStage === "LOCKED");

  /* Poll batch while RUNNING */
  useEffect(() => {
    if (!batch || !isRunning) return;
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`${API}/api/pilot/playbooks/promotions/batch/${batch.id}`);
        const j = await res.json();
        if (j.ok && j.data) {
          setBatch(j.data);
          if (j.data.status !== "RUNNING") {
            setStep("done");
          }
        }
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(iv);
  }, [batch?.id, isRunning]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12,
        padding: 24, width: 580, maxHeight: "85vh", overflow: "auto",
      }} onClick={e => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 16, color: "var(--fg-bright)" }}>
          Batch Promotion
          {batch && batch.executionAttempt > 0 && (
            <span style={{ fontSize: 11, color: "var(--fg-dim)", fontWeight: 400, marginLeft: 8 }}>
              Attempt #{batch.executionAttempt}
            </span>
          )}
        </h3>
        {batch && (batch.startedAt || batch.finishedAt) && (
          <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 4, display: "flex", gap: 12 }}>
            {batch.startedAt && <span>Started: {fmtDate(batch.startedAt)}</span>}
            {batch.finishedAt && <span>Finished: {fmtDate(batch.finishedAt)}</span>}
          </div>
        )}
        {batch?.runRef && (
          <div style={{ marginTop: 4 }}>
            <a
              href={`/pilot/ops/runs/${batch.runRef}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: 11, color: "#569cd6", textDecoration: "underline" }}
            >
              Open batch timeline →
            </a>
          </div>
        )}

        {/* Preview loading spinner */}
        {step === "previewing" && !error && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--fg-dim)", fontSize: 13 }}>
            Evaluating preflight gates for {selectedSuggestionIds.length} item(s)…
          </div>
        )}

        {/* Planning spinner */}
        {step === "planning" && !error && (
          <div style={{ padding: 24, textAlign: "center", color: "var(--fg-dim)", fontSize: 13 }}>
            Creating batch plan…
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{
            marginTop: 12, padding: 12, borderRadius: 8,
            background: "rgba(241,76,76,0.1)", border: "1px solid rgba(241,76,76,0.3)",
            fontSize: 12, color: "#f14c4c",
          }}>
            {error}
          </div>
        )}

        {/* ── Preview (dry-run) section ── */}
        {preview && step === "preview" && (
          <>
            {/* Summary card */}
            <div style={{
              marginTop: 16, padding: 14, borderRadius: 8,
              background: "rgba(255,255,255,0.03)", border: "1px solid var(--border)",
              fontSize: 12, color: "var(--fg)", lineHeight: 1.6,
            }}>
              This batch will promote <strong style={{ color: "var(--fg-bright)" }}>{preview.total}</strong> playbook(s)
              {" "}(<strong style={{ color: "#4ec9b0" }}>{preview.ready} ready</strong>,{" "}
              <strong style={{ color: preview.blocked > 0 ? "#f14c4c" : "var(--fg-dim)" }}>{preview.blocked} blocked</strong>).
              {" "}Transitions: {preview.transitions.join(", ")}.
              {preview.requiresTier2 && (
                <span style={{
                  marginLeft: 8, fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: "rgba(206,145,120,0.15)", color: "#ce9178", fontWeight: 600,
                }}>
                  Requires Tier 2
                </span>
              )}
            </div>

            {/* Preview items table */}
            <div style={{
              border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
              marginTop: 12, marginBottom: 12,
            }}>
              <div style={{
                display: "grid", gridTemplateColumns: "2.5fr 1.2fr 0.8fr",
                padding: "8px 12px", fontSize: 10, fontWeight: 600,
                color: "var(--fg-dim)", background: "rgba(255,255,255,0.03)",
                borderBottom: "1px solid var(--border)",
              }}>
                <div>Playbook</div>
                <div>Transition</div>
                <div>Gates</div>
              </div>
              {preview.items.map(item => {
                const safetyOpen = expandedSafety.has(item.suggestionId);
                return (
                  <div key={item.suggestionId}>
                    <div style={{
                      display: "grid", gridTemplateColumns: "2.5fr 1.2fr 0.8fr",
                      padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 11,
                    }}>
                      <div>
                        <span style={{ color: "var(--fg-bright)", fontWeight: 500 }}>{item.playbook.name}</span>
                        <span style={{ color: "var(--fg-dim)", fontWeight: 400, marginLeft: 4 }}>v{item.playbook.version}</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        {stageBadge(item.fromStage)}
                        <span style={{ color: "var(--fg-dim)", fontSize: 9 }}>→</span>
                        {stageBadge(item.toStage)}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{ color: item.okToPromote ? "#4ec9b0" : "#f14c4c", fontSize: 10 }}>
                          {item.okToPromote ? "✓ Ready" : "✗ Blocked"}
                        </span>
                        <button
                          onClick={() => {
                            const next = new Set(expandedSafety);
                            if (next.has(item.suggestionId)) next.delete(item.suggestionId);
                            else next.add(item.suggestionId);
                            setExpandedSafety(next);
                          }}
                          style={{
                            background: "none", border: "none", color: "#569cd6",
                            fontSize: 9, cursor: "pointer", padding: 0, textDecoration: "underline",
                          }}
                        >
                          {safetyOpen ? "hide" : "safety"}
                        </button>
                      </div>
                    </div>

                    {/* Primary check headline */}
                    {item.primaryCheck && !item.okToPromote && (
                      <div style={{
                        padding: "2px 12px 6px 12px", fontSize: 10,
                        color: item.primaryCheck.passed ? "#4ec9b0" : "#f14c4c",
                        fontFamily: "var(--mono)",
                      }}>
                        {item.primaryCheck.passed ? "✓" : "✗"} {item.primaryCheck.gate}: {item.primaryCheck.detail}
                      </div>
                    )}

                    {/* Expanded safety + full gates */}
                    {safetyOpen && (
                      <div style={{
                        padding: "8px 12px 8px 12px", background: "rgba(255,255,255,0.02)",
                        borderTop: "1px solid var(--border)",
                      }}>
                        <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 6 }}>
                          <strong>Blast radius:</strong> {item.safety.blastRadius}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 8 }}>
                          <strong>Rollback:</strong> {item.safety.rollbackHint}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          {item.gateReport.map((g, i) => (
                            <div key={i} style={{
                              fontSize: 10, fontFamily: "var(--mono)",
                              color: g.passed ? "#4ec9b0" : "#f14c4c",
                              padding: "1px 0",
                            }}>
                              {g.passed ? "✓" : "✗"} {g.gate}: {g.detail}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Plan controls */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-dim)", cursor: "pointer" }}>
                <input type="checkbox" checked={stopOnFailure} onChange={e => setStopOnFailure(e.target.checked)} />
                Stop on first failure
              </label>

              <input
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="Optional notes…"
                style={{
                  width: "100%", background: "rgba(255,255,255,0.04)",
                  border: "1px solid var(--border)", borderRadius: 6,
                  padding: 8, color: "var(--fg)", fontSize: 12,
                }}
              />

              <button
                onClick={handlePlan}
                disabled={preview.ready === 0}
                style={{
                  background: "var(--accent)", color: "#fff", border: "none",
                  borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600,
                  cursor: preview.ready === 0 ? "not-allowed" : "pointer",
                  opacity: preview.ready === 0 ? 0.5 : 1, alignSelf: "flex-start",
                }}
              >
                Plan Batch ({preview.ready} promotion{preview.ready !== 1 ? "s" : ""})
              </button>
            </div>
          </>
        )}

        {/* Plan view */}
        {batch && (step === "plan" || step === "executing" || step === "done") && (
          <>
            {/* Status badge */}
            <div style={{ marginTop: 12, marginBottom: 16, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 4,
                color: STATUS_COLORS[batch.status] ?? "var(--fg)",
                background: `${STATUS_COLORS[batch.status] ?? "var(--fg)"}18`,
              }}>
                {batch.status}
              </span>
              {batch.requiresTier2 && (
                <span style={{
                  fontSize: 10, padding: "2px 8px", borderRadius: 4,
                  background: "rgba(206,145,120,0.15)", color: "#ce9178",
                }}>
                  Tier 2 Required
                </span>
              )}
            </div>

            {/* Summary */}
            {summary && (
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 16,
              }}>
                {[
                  { label: "Total", value: summary.total, color: "var(--fg-bright)" },
                  { label: "Ready", value: summary.ok, color: "#4ec9b0" },
                  { label: "Blocked", value: summary.blocked, color: summary.blocked > 0 ? "#f14c4c" : "var(--fg-dim)" },
                  { label: "Stages", value: Object.keys(summary.stages).length, color: "var(--fg-dim)" },
                ].map(s => (
                  <div key={s.label} style={{
                    background: "rgba(255,255,255,0.03)", borderRadius: 8, padding: "10px 12px", textAlign: "center",
                  }}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                    <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Stage breakdown */}
            {summary && Object.keys(summary.stages).length > 0 && (
              <div style={{ marginBottom: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
                {Object.entries(summary.stages).map(([k, v]) => (
                  <span key={k} style={{
                    fontSize: 10, padding: "3px 8px", borderRadius: 4,
                    background: "rgba(255,255,255,0.04)", color: "var(--fg-dim)",
                  }}>
                    {k}: {v}
                  </span>
                ))}
              </div>
            )}

            {/* Items list */}
            <div style={{
              border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden", marginBottom: 16,
            }}>
              <div style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 0.8fr",
                padding: "8px 12px", fontSize: 10, fontWeight: 600,
                color: "var(--fg-dim)", background: "rgba(255,255,255,0.03)",
                borderBottom: "1px solid var(--border)",
              }}>
                <div>Playbook</div>
                <div>Transition</div>
                <div>Preflight</div>
                <div>Result</div>
              </div>
              {batch.items.map(item => (
                <div key={item.id} style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 0.8fr",
                  padding: "8px 12px", borderTop: "1px solid var(--border)", fontSize: 11,
                }}>
                  <div style={{ color: "var(--fg-bright)", fontWeight: 500 }}>
                    {item.playbookId.slice(0, 12)}… <span style={{ color: "var(--fg-dim)", fontWeight: 400 }}>v{item.playbookVersion}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {stageBadge(item.fromStage)} <span style={{ color: "var(--fg-dim)", fontSize: 9 }}>→</span> {stageBadge(item.toStage)}
                  </div>
                  <div style={{ color: item.okToPromote ? "#4ec9b0" : "#f14c4c", fontSize: 10 }}>
                    {item.okToPromote ? "✓ Ready" : "✗ Blocked"}
                  </div>
                  <div style={{ fontSize: 10 }}>
                    {item.promoted ? (
                      <span style={{ color: "#4ec9b0" }}>✓ Promoted</span>
                    ) : item.error ? (
                      <span style={{ color: "#f14c4c" }} title={item.error}>✗ Failed</span>
                    ) : (
                      <span style={{ color: "var(--fg-dim)" }}>—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Execution results */}
            {batch.results && (
              <div style={{
                padding: 12, borderRadius: 8, marginBottom: 16,
                background: batch.status === "SUCCEEDED" ? "rgba(78,201,176,0.1)" : batch.status === "PARTIAL" ? "rgba(220,220,170,0.1)" : "rgba(241,76,76,0.1)",
                border: `1px solid ${batch.status === "SUCCEEDED" ? "rgba(78,201,176,0.3)" : batch.status === "PARTIAL" ? "rgba(220,220,170,0.3)" : "rgba(241,76,76,0.3)"}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: STATUS_COLORS[batch.status] ?? "var(--fg)", marginBottom: 6 }}>
                  {batch.status === "SUCCEEDED" ? "All items promoted successfully" :
                   batch.status === "PARTIAL" ? "Partial success" :
                   batch.status === "CANCELED" ? "Batch canceled" : "Batch failed"}
                </div>
                <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--fg-dim)" }}>
                  <span>Promoted: <strong style={{ color: "#4ec9b0" }}>{(batch.results as any).promoted}</strong></span>
                  <span>Failed: <strong style={{ color: "#f14c4c" }}>{(batch.results as any).failed}</strong></span>
                  <span>Skipped: <strong>{(batch.results as any).skipped}</strong></span>
                  {(batch.results as any).stoppedEarly && <span style={{ color: "#ce9178" }}>Stopped early</span>}
                  {(batch.results as any).stuckRecovered && <span style={{ color: "#ce9178" }}>Stuck recovery</span>}
                </div>
                {batch.stuckReason && (
                  <div style={{ marginTop: 6, fontSize: 10, color: "#ce9178" }}>
                    Stuck detected: {batch.stuckReason}
                  </div>
                )}
              </div>
            )}

            {/* Controls */}
            {step !== "done" && !isDone && !isRunning && (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* Stop on failure toggle */}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-dim)", cursor: "pointer" }}>
                  <input type="checkbox" checked={stopOnFailure} onChange={e => setStopOnFailure(e.target.checked)} />
                  Stop on first failure
                </label>

                {/* Change ticket for LOCKED targets */}
                {needsTicket && (
                  <div>
                    <label style={{ fontSize: 11, color: "#dcdcaa", display: "block", marginBottom: 4 }}>
                      Change Ticket Reference (required for LOCKED targets)
                    </label>
                    <input
                      value={ticketRef}
                      onChange={e => setTicketRef(e.target.value)}
                      placeholder="e.g. JIRA-1234"
                      style={{
                        width: "100%", background: "rgba(255,255,255,0.04)",
                        border: "1px solid var(--border)", borderRadius: 6,
                        padding: 8, color: "var(--fg)", fontSize: 12,
                      }}
                    />
                  </div>
                )}

                {/* Action buttons */}
                <div style={{ display: "flex", gap: 8 }}>
                  {needsApproval && (
                    <>
                      <button onClick={handleApprove} style={{
                        background: "#4ec9b0", color: "#1e1e1e", border: "none",
                        borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer",
                      }}>
                        Approve
                      </button>
                      <button onClick={handleDeny} style={{
                        background: "transparent", border: "1px solid #f14c4c",
                        borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600,
                        color: "#f14c4c", cursor: "pointer",
                      }}>
                        Deny
                      </button>
                    </>
                  )}
                  {isApproved && (
                    <button
                      onClick={handleExecute}
                      disabled={step === "executing" || (needsTicket && !ticketRef.trim())}
                      style={{
                        background: "var(--accent)", color: "#fff", border: "none",
                        borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600,
                        cursor: step === "executing" ? "wait" : "pointer",
                        opacity: step === "executing" || (needsTicket && !ticketRef.trim()) ? 0.5 : 1,
                      }}
                    >
                      {step === "executing" ? "Executing…" : `Execute ${summary?.ok ?? 0} promotion(s)`}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Running indicator */}
            {isRunning && (
              <div style={{
                padding: 12, borderRadius: 8, marginBottom: 16,
                background: "rgba(86,156,214,0.1)", border: "1px solid rgba(86,156,214,0.3)",
                fontSize: 12, color: "#569cd6", textAlign: "center",
              }}>
                Executing… polling for updates every 3 s
              </div>
            )}

            {/* Retry button for PARTIAL / FAILED */}
            {isRetryable && (
              <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                <button
                  onClick={handleRetry}
                  disabled={step === "executing"}
                  style={{
                    background: "#dcdcaa", color: "#1e1e1e", border: "none",
                    borderRadius: 6, padding: "8px 20px", fontSize: 13, fontWeight: 600,
                    cursor: step === "executing" ? "wait" : "pointer",
                    opacity: step === "executing" ? 0.5 : 1,
                  }}
                >
                  {step === "executing" ? "Retrying…" : "Retry Failed Items"}
                </button>
              </div>
            )}
          </>
        )}

        <div style={{ marginTop: 16, textAlign: "right" }}>
          <button onClick={isDone || step === "done" ? () => { onDone(); onClose(); } : onClose} style={{
            background: "transparent", border: "1px solid var(--border)",
            borderRadius: 6, padding: "6px 16px", color: "var(--fg-dim)", fontSize: 12, cursor: "pointer",
          }}>
            {isDone || step === "done" ? "Close & Refresh" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main Page ── */

type Tab = "playbooks" | "queue";

export default function PlaybooksPage() {
  const [tab, setTab] = useState<Tab>("playbooks");
  const [playbooks, setPlaybooks] = useState<PlaybookRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PlaybookRow | null>(null);
  const [history, setHistory] = useState<PromotionRecord[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRecord[]>([]);
  const [promoteTarget, setPromoteTarget] = useState<PlaybookRow | null>(null);
  const [queue, setQueue] = useState<SuggestionRecord[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBatchModal, setShowBatchModal] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/pilot/playbooks`)
      .then(r => r.json())
      .then(j => {
        if (j.ok) setPlaybooks(j.data ?? []);
        else setError(j.error ?? "Failed to load playbooks");
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const loadQueue = async () => {
    setQueueLoading(true);
    setSelectedIds(new Set());
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/suggestions/open?limit=100`);
      const j = await res.json();
      if (j.ok) setQueue(j.data ?? []);
    } catch { /* ignore */ }
    setQueueLoading(false);
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === queue.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(queue.map(s => s.id)));
    }
  };

  useEffect(() => {
    if (tab === "queue") loadQueue();
  }, [tab]);

  const loadHistory = async (pbId: string) => {
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/${pbId}/promotions`);
      const j = await res.json();
      if (j.ok) setHistory(j.data ?? []);
    } catch { /* ignore */ }
  };

  const loadSuggestions = async (pbId: string) => {
    try {
      const res = await fetch(`${API}/api/pilot/playbooks/${pbId}/suggestions`);
      const j = await res.json();
      if (j.ok) setSuggestions(j.data ?? []);
      else setSuggestions([]);
    } catch { setSuggestions([]); }
  };

  const dismissSuggestion = async (suggestionId: string) => {
    try {
      await fetch(`${API}/api/pilot/playbooks/suggestions/${suggestionId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setSuggestions(prev => prev.filter(s => s.id !== suggestionId));
    } catch { /* ignore */ }
  };

  const handleRowClick = (pb: PlaybookRow) => {
    setSelected(pb);
    loadHistory(pb.id);
    loadSuggestions(pb.id);
  };

  const handlePromoted = (updated: PlaybookRow) => {
    setPlaybooks(prev => prev.map(p => p.id === updated.id ? updated : p));
    if (selected?.id === updated.id) {
      setSelected(updated);
      loadHistory(updated.id);
      loadSuggestions(updated.id);
    }
    if (tab === "queue") loadQueue();
  };

  const dismissQueueItem = async (suggestionId: string) => {
    try {
      await fetch(`${API}/api/pilot/playbooks/suggestions/${suggestionId}/dismiss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setQueue(prev => prev.filter(s => s.id !== suggestionId));
      setSuggestions(prev => prev.filter(s => s.id !== suggestionId));
    } catch { /* ignore */ }
  };

  if (loading) return <div style={{ padding: 24, color: "var(--fg-dim)" }}>Loading playbooks…</div>;
  if (error) return <div style={{ padding: 24, color: "var(--danger)" }}>Error: {error}</div>;

  return (
    <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <div style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 600, color: "var(--fg-bright)", margin: 0 }}>Mission Playbooks</h1>
        <p style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 4, marginBottom: 0 }}>
          Lifecycle management: DRAFT → TESTED → APPROVED → LOCKED
        </p>
      </div>

      {/* ── Tab Bar ── */}
      <div style={{ display: "flex", gap: 0, marginBottom: 16, borderBottom: "1px solid var(--border)" }}>
        {(["playbooks", "queue"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: "transparent",
              border: "none",
              borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? "var(--fg-bright)" : "var(--fg-dim)",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {t === "playbooks" ? "Playbooks" : `Promotion Queue${queue.length > 0 ? ` (${queue.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* ── Promotion Queue Tab ── */}
      {tab === "queue" && (
        <div>
          {queueLoading && <div style={{ color: "var(--fg-dim)", fontSize: 12, padding: 16 }}>Loading queue…</div>}
          {!queueLoading && queue.length === 0 && (
            <div style={{
              background: "var(--bg-sidebar)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 32,
              textAlign: "center",
              color: "var(--fg-dim)",
              fontSize: 13,
            }}>
              No open promotion suggestions. All playbooks are up to date.
            </div>
          )}

          {/* Select-all bar */}
          {!queueLoading && queue.length > 0 && (
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 16px", marginBottom: 8,
              background: "var(--bg-sidebar)", border: "1px solid var(--border)", borderRadius: 8,
            }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-dim)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={selectedIds.size === queue.length && queue.length > 0}
                  onChange={toggleSelectAll}
                  style={{ accentColor: "var(--accent)" }}
                />
                {selectedIds.size > 0 ? `${selectedIds.size} of ${queue.length} selected` : "Select all"}
              </label>
              {selectedIds.size > 0 && (
                <button
                  onClick={() => setShowBatchModal(true)}
                  style={{
                    background: "var(--accent)", color: "#fff", border: "none",
                    borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Plan Batch ({selectedIds.size})
                </button>
              )}
            </div>
          )}

          {!queueLoading && queue.map(s => {
            const pbName = s.playbook?.name ?? s.playbookId.slice(0, 8);
            const pbVersion = s.playbook?.version ?? "?";
            const isChecked = selectedIds.has(s.id);
            return (
              <div key={s.id} style={{
                background: "var(--bg-sidebar)",
                border: isChecked ? "1px solid var(--accent)" : "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 12,
                transition: "border-color 0.15s",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSelection(s.id)}
                      style={{ marginTop: 3, accentColor: "var(--accent)" }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--fg-bright)" }}>{pbName}</div>
                      <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 2 }}>v{pbVersion}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {stageBadge(s.fromStage)} <span style={{ color: "var(--fg-dim)", fontSize: 11 }}>→</span> {stageBadge(s.toStage)}
                  </div>
                </div>

                {/* Headline */}
                {s.headline && (
                  <div style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#4ec9b0",
                    marginBottom: 6,
                  }}>
                    {s.headline}
                  </div>
                )}

                {/* Primary check one-liner */}
                {s.primaryCheck && (
                  <div style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: s.primaryCheck.passed ? "#4ec9b0" : "#f14c4c",
                    marginBottom: 8,
                  }}>
                    {s.primaryCheck.passed ? "✓" : "✗"} {s.primaryCheck.gate}: {s.primaryCheck.detail}
                  </div>
                )}

                {/* Expandable gate report */}
                <details style={{ marginBottom: 10 }}>
                  <summary style={{ fontSize: 11, color: "var(--fg-dim)", cursor: "pointer", userSelect: "none" }}>
                    Gate report ({s.gateReport.length} checks)
                  </summary>
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                    {s.gateReport.map((g, i) => (
                      <div key={i} style={{
                        fontSize: 10,
                        fontFamily: "var(--mono)",
                        color: g.passed ? "#4ec9b0" : "#f14c4c",
                      }}>
                        {g.passed ? "✓" : "✗"} {g.gate}: {g.detail}
                      </div>
                    ))}
                  </div>
                </details>

                {/* Metadata */}
                <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 8, display: "flex", gap: 12 }}>
                  <span>Suggested {fmtDate(s.createdAt)}</span>
                  {s.lastEvaluatedAt && <span>Last verified {fmtDate(s.lastEvaluatedAt)}</span>}
                  {s.expiresAt && <span>Expires {fmtDate(s.expiresAt)}</span>}
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => {
                      // Find or create a minimal PlaybookRow to promote
                      const pb = playbooks.find(p => p.id === s.playbookId);
                      if (pb) setPromoteTarget(pb);
                    }}
                    style={{
                      background: "#4ec9b0",
                      color: "#1e1e1e",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Promote now
                  </button>
                  <button
                    onClick={() => dismissQueueItem(s.id)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "6px 16px",
                      fontSize: 12,
                      color: "var(--fg-dim)",
                      cursor: "pointer",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}

          {/* Sticky selection footer */}
          {selectedIds.size > 0 && !queueLoading && (
            <div style={{
              position: "sticky", bottom: 0,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "12px 16px", marginTop: 8,
              background: "var(--bg-sidebar)", border: "1px solid var(--accent)", borderRadius: 8,
              boxShadow: "0 -2px 12px rgba(0,0,0,0.3)",
            }}>
              <span style={{ fontSize: 12, color: "var(--fg-bright)", fontWeight: 600 }}>
                {selectedIds.size} suggestion(s) selected
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  style={{
                    background: "transparent", border: "1px solid var(--border)",
                    borderRadius: 6, padding: "6px 16px", fontSize: 12, color: "var(--fg-dim)", cursor: "pointer",
                  }}
                >
                  Clear
                </button>
                <button
                  onClick={() => setShowBatchModal(true)}
                  style={{
                    background: "var(--accent)", color: "#fff", border: "none",
                    borderRadius: 6, padding: "6px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  Plan Batch ({selectedIds.size})
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Playbooks Tab ── */}
      {tab === "playbooks" && (
      <div style={{ display: "grid", gridTemplateColumns: selected ? "1fr 1fr" : "1fr", gap: 16 }}>
        {/* ── Playbooks Table ── */}
        <div style={{
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          overflow: "hidden",
        }}>
          <div style={{
            display: "grid",
            gridTemplateColumns: "2fr 0.8fr 0.8fr 0.5fr 0.6fr",
            gap: 8,
            padding: "10px 16px",
            fontSize: 11,
            fontWeight: 600,
            color: "var(--fg-dim)",
            background: "rgba(255,255,255,0.03)",
            borderBottom: "1px solid var(--border)",
          }}>
            <div>Name</div>
            <div>Category</div>
            <div>Stage</div>
            <div style={{ textAlign: "center" }}>Ver</div>
            <div style={{ textAlign: "right" }}>Steps</div>
          </div>

          {playbooks.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-dim)" }}>No playbooks yet.</div>
          )}

          {playbooks.map(pb => (
            <div
              key={pb.id}
              onClick={() => handleRowClick(pb)}
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 0.8fr 0.8fr 0.5fr 0.6fr",
                gap: 8,
                padding: "10px 16px",
                borderTop: "1px solid var(--border)",
                cursor: "pointer",
                background: selected?.id === pb.id ? "rgba(0,120,212,0.08)" : "transparent",
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { if (selected?.id !== pb.id) e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={e => { if (selected?.id !== pb.id) e.currentTarget.style.background = "transparent"; }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: "var(--fg-bright)" }}>{pb.name}</div>
                <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 2 }}>
                  {pb.description.slice(0, 60)}{pb.description.length > 60 ? "…" : ""}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-dim)", display: "flex", alignItems: "center" }}>
                {pb.category}
              </div>
              <div style={{ display: "flex", alignItems: "center" }}>{stageBadge(pb.stage ?? "DRAFT")}</div>
              <div style={{ fontSize: 12, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--fg-dim)" }}>
                v{pb.version}
              </div>
              <div style={{ fontSize: 12, textAlign: "right", display: "flex", alignItems: "center", justifyContent: "flex-end", color: "var(--fg-dim)" }}>
                {pb.stepCount}
              </div>
            </div>
          ))}
        </div>

        {/* ── Detail Panel ── */}
        {selected && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Stage + Promote */}
            <div style={{
              background: "var(--bg-sidebar)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              padding: 16,
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "var(--fg-bright)" }}>{selected.name}</div>
                  <div style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 2 }}>{selected.category} • v{selected.version}</div>
                </div>
                {stageBadge(selected.stage ?? "DRAFT")}
              </div>

              <div style={{ fontSize: 12, color: "var(--fg)", marginBottom: 12 }}>{selected.description}</div>

              {selected.tags.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 12 }}>
                  {selected.tags.map(t => (
                    <span key={t} style={{
                      fontSize: 10,
                      padding: "2px 8px",
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: 4,
                      color: "var(--fg-dim)",
                    }}>
                      {t}
                    </span>
                  ))}
                </div>
              )}

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                  Min Trust: <span style={{ fontFamily: "var(--mono)", color: "var(--fg-bright)" }}>{selected.minTrustScore}</span>
                </div>
                {selected.stage !== "LOCKED" && (
                  <button
                    onClick={() => setPromoteTarget(selected)}
                    style={{
                      background: "var(--accent)",
                      color: "#fff",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                      marginLeft: "auto",
                    }}
                  >
                    Promote →
                  </button>
                )}
              </div>
            </div>

            {/* Suggestion Banner */}
            {suggestions.length > 0 && suggestions.map(s => (
              <div key={s.id} style={{
                background: "rgba(78, 201, 176, 0.08)",
                border: "1px solid rgba(78, 201, 176, 0.3)",
                borderRadius: 12,
                padding: 16,
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 16 }}>✅</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#4ec9b0" }}>
                    {s.headline ?? "Ready to promote"}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                    {stageBadge(s.fromStage)} → {stageBadge(s.toStage)}
                  </span>
                </div>

                {/* Primary check one-liner */}
                {s.primaryCheck && (
                  <div style={{
                    fontSize: 11,
                    fontFamily: "var(--mono)",
                    color: s.primaryCheck.passed ? "#4ec9b0" : "#f14c4c",
                    marginBottom: 8,
                    padding: "3px 8px",
                    background: "rgba(255,255,255,0.03)",
                    borderRadius: 4,
                    display: "inline-block",
                  }}>
                    {s.primaryCheck.passed ? "✓" : "✗"} {s.primaryCheck.gate}: {s.primaryCheck.detail}
                  </div>
                )}

                {/* Metadata */}
                <div style={{ fontSize: 10, color: "var(--fg-dim)", marginBottom: 8, display: "flex", gap: 12 }}>
                  {s.lastEvaluatedAt && <span>Verified {fmtDate(s.lastEvaluatedAt)}</span>}
                  {s.expiresAt && <span>Expires {fmtDate(s.expiresAt)}</span>}
                </div>

                {/* Gate report (collapsed) */}
                <details style={{ marginBottom: 10 }}>
                  <summary style={{
                    fontSize: 11,
                    color: "var(--fg-dim)",
                    cursor: "pointer",
                    userSelect: "none",
                  }}>
                    Full gate report ({s.gateReport.length} checks)
                  </summary>
                  <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                    {s.gateReport.map((g, i) => (
                      <div key={i} style={{
                        fontSize: 10,
                        fontFamily: "var(--mono)",
                        color: g.passed ? "#4ec9b0" : "#f14c4c",
                      }}>
                        {g.passed ? "✓" : "✗"} {g.gate}: {g.detail}
                      </div>
                    ))}
                  </div>
                </details>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => setPromoteTarget(selected)}
                    style={{
                      background: "#4ec9b0",
                      color: "#1e1e1e",
                      border: "none",
                      borderRadius: 6,
                      padding: "6px 16px",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Promote now
                  </button>
                  <button
                    onClick={() => dismissSuggestion(s.id)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      padding: "6px 16px",
                      fontSize: 12,
                      color: "var(--fg-dim)",
                      cursor: "pointer",
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}

            {/* Promotion History */}
            <div style={{
              background: "var(--bg-sidebar)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              overflow: "hidden",
            }}>
              <div style={{
                padding: "10px 16px",
                fontSize: 13,
                fontWeight: 600,
                color: "var(--fg-bright)",
                background: "rgba(255,255,255,0.03)",
                borderBottom: "1px solid var(--border)",
              }}>
                Promotion History
              </div>

              {history.length === 0 && (
                <div style={{ padding: 16, fontSize: 12, color: "var(--fg-dim)" }}>No promotion attempts yet.</div>
              )}

              {history.map(h => (
                <div key={h.id} style={{ padding: "10px 16px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {stageBadge(h.fromStage)} <span style={{ color: "var(--fg-dim)", fontSize: 11 }}>→</span> {stageBadge(h.toStage)}
                      <span style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: h.decision === "PROMOTED" ? "#4ec9b0" : "#f14c4c",
                      }}>
                        {h.decision}
                      </span>
                    </div>
                    <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>{fmtDate(h.createdAt)}</span>
                  </div>
                  {h.notes && (
                    <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 4 }}>{h.notes}</div>
                  )}
                  {h.changeTicketRef && (
                    <div style={{ fontSize: 11, color: "#569cd6", marginTop: 2 }}>Ticket: {h.changeTicketRef}</div>
                  )}
                  {h.gateReport && h.gateReport.length > 0 && (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
                      {h.gateReport.map((g, i) => (
                        <div key={i} style={{
                          fontSize: 10,
                          fontFamily: "var(--mono)",
                          color: g.passed ? "#4ec9b0" : "#f14c4c",
                        }}>
                          {g.passed ? "✓" : "✗"} {g.gate}: {g.detail}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      )}

      {/* ── Promote Modal ── */}
      {promoteTarget && (
        <PromoteDialog
          playbook={promoteTarget}
          onClose={() => setPromoteTarget(null)}
          onPromoted={handlePromoted}
        />
      )}

      {/* ── Batch Promotion Modal ── */}
      {showBatchModal && selectedIds.size > 0 && (
        <BatchPlanModal
          selectedSuggestionIds={Array.from(selectedIds)}
          onClose={() => setShowBatchModal(false)}
          onDone={() => {
            setSelectedIds(new Set());
            loadQueue();
            // Also refresh playbooks list to reflect stage changes
            fetch(`${API}/api/pilot/playbooks`)
              .then(r => r.json())
              .then(j => { if (j.ok) setPlaybooks(j.data ?? []); })
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
