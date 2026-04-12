"use client";

import { useEffect, useRef, useState } from "react";
import { pilotApiUrl } from "../lib/shared/pilot-api";

interface NotificationItem {
  id: string;
  notificationId: string;
  ts: string;
  level: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  read: boolean;
  readAt: string | null;
}

function levelColor(level: string): string {
  if (level === "critical") return "var(--danger)";
  if (level === "warn") return "var(--warn)";
  return "var(--accent)";
}

function levelIcon(level: string): string {
  if (level === "critical") return "🔴";
  if (level === "warn") return "🟡";
  return "🔵";
}

function typeLabel(type: string): string {
  if (type === "autonomy") return "Autonomy";
  if (type === "mission") return "Mission";
  if (type === "drift") return "Drift";
  return "System";
}

function timeAgo(ts: string): string {
  const diff = Math.floor((Date.now() - Date.parse(ts)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function deepLinkHref(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  if (data.missionId) return `/missions/${data.missionId}`;
  if (data.diffId) return `/drift/diff?from=${encodeURIComponent(String(data.fromSnapshotId ?? ""))}&to=${encodeURIComponent(String(data.toSnapshotId ?? ""))}`;
  if (data.approvalId) return `/approvals`;
  return null;
}

const POLL_MS = 10_000;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll unread count
  async function fetchUnread() {
    try {
      const res = await fetch(pilotApiUrl("/api/notifications/unread"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) setUnread(data.count);
    } catch { /* silent */ }
  }

  // Fetch full notification list
  async function fetchNotifications() {
    setLoading(true);
    try {
      const res = await fetch(pilotApiUrl("/api/notifications?limit=50"), { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (data.ok) setNotifications(data.notifications);
    } catch { /* silent */ }
    setLoading(false);
  }

  // Mark one as read
  async function markRead(notificationId: string) {
    try {
      await fetch(pilotApiUrl("/api/notifications/ack"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId }),
      });
      setNotifications((prev) =>
        prev.map((n) =>
          n.notificationId === notificationId ? { ...n, read: true, readAt: new Date().toISOString() } : n
        )
      );
      setUnread((c) => Math.max(0, c - 1));
    } catch { /* silent */ }
  }

  // Mark all as read
  async function markAllRead() {
    try {
      await fetch(pilotApiUrl("/api/notifications/ack-all"), { method: "POST" });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true, readAt: new Date().toISOString() })));
      setUnread(0);
    } catch { /* silent */ }
  }

  // Toggle drawer
  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) void fetchNotifications();
  }

  // Start polling
  useEffect(() => {
    void fetchUnread();
    pollRef.current = setInterval(() => void fetchUnread(), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={drawerRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Bell button */}
      <button
        onClick={toggle}
        title="Notifications"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          position: "relative",
          fontSize: 18,
          lineHeight: 1,
          padding: "4px 6px",
          color: "var(--fg)",
        }}
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              background: "var(--danger)",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              borderRadius: "50%",
              minWidth: 16,
              height: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {/* Drawer */}
      {open && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            width: 360,
            maxHeight: 480,
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
            zIndex: 1000,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: "10px 12px",
              borderBottom: "1px solid var(--border)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => void markAllRead()}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--accent)",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 500,
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: "auto", flex: 1 }}>
            {loading && notifications.length === 0 ? (
              <div className="small" style={{ padding: 16, color: "var(--muted)", textAlign: "center" }}>
                Loading…
              </div>
            ) : notifications.length === 0 ? (
              <div className="small" style={{ padding: 16, color: "var(--muted)", textAlign: "center" }}>
                No notifications yet.
              </div>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {notifications.map((n) => {
                  const href = deepLinkHref(n.data);
                  return (
                    <li
                      key={n.id}
                      style={{
                        padding: "8px 12px",
                        borderBottom: "1px solid var(--border)",
                        background: n.read ? "transparent" : "rgba(59,130,246,0.06)",
                        cursor: "pointer",
                      }}
                      onClick={() => {
                        if (!n.read) void markRead(n.notificationId);
                        if (href) window.location.href = href;
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
                        <span style={{ fontSize: 12 }}>{levelIcon(n.level)}</span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: levelColor(n.level),
                            textTransform: "uppercase",
                          }}
                        >
                          {typeLabel(n.type)}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: "auto" }}>
                          {timeAgo(n.ts)}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: n.read ? 400 : 600,
                          lineHeight: 1.3,
                          color: "var(--fg)",
                        }}
                      >
                        {n.title.replace(/^[🔴🟡🔵]\s*/, "")}
                      </div>
                      <div
                        className="small"
                        style={{
                          color: "var(--muted)",
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: 320,
                        }}
                        title={n.message}
                      >
                        {n.message}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
