"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { fetchRunDetail, type V1RunDetail, type V1RunEvent } from "@/lib/api/pilotV1";

const STATUS_COLOR: Record<string, string> = {
  COMPLETED: "var(--ok)",
  FAILED: "var(--danger)",
  DENIED: "var(--warn)",
  EXECUTING: "var(--accent)",
  VERIFYING: "var(--accent)",
  REQUESTED: "var(--fg-dim)",
  VALIDATING: "var(--fg-dim)",
};

const LEVEL_COLOR: Record<string, string> = {
  info: "var(--accent)",
  warn: "var(--warn)",
  error: "var(--danger)",
  debug: "var(--fg-dim)",
};

function formatMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "short",
      hour12: false,
    });
  } catch {
    return ts;
  }
}

export default function RunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [run, setRun] = useState<V1RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchRunDetail(runId)
      .then((r) => {
        if (r.ok) setRun(r.run);
        else setError("Run not found");
      })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [runId]);

  if (loading) {
    return (
      <section style={{ padding: 24 }}>
        <p style={{ color: "var(--fg-dim)" }}>Loading run…</p>
      </section>
    );
  }

  if (error || !run) {
    return (
      <section style={{ padding: 24 }}>
        <div style={{ color: "var(--danger)" }}>{error ?? "Run not found"}</div>
        <Link href="/pilot/runs" style={{ color: "var(--accent)", fontSize: 13, marginTop: 12, display: "inline-block" }}>
          ← Back to runs
        </Link>
      </section>
    );
  }

  const statusColor = STATUS_COLOR[run.status] ?? "var(--fg-dim)";

  return (
    <section style={{ padding: 20, maxWidth: 900, margin: "0 auto" }}>
      {/* Breadcrumb */}
      <div style={{ display: "flex", gap: 8, fontSize: 12, color: "var(--fg-dim)", marginBottom: 16 }}>
        <Link href="/pilot" style={{ color: "var(--accent)" }}>Pilot</Link>
        <span>/</span>
        <Link href="/pilot/runs" style={{ color: "var(--accent)" }}>Runs</Link>
        <span>/</span>
        <span style={{ color: "var(--text-secondary)", fontFamily: "var(--mono)" }}>
          {run.id.slice(0, 8)}…
        </span>
      </div>

      {/* Run header */}
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 20,
        marginBottom: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <span style={{
            width: 12,
            height: 12,
            borderRadius: "50%",
            background: statusColor,
          }} />
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: "var(--text)", fontFamily: "var(--mono)" }}>
            {run.command}
          </h2>
          <span style={{
            fontSize: 12,
            fontWeight: 600,
            color: statusColor,
            background: `${statusColor}18`,
            padding: "3px 10px",
            borderRadius: 6,
            marginLeft: "auto",
          }}>
            {run.status}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
          <MetadataCell label="Run ID" value={run.id.slice(0, 12) + "…"} mono />
          <MetadataCell label="Actor" value={run.actorId} />
          <MetadataCell label="Risk Tier" value={String(run.riskTier ?? "—")} />
          <MetadataCell label="Capability" value={run.capability ?? "—"} />
          <MetadataCell label="Duration" value={formatMs(run.durationMs)} />
          <MetadataCell label="Dry Run" value={run.dryRun ? "Yes" : "No"} />
          <MetadataCell label="Started" value={formatTimestamp(run.startedAt)} />
          <MetadataCell label="Ended" value={run.endedAt ? formatTimestamp(run.endedAt) : "—"} />
        </div>

        {run.error && (
          <div style={{
            marginTop: 12,
            background: "var(--danger-bg)",
            border: "1px solid var(--danger)",
            borderRadius: 8,
            padding: 10,
            fontSize: 12,
            color: "var(--danger)",
            fontFamily: "var(--mono)",
          }}>
            {run.error}
          </div>
        )}
      </div>

      {/* Result */}
      {run.result != null && (
        <div style={{
          background: "var(--panel)",
          border: "1px solid var(--line)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 20,
        }}>
          <h3 style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
            Result
          </h3>
          <pre style={{
            margin: 0,
            padding: 12,
            background: "var(--bg-surface)",
            borderRadius: 8,
            fontSize: 11,
            fontFamily: "var(--mono)",
            color: "var(--text)",
            overflow: "auto",
            maxHeight: 400,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}>
            {typeof run.result === "string" ? run.result : JSON.stringify(run.result, null, 2)}
          </pre>
        </div>
      )}

      {/* Events timeline */}
      <div style={{
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 12,
        padding: 16,
      }}>
        <h3 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: 0.5 }}>
          Event Timeline ({run.events.length} events)
        </h3>

        {run.events.length === 0 ? (
          <p style={{ color: "var(--fg-dim)", fontSize: 13, margin: 0 }}>No events recorded.</p>
        ) : (
          <div style={{ position: "relative", paddingLeft: 24 }}>
            {/* Timeline line */}
            <div style={{
              position: "absolute",
              left: 7,
              top: 4,
              bottom: 4,
              width: 2,
              background: "var(--line)",
            }} />

            {run.events.map((evt) => (
              <EventRow key={evt.id} event={evt} />
            ))}
          </div>
        )}
      </div>

      {/* Artifact count */}
      {run.artifactCount > 0 && (
        <div style={{ marginTop: 12, fontSize: 12, color: "var(--fg-dim)" }}>
          {run.artifactCount} artifact{run.artifactCount !== 1 ? "s" : ""} stored
        </div>
      )}
    </section>
  );
}

/* ── Sub-components ── */

function MetadataCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--fg-dim)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", fontFamily: mono ? "var(--mono)" : "inherit" }}>{value}</div>
    </div>
  );
}

function EventRow({ event }: { event: V1RunEvent }) {
  const levelColor = LEVEL_COLOR[event.level] ?? "var(--fg-dim)";
  const [expanded, setExpanded] = useState(false);
  const hasPayload = event.payload != null && Object.keys(event.payload as Record<string, unknown>).length > 0;

  return (
    <div style={{ position: "relative", marginBottom: 12 }}>
      {/* Dot */}
      <div style={{
        position: "absolute",
        left: -20,
        top: 4,
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: levelColor,
        border: "2px solid var(--bg)",
      }} />

      <div style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        cursor: hasPayload ? "pointer" : "default",
      }}
        onClick={() => hasPayload && setExpanded(!expanded)}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{
              fontSize: 9,
              fontWeight: 600,
              textTransform: "uppercase",
              color: levelColor,
              letterSpacing: 0.5,
            }}>
              {event.level}
            </span>
            <span style={{
              fontSize: 10,
              fontFamily: "var(--mono)",
              color: "var(--text-secondary)",
              background: "var(--bg-surface)",
              padding: "1px 6px",
              borderRadius: 3,
            }}>
              {event.type}
            </span>
            {event.durationMs != null && (
              <span style={{ fontSize: 10, color: "var(--fg-dim)" }}>
                {formatMs(event.durationMs)}
              </span>
            )}
            <span style={{ fontSize: 10, color: "var(--fg-dim)", marginLeft: "auto" }}>
              {formatTimestamp(event.timestamp)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text)", marginTop: 3 }}>
            {event.message}
          </div>
        </div>
        {hasPayload && (
          <span style={{ fontSize: 10, color: "var(--fg-dim)", flexShrink: 0, marginTop: 2 }}>
            {expanded ? "▼" : "▶"}
          </span>
        )}
      </div>

      {expanded && hasPayload && (
        <pre style={{
          marginTop: 6,
          padding: 10,
          background: "var(--bg-surface)",
          borderRadius: 6,
          fontSize: 10,
          fontFamily: "var(--mono)",
          color: "var(--text-secondary)",
          overflow: "auto",
          maxHeight: 200,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {JSON.stringify(event.payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
