"use client";

/**
 * AuthGate — Authentication UI with email/password Sign In
 * and a fallback "paste JWT" modal for dev/emergency use.
 */

import { useState, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

interface AuthGateProps {
  hint?: string | null;
  onTokenSet: (token: string) => void;
}

const S = {
  container: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    gap: 20,
    padding: "40px 24px",
  } as React.CSSProperties,

  card: {
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: "32px 40px",
    background: "rgba(255,255,255,0.02)",
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 16,
    maxWidth: 420,
    width: "100%",
  } as React.CSSProperties,

  lockIcon: {
    fontSize: 32,
    lineHeight: 1,
    marginBottom: 4,
  } as React.CSSProperties,

  title: {
    fontSize: 16,
    fontWeight: 700,
    color: "var(--fg-bright)",
    textAlign: "center" as const,
  } as React.CSSProperties,

  subtitle: {
    fontSize: 13,
    color: "var(--fg-dim)",
    textAlign: "center" as const,
    lineHeight: "1.5",
    maxWidth: 320,
  } as React.CSSProperties,

  signInBtn: {
    padding: "10px 28px",
    borderRadius: 8,
    border: "none",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    transition: "all .15s",
    letterSpacing: ".2px",
    width: "100%",
  } as React.CSSProperties,

  divider: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    color: "var(--fg-dim)",
    fontSize: 11,
  } as React.CSSProperties,
  dividerLine: {
    flex: 1,
    height: 1,
    background: "var(--border)",
  } as React.CSSProperties,

  /* Form */
  formGroup: {
    width: "100%",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  } as React.CSSProperties,

  label: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--fg-dim)",
    textTransform: "uppercase" as const,
    letterSpacing: ".5px",
  } as React.CSSProperties,

  input: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-input, rgba(0,0,0,0.2))",
    color: "var(--fg-bright)",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box" as const,
  } as React.CSSProperties,

  errorMsg: {
    padding: "8px 14px",
    borderRadius: 8,
    background: "rgba(248,81,73,0.08)",
    border: "1px solid rgba(248,81,73,0.3)",
    color: "#f85149",
    fontSize: 12,
    textAlign: "center" as const,
    width: "100%",
  } as React.CSSProperties,

  /* Modal */
  overlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  } as React.CSSProperties,

  modal: {
    background: "var(--bg)",
    border: "1px solid var(--border)",
    borderRadius: 12,
    padding: "24px",
    width: "min(480px, 90vw)",
    display: "flex",
    flexDirection: "column" as const,
    gap: 16,
  } as React.CSSProperties,

  modalTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "var(--fg-bright)",
  } as React.CSSProperties,

  modalDesc: {
    fontSize: 12,
    color: "var(--fg-dim)",
    lineHeight: "1.5",
  } as React.CSSProperties,

  tokenInput: {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-input, rgba(0,0,0,0.2))",
    color: "var(--fg-bright)",
    fontFamily: "var(--mono)",
    fontSize: 12,
    outline: "none",
    resize: "none" as const,
    minHeight: 80,
    boxSizing: "border-box" as const,
  } as React.CSSProperties,

  modalActions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
  } as React.CSSProperties,

  modalBtn: (primary: boolean): React.CSSProperties => ({
    padding: "8px 20px",
    borderRadius: 6,
    border: primary ? "none" : "1px solid var(--border)",
    background: primary ? "var(--accent)" : "transparent",
    color: primary ? "#fff" : "var(--fg)",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  }),
};

export function AuthGate({ hint, onTokenSet }: AuthGateProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showJwtModal, setShowJwtModal] = useState(false);
  const [tokenDraft, setTokenDraft] = useState("");

  const isExpired = hint?.toLowerCase().includes("expired");

  /* ── Sign In with email + password ── */
  const handleSignIn = useCallback(async () => {
    if (!email.trim() || !password) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      const data = await res.json();

      if (!res.ok) {
        const msg =
          data.error === "INVALID_CREDENTIALS"
            ? "Invalid email or password"
            : data.error === "EMAIL_AND_PASSWORD_REQUIRED"
              ? "Email and password are required"
              : "Authentication failed";
        setError(msg);
        return;
      }

      localStorage.setItem("token", data.token);
      onTokenSet(data.token);
    } catch (err: any) {
      setError("Unable to reach API — check network");
    } finally {
      setLoading(false);
    }
  }, [email, password, onTokenSet]);

  /* ── JWT paste (fallback) ── */
  const handleJwtSubmit = useCallback(() => {
    const t = tokenDraft.trim();
    if (!t) return;
    localStorage.setItem("token", t);
    onTokenSet(t);
    setShowJwtModal(false);
    setTokenDraft("");
  }, [tokenDraft, onTokenSet]);

  return (
    <>
      <div style={S.container}>
        <div style={S.card}>
          <span style={S.lockIcon}>🔐</span>
          <div style={S.title}>
            {isExpired ? "Session Expired" : "Authentication Required"}
          </div>
          <div style={S.subtitle}>
            {isExpired
              ? "Your session has expired. Please sign in again to continue."
              : "Connect your operator identity to begin using MigraPilot."}
          </div>

          {error && <div style={S.errorMsg}>{error}</div>}
          {hint && !error && <div style={S.errorMsg}>{hint}</div>}

          {/* Email field */}
          <div style={S.formGroup}>
            <label style={S.label}>Email</label>
            <input
              style={S.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@migrateck.com"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSignIn();
              }}
            />
          </div>

          {/* Password field */}
          <div style={S.formGroup}>
            <label style={S.label}>Password</label>
            <input
              style={S.input}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSignIn();
              }}
            />
          </div>

          <button
            style={{
              ...S.signInBtn,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? "wait" : "pointer",
            }}
            onClick={handleSignIn}
            disabled={loading || !email.trim() || !password}
          >
            {loading ? "Signing in…" : isExpired ? "Re-authenticate" : "Sign In"}
          </button>

          <div style={S.divider}>
            <div style={S.dividerLine} />
            <span>or paste token</span>
            <div style={S.dividerLine} />
          </div>

          <button
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: "6px 16px",
              color: "var(--fg-dim)",
              fontSize: 11,
              cursor: "pointer",
            }}
            onClick={() => setShowJwtModal(true)}
          >
            Use JWT Token
          </button>
        </div>
      </div>

      {/* JWT Modal (fallback) */}
      {showJwtModal && (
        <div style={S.overlay} onClick={() => setShowJwtModal(false)}>
          <div style={S.modal} onClick={(e) => e.stopPropagation()}>
            <div style={S.modalTitle}>🔑 Enter JWT Token</div>
            <div style={S.modalDesc}>
              Paste your operator JWT below. The token will be stored in localStorage
              and used for API authentication.
            </div>
            <textarea
              style={S.tokenInput}
              value={tokenDraft}
              onChange={(e) => setTokenDraft(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIs..."
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleJwtSubmit();
              }}
            />
            <div style={S.modalActions}>
              <button style={S.modalBtn(false)} onClick={() => setShowJwtModal(false)}>Cancel</button>
              <button
                style={{
                  ...S.modalBtn(true),
                  opacity: tokenDraft.trim() ? 1 : 0.5,
                  cursor: tokenDraft.trim() ? "pointer" : "default",
                }}
                onClick={handleJwtSubmit}
                disabled={!tokenDraft.trim()}
              >
                Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
