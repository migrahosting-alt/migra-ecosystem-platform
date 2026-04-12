"use client";

import { useEffect, useRef, useState } from "react";

interface ActivityEvent {
  eventId: string;
  ts: string;
  kind: string;
  icon: "ok" | "warn" | "info" | "danger" | "thinking";
  title: string;
  detail?: string;
  missionId?: string;
  findingId?: string;
  confidence?: number;
  delta?: number;
  suggestion?: string;
  riskLevel?: "info" | "warn" | "critical";
}

function iconColor(icon: ActivityEvent["icon"]): string {
  if (icon === "ok") return "var(--ok)";
  if (icon === "warn") return "var(--warn)";
  if (icon === "danger") return "var(--danger)";
  if (icon === "thinking") return "var(--accent)";
  return "var(--muted)";
}

function iconGlyph(icon: ActivityEvent["icon"]): string {
  if (icon === "ok") return "✔";
  if (icon === "warn") return "⚠";
  if (icon === "danger") return "✖";
  if (icon === "thinking") return "→";
  return "·";
}

function deltaColor(delta: number): string {
  if (delta > 0.005) return "var(--ok)";
  if (delta < -0.1) return "var(--danger)";
  return "var(--warn)";
}

function formatDelta(delta: number): string {
  const pct = (Math.abs(delta) * 100).toFixed(0);
  return delta >= 0 ? `+${pct}%` : `-${pct}%`;
}

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - Date.parse(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const POLL_INTERVAL_MS = 5000;
const MAX_SPARKLINE = 8;

function ConfidenceSparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const h = 16;
  const w = values.length * 8;
  const pts = values
    .map((v, i) => `${i * 8},${h - Math.round(v * h)}`)
    .join(" ");
  const latest = values[values.length - 1];
  const color = latest < 0.4 ? "var(--danger)" : latest < 0.7 ? "var(--warn)" : "var(--ok)";
  return (
    <svg width={w} height={h + 2} style={{ display: "block", marginTop: 3 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
    </svg>
  );
}

export function ActivityFeed() {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [confidenceHistory, setConfidenceHistory] = useState<number[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function fetchFeed() {
    try {
      const res = await fetch("/api/activity/feed?limit=50", { cache: "no-store" });
      if (!res.ok) return;
      const payload = (await res.json()) as { ok: boolean; data?: { events: ActivityEvent[] } };
      if (payload.ok && payload.data) {
        setEvents(payload.data.events);
        setConnected(true);
        // Update sparkline from confidence_changed events (oldest first)
        const confEvents = [...payload.data.events]
          .reverse()
          .filter((e) => e.kind === "confidence_changed" && e.confidence !== undefined)
          .slice(-MAX_SPARKLINE)
          .map((e) => e.confidence as number);
        if (confEvents.length > 0) {
          setConfidenceHistory(confEvents);
        }
      }
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    void fetchFeed();
    intervalRef.current = setInterval(() => void fetchFeed(), POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return (
    <aside className="activity-sidebar">
      <div className="panel-header" style={{ padding: "12px 14px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 14 }}>📡</span>
            <span style={{ fontWeight: 600, fontSize: 13 }}>Activity</span>
          </div>
          {confidenceHistory.length >= 2 ? (
            <ConfidenceSparkline values={confidenceHistory} />
          ) : null}
        </div>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "2px 8px",
            borderRadius: 10,
            background: connected ? "rgba(52, 211, 153, 0.12)" : "rgba(255,255,255,0.06)",
            color: connected ? "var(--ok)" : "var(--muted)",
          }}
        >
          {connected ? "● live" : "○ connecting"}
        </span>
      </div>

      {events.length === 0 ? (
        <div style={{
          padding: 20, textAlign: "center", color: "var(--muted)", fontSize: 12
        }}>
          No activity yet
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {events.map((event) => (
            <li
              key={event.eventId}
              className="fade-in"
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid var(--line)",
                display: "grid",
                gridTemplateColumns: "20px 1fr",
                gap: 8,
                transition: "background 160ms ease",
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 700,
                  background:
                    event.icon === "ok" ? "rgba(52, 211, 153, 0.12)" :
                    event.icon === "warn" ? "rgba(251, 191, 36, 0.12)" :
                    event.icon === "danger" ? "rgba(248, 113, 113, 0.12)" :
                    "rgba(56, 189, 248, 0.1)",
                  color: iconColor(event.icon),
                }}
              >
                {iconGlyph(event.icon)}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.35, color: "var(--text)" }}>
                  {event.title}
                </div>
                {event.detail ? (
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      marginTop: 3,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      maxWidth: 200
                    }}
                    title={event.detail}
                  >
                    {event.detail}
                  </div>
                ) : null}
                {event.confidence !== undefined ? (
                  <div style={{
                    fontSize: 11, color: "var(--muted)", marginTop: 3,
                    display: "flex", alignItems: "center", gap: 6
                  }}>
                    <span>conf {(event.confidence * 100).toFixed(0)}%</span>
                    {event.delta !== undefined && Math.abs(event.delta) >= 0.005 ? (
                      <span style={{ color: deltaColor(event.delta), fontWeight: 600 }}>
                        {formatDelta(event.delta)}
                      </span>
                    ) : null}
                  </div>
                ) : null}
                {event.suggestion ? (
                  <div style={{
                    fontSize: 11, color: "var(--accent)", marginTop: 3,
                    fontStyle: "italic", lineHeight: 1.3
                  }}>
                    {event.suggestion}
                  </div>
                ) : null}
                <div style={{
                  fontSize: 10, color: "var(--muted)", marginTop: 3,
                  fontFamily: "var(--mono)", opacity: 0.7
                }}>
                  {timeAgo(event.ts)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
