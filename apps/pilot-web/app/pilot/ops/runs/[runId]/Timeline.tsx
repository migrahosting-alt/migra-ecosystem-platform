"use client";

import { useMemo, useState } from "react";

/* ── Helpers ── */
function pretty(obj: any) { return JSON.stringify(obj, null, 2); }
function fmtDate(s: string) { return new Date(s).toLocaleString(); }

function levelColor(level: string) {
  switch (level) {
    case "ERROR": case "FATAL": return "var(--danger)";
    case "WARN": return "var(--warning)";
    case "DEBUG": return "var(--fg-dim)";
    default: return "var(--fg)";
  }
}

function eventIcon(type: string) {
  const icons: Record<string, string> = {
    CONTEXT_SNAPSHOT: "📸",
    LLM_REQUEST: "🧠",
    LLM_RESPONSE: "💬",
    TOOL_CALL: "🔧",
    TOOL_RESULT: "✅",
    EXCEPTION: "💥",
    ERROR: "❌",
    PHASE_CHANGE: "🔄",
    POLICY_DECISION: "🛡️",
    ESCALATION: "⬆️",
    VERIFICATION: "🔍",
    MEMORY_UPDATE: "💾",
    BUDGET_WARNING: "⚠️",
    DEGRADED_MODE: "🟡",
    RAG_LOOKUP: "📚",
    DEPLOY_STARTED: "🚀",
  };
  return icons[type] ?? "📎";
}

/* ── Types ── */
interface EventRow {
  id: string;
  seq: number;
  type: string;
  level: string;
  message: string;
  payload: any;
  durationMs: number | null;
  spanId?: string | null;
  parentSpanId?: string | null;
  ts: string;
}

interface SpanGroup {
  key: string;
  spanId?: string;
  label: string;
  items: EventRow[];
}

/* ── Building span groups ── */
function buildGroups(events: EventRow[]): SpanGroup[] {
  const out: SpanGroup[] = [];
  const bySpan = new Map<string, SpanGroup>();

  for (const e of events) {
    if (e.spanId) {
      if (!bySpan.has(e.spanId)) {
        const group: SpanGroup = {
          key: e.spanId,
          spanId: e.spanId,
          label: e.payload?.span ?? e.type,
          items: [],
        };
        bySpan.set(e.spanId, group);
        out.push(group);
      }
      bySpan.get(e.spanId)!.items.push(e);
    } else {
      out.push({ key: e.id, label: e.type, items: [e] });
    }
  }
  return out;
}

/* ── Main Timeline component ── */
export function Timeline({ events }: { events: EventRow[] }) {
  const groups = useMemo(() => buildGroups(events), [events]);

  return (
    <div>
      {groups.map((g) => (
        <SpanGroupRow key={g.key} group={g} />
      ))}
    </div>
  );
}

/* ── Single span group (collapsible if multi-event) ── */
function SpanGroupRow({ group }: { group: SpanGroup }) {
  const multi = group.items.length > 1;
  const [open, setOpen] = useState(!multi);

  const first = group.items[0];
  const last = group.items[group.items.length - 1];

  // Compute aggregate duration from first → last item
  const hasError = group.items.some((e) => e.level === "ERROR" || e.level === "FATAL");
  const totalDuration = group.items.reduce((acc, e) => acc + (e.durationMs ?? 0), 0);

  return (
    <div style={{ borderTop: "1px solid var(--border)" }}>
      {/* Header row — always visible */}
      <div
        onClick={() => multi && setOpen((v) => !v)}
        style={{
          padding: "10px 16px",
          cursor: multi ? "pointer" : "default",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {multi && (
            <span style={{
              fontSize: 10,
              color: "var(--fg-dim)",
              fontFamily: "var(--mono)",
              transition: "transform 0.15s",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
              display: "inline-block",
            }}>
              ▶
            </span>
          )}
          <span style={{ fontSize: 14 }}>{eventIcon(first.type)}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: hasError ? "var(--danger)" : "var(--fg-bright)" }}>
            {group.spanId ? group.label : first.type}
          </span>
          <span style={{ fontSize: 11, color: levelColor(first.level) }}>({first.level})</span>
          {multi && (
            <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
              • {group.items.length} events
            </span>
          )}
          {totalDuration > 0 && (
            <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>
              {totalDuration}ms
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-dim)", fontFamily: "var(--mono)" }}>
          #{first.seq}{multi ? `–${last.seq}` : ""} • {fmtDate(first.ts)}
        </div>
      </div>

      {/* Summary message for collapsed groups */}
      {!open && multi && (
        <div style={{ padding: "0 16px 8px 46px", fontSize: 12, color: "var(--fg)" }}>
          {first.message}
        </div>
      )}

      {/* Expanded events */}
      {open && (
        <div style={{ padding: "0 16px 12px 16px" }}>
          {group.items.map((e) => (
            <EventCard key={e.id} event={e} nested={multi} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Single event card ── */
function EventCard({ event: e, nested }: { event: EventRow; nested: boolean }) {
  const [showPayload, setShowPayload] = useState(false);
  const hasPayload = e.payload != null && Object.keys(e.payload).length > 0;

  return (
    <div style={{
      background: nested ? "rgba(255,255,255,0.02)" : "transparent",
      border: nested ? "1px solid var(--border)" : "none",
      borderRadius: nested ? 8 : 0,
      padding: nested ? "8px 12px" : "4px 0",
      marginTop: nested ? 6 : 0,
    }}>
      <div
        onClick={() => hasPayload && setShowPayload((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: hasPayload ? "pointer" : "default",
          gap: 8,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>{eventIcon(e.type)}</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg-bright)" }}>{e.type}</span>
          <span style={{ fontSize: 11, color: levelColor(e.level) }}>({e.level})</span>
          {e.durationMs != null && (
            <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>{e.durationMs}ms</span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--fg-dim)", fontFamily: "var(--mono)" }}>
          #{e.seq} • {fmtDate(e.ts)}
        </div>
      </div>
      <div style={{ fontSize: 12, color: "var(--fg)", marginTop: 4 }}>{e.message}</div>
      {hasPayload && showPayload && (
        <pre style={{
          fontSize: 11,
          fontFamily: "var(--mono)",
          background: "rgba(255,255,255,0.03)",
          borderRadius: 6,
          padding: 10,
          marginTop: 8,
          overflow: "auto",
          maxHeight: 260,
          color: "var(--fg-dim)",
          whiteSpace: "pre-wrap",
        }}>
          {pretty(e.payload)}
        </pre>
      )}
    </div>
  );
}
