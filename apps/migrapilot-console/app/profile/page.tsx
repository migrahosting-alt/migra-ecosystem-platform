"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface SessionInfo {
  authenticated: boolean;
  username?: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const payload = await res.json();
        if (mounted && payload?.ok) {
          setSession(payload.data);
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch { /* best-effort */ }
    window.location.assign("/login");
  }

  return (
    <div className="panel" style={{ maxWidth: 620, margin: "0 auto" }}>
      <h1 style={{ marginTop: 0 }}>Profile</h1>
      <p style={{ color: "var(--fg-dim)", fontSize: 13 }}>
        Manage your admin session and account details.
      </p>

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--fg-dim)" }}>Loading session...</div>
      ) : (
        <div style={{ display: "grid", gap: 20 }}>
          {/* Session Info */}
          <div style={{ border: "1px solid var(--line, #24304a)", borderRadius: 10, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>Session</h2>
            <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fg-dim)" }}>Status</span>
                <span style={{ color: session?.authenticated ? "#22c55e" : "#f87171" }}>
                  {session?.authenticated ? "● Authenticated" : "● Not authenticated"}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fg-dim)" }}>Username</span>
                <span>{session?.username ?? "—"}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fg-dim)" }}>Role</span>
                <span>Administrator</span>
              </div>
            </div>
          </div>

          {/* Platform Info */}
          <div style={{ border: "1px solid var(--line, #24304a)", borderRadius: 10, padding: 16 }}>
            <h2 style={{ margin: 0, fontSize: 15, marginBottom: 12 }}>Platform</h2>
            <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fg-dim)" }}>Console</span>
                <span>MigraPilot Engineering OS v1.0</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--fg-dim)" }}>Environment</span>
                <span>Production</span>
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="btn-primary"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
              style={{ background: "#dc2626" }}
            >
              {loggingOut ? "Signing out..." : "Sign Out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
