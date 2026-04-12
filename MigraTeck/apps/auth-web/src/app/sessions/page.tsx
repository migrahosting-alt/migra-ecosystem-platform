"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/api";

interface Session {
  id: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  isCurrent: boolean;
}

export default function SessionsPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    try {
      const res = await authFetch<{ sessions: Session[] }>("/v1/sessions");
      if (res.ok) {
        setSessions(res.data.sessions);
      } else {
        setError("Failed to load sessions.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setLoading(false);
    }
  }

  async function revokeSession(id: string) {
    setRevoking(id);
    try {
      const res = await authFetch(`/v1/sessions/${id}`, { method: "DELETE" });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== id));
      } else {
        setError("Failed to revoke session.");
      }
    } catch {
      setError("Network error.");
    } finally {
      setRevoking(null);
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function parseUA(ua: string | null): string {
    if (!ua) return "Unknown device";
    if (ua.includes("Firefox")) return "Firefox";
    if (ua.includes("Chrome")) return "Chrome";
    if (ua.includes("Safari")) return "Safari";
    if (ua.includes("Edge")) return "Edge";
    return "Browser";
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
        <p className="text-sm text-slate-500">Loading sessions…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Active sessions</h1>
      <p className="mt-1 text-sm text-slate-500">
        Manage devices signed in to your MigraTeck account.
      </p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="mt-6 divide-y divide-slate-100">
        {sessions.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-400">No active sessions.</p>
        )}

        {sessions.map((session) => (
          <div key={session.id} className="flex items-start justify-between py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-slate-900">
                  {parseUA(session.userAgent)}
                </p>
                {session.isCurrent && (
                  <span className="inline-flex rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                    Current
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-slate-500">
                {session.ipAddress ?? "Unknown IP"} · Last seen {formatDate(session.lastSeenAt)}
              </p>
            </div>

            {!session.isCurrent && (
              <button
                onClick={() => revokeSession(session.id)}
                disabled={revoking === session.id}
                className="ml-4 shrink-0 rounded-md border border-slate-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {revoking === session.id ? "…" : "Revoke"}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 pt-4 border-t border-slate-100">
        <a
          href="/login"
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          ← Back to account
        </a>
      </div>
    </div>
  );
}
