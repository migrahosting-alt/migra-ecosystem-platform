"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [nextPath, setNextPath] = useState("/console");

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("next");
    if (raw && raw.startsWith("/")) {
      setNextPath(raw);
    }
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        setError("Invalid admin username or password.");
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--bg, #060a14)", position: "relative" }}>
      {/* Subtle gradient background */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(56, 189, 248, 0.04) 0%, transparent 60%)", pointerEvents: "none" }} />

      <section style={{ width: "100%", maxWidth: 400, border: "1px solid var(--line, rgba(99,130,191,0.12))", borderRadius: 18, padding: 32, background: "var(--panel, rgba(15,23,42,0.75))", backdropFilter: "blur(16px)", boxShadow: "0 8px 40px rgba(0,0,0,0.45)", position: "relative", zIndex: 1 }}>
        {/* Logo */}
        <div style={{ width: 64, height: 64, borderRadius: 16, overflow: "hidden", margin: "0 auto 20px" }}>
          <img src="/brand/migrapilot-logo.png" alt="MigraPilot" width={64} height={64} style={{ display: "block", width: "100%", height: "100%", objectFit: "contain" }} />
        </div>

        <h1 style={{ margin: 0, marginBottom: 6, fontSize: 18, fontWeight: 600, textAlign: "center", letterSpacing: -0.3 }}>Sign in to MigraPilot</h1>
        <p style={{ margin: 0, marginBottom: 24, color: "var(--fg-dim, #64748b)", fontSize: 13, textAlign: "center" }}>
          Engineering OS Console
        </p>

        <form onSubmit={onSubmit} style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 500, color: "var(--text-secondary, #94a3b8)" }}>
            Username
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line, rgba(99,130,191,0.12))", background: "rgba(6,10,20,0.5)", color: "#e8edf5", fontSize: 13, transition: "border-color 180ms, box-shadow 180ms" }}
            />
          </label>

          <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 500, color: "var(--text-secondary, #94a3b8)" }}>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line, rgba(99,130,191,0.12))", background: "rgba(6,10,20,0.5)", color: "#e8edf5", fontSize: 13, transition: "border-color 180ms, box-shadow 180ms" }}
            />
          </label>

          {error && (
            <div style={{ color: "#f87171", fontSize: 12, textAlign: "center" }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={submitting}
            style={{
              marginTop: 4,
              padding: "11px 14px",
              borderRadius: 10,
              border: "none",
              background: submitting ? "#334155" : "linear-gradient(135deg, #38bdf8, #818cf8)",
              color: "white",
              fontWeight: 600,
              fontSize: 13,
              cursor: submitting ? "default" : "pointer",
              boxShadow: submitting ? "none" : "0 2px 12px rgba(56, 189, 248, 0.2)",
              transition: "all 180ms",
            }}
          >
            {submitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </section>
    </main>
  );
}
