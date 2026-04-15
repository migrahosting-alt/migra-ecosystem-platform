"use client";

import { useEffect, useState } from "react";

type Session = {
  id: string;
  session_type: string;
  client_id: string | null;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
  ip_address: string | null;
  user_agent: string | null;
  device_name: string | null;
  current: boolean;
};

type MfaStep = "idle" | "enrolling" | "verifying" | "enrolled";

export function SecurityWorkspace({ sessionExpiresAt }: { sessionExpiresAt: string | number }) {
  /* ── Sessions ── */
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  /* ── MFA ── */
  const [mfaStep, setMfaStep] = useState<MfaStep>("idle");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [mfaMessage, setMfaMessage] = useState<string | null>(null);
  const [enrollData, setEnrollData] = useState<{
    challenge_id: string;
    secret: string;
    otpauth_uri: string;
    recovery_codes: string[];
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [disablePending, setDisablePending] = useState(false);

  /* ── Password reset ── */
  const [resetPending, setResetPending] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  async function loadSessions() {
    setSessionsLoading(true);
    setSessionsError(null);
    setSessionMessage(null);
    try {
      const res = await fetch("/api/platform/security/sessions");
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setSessionsError(body?.error ?? "Failed to load sessions.");
        return;
      }
      const body = await res.json();
      setSessions(body.sessions ?? []);
    } catch {
      setSessionsError("Unable to reach session service.");
    } finally {
      setSessionsLoading(false);
    }
  }

  async function revokeSession(sessionId: string) {
    setRevokingId(sessionId);
    setSessionMessage(null);
    try {
      const res = await fetch("/api/platform/security/sessions/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setSessionMessage("The selected session was revoked.");
        return;
      }
      const body = await res.json().catch(() => null);
      setSessionMessage(body?.error ?? "This session could not be revoked. Refresh sign-in and try again.");
    } catch {
      setSessionMessage("Unable to reach the session service. Try again in a moment.");
    } finally {
      setRevokingId(null);
    }
  }

  async function enrollMfa() {
    setMfaStep("enrolling");
    setMfaError(null);
    try {
      const res = await fetch("/api/platform/security/mfa/enroll", { method: "POST" });
      const body = await res.json();
      if (!res.ok) {
        setMfaError(body?.error ?? "MFA enrollment failed.");
        setMfaStep("idle");
        return;
      }
      setEnrollData(body);
      setMfaStep("verifying");
    } catch {
      setMfaError("Unable to start MFA enrollment.");
      setMfaStep("idle");
    }
  }

  async function verifyMfa(e: React.FormEvent) {
    e.preventDefault();
    setMfaError(null);
    try {
      const res = await fetch("/api/platform/security/mfa/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: verifyCode, challenge_id: enrollData?.challenge_id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMfaError(body?.error ?? "Verification failed.");
        return;
      }
      setMfaStep("enrolled");
      setMfaMessage("MFA is now active on your account.");
    } catch {
      setMfaError("Unable to verify code.");
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    setDisablePending(true);
    setMfaError(null);
    try {
      const res = await fetch("/api/platform/security/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: disablePassword }),
      });
      const body = await res.json();
      if (!res.ok) {
        setMfaError(body?.error ?? "Failed to disable MFA.");
        return;
      }
      setMfaStep("idle");
      setMfaMessage("MFA has been disabled.");
      setDisablePassword("");
    } catch {
      setMfaError("Unable to disable MFA.");
    } finally {
      setDisablePending(false);
    }
  }

  async function requestPasswordReset() {
    setResetPending(true);
    setResetMessage(null);
    try {
      const res = await fetch("/api/platform/security/password-reset", { method: "POST" });
      const body = await res.json();
      if (res.ok) {
        setResetMessage(body?.message ?? "Password reset email sent.");
      } else {
        setResetMessage(body?.error ?? "Failed to send password reset.");
      }
    } catch {
      setResetMessage("Unable to reach authentication service.");
    } finally {
      setResetPending(false);
    }
  }

  const currentSession = sessions.find((session) => session.current) ?? null;
  const remoteSessions = sessions.filter((session) => !session.current);
  const delegatedSession = !sessionsLoading && sessions.length === 0;
  const staleSessions = sessions.filter((session) => {
    const activityAt = session.last_seen_at ?? session.created_at;
    return Date.now() - new Date(activityAt).getTime() > 1000 * 60 * 60 * 24 * 14;
  });
  const mfaStatus =
    mfaStep === "enrolled"
      ? {
          label: "Protected",
          detail: "TOTP is active for this operator session.",
          tone: "emerald",
        }
      : mfaStep === "verifying" || mfaStep === "enrolling"
        ? {
            label: "Enrollment active",
            detail: "Authenticator setup is in progress and waiting for verification.",
            tone: "amber",
          }
        : {
            label: "Available",
            detail: "TOTP can be enrolled from this workspace when stronger access controls are required.",
            tone: "slate",
          };

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Session footprint
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{sessions.length || "0"}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {sessionsLoading
              ? "Loading all active sessions across your account."
              : delegatedSession
                ? "Control-plane access is active, but no direct MigraAuth browser sessions are currently listed for this operator."
              : remoteSessions.length > 0
                ? `${remoteSessions.length} additional device${remoteSessions.length === 1 ? "" : "s"} can be revoked from this workspace.`
                : "Only the current device session is active right now."}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Current device
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">
            {currentSession?.device_name ?? (delegatedSession ? "Delegated session" : "This session")}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            {currentSession?.last_seen_at
              ? `Last activity ${new Date(currentSession.last_seen_at).toLocaleString()}.`
              : currentSession
                ? `Established ${new Date(currentSession.created_at).toLocaleString()}.`
                : delegatedSession
                  ? "This control-plane session is valid, but it is not represented as a direct MigraAuth browser session ledger entry."
                  : "The active browser session could not be mapped to a direct MigraAuth session record."}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            MFA posture
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{mfaStatus.label}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">{mfaStatus.detail}</p>
          <div className="mt-3 inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium text-slate-700">
            {mfaStatus.tone === "emerald"
              ? "Authenticator confirmed"
              : mfaStatus.tone === "amber"
                ? "Verification pending"
                : "Setup available"}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
            Review queue
          </p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{staleSessions.length}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Sessions with no activity for two weeks should be reviewed and revoked if they no longer map to an active operator.
          </p>
        </div>
      </section>

      {/* ── Active sessions ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Active sessions</h2>
          <span className="text-xs text-slate-400">
            Platform session expires {new Date(sessionExpiresAt).toLocaleDateString()}
          </span>
        </div>

        {sessionMessage ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-700">{sessionMessage}</p>
          </div>
        ) : null}

        {sessionsLoading ? (
          <div className="mt-6 flex justify-center py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
          </div>
        ) : sessionsError ? (
          <p className="mt-4 text-sm text-red-600">{sessionsError}</p>
        ) : sessions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No direct MigraAuth browser sessions are currently visible for this operator.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                  <th className="pb-3 pr-4">Device</th>
                  <th className="pb-3 pr-4">IP</th>
                  <th className="pb-3 pr-4">Created</th>
                  <th className="pb-3 pr-4">Last seen</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td className="py-3 pr-4">
                      <span className="font-medium text-slate-900">
                        {s.device_name ?? s.user_agent?.slice(0, 40) ?? "Unknown device"}
                      </span>
                      <p className="mt-1 text-xs text-slate-500">
                        {s.session_type.replace(/_/g, " ")}
                        {s.client_id ? ` • ${s.client_id}` : ""}
                      </p>
                      {s.current && (
                        <span className="ml-2 inline-flex rounded-full bg-emerald-50 border border-emerald-200 px-2 py-0.5 text-xs font-medium text-emerald-700">
                          Current
                        </span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{s.ip_address ?? "—"}</td>
                    <td className="py-3 pr-4 text-slate-600">
                      {new Date(s.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">
                      {s.last_seen_at ? new Date(s.last_seen_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3 text-right">
                      {!s.current && (
                        <button
                          type="button"
                          onClick={() => revokeSession(s.id)}
                          disabled={revokingId === s.id}
                          className="text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-50"
                        >
                          {revokingId === s.id ? "Revoking…" : "Revoke"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── MFA ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Multi-factor authentication</h2>
        <p className="mt-2 text-sm text-slate-500">
          Use TOTP to harden operator sign-in, then retain recovery codes offline for incident response.
        </p>

        {mfaError && (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{mfaError}</p>
          </div>
        )}
        {mfaMessage && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-700">{mfaMessage}</p>
          </div>
        )}

        {mfaStep === "idle" && (
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={enrollMfa}
              className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
            >
              Set up TOTP
            </button>
          </div>
        )}

        {mfaStep === "enrolling" && (
          <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-900" />
            Starting enrollment…
          </div>
        )}

        {mfaStep === "verifying" && enrollData && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-medium text-slate-900">Add this to your authenticator app:</p>
              <code className="mt-2 block break-all rounded bg-white px-3 py-2 text-xs text-slate-700 border border-slate-200">
                {enrollData.secret}
              </code>
              <p className="mt-2 text-xs text-slate-500">
                Or scan the QR code from this URI in your TOTP app:
              </p>
              <code className="mt-1 block break-all rounded bg-white px-3 py-2 text-xs text-slate-600 border border-slate-200">
                {enrollData.otpauth_uri}
              </code>
            </div>

            {enrollData.recovery_codes.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-medium text-amber-800">Save your recovery codes:</p>
                <div className="mt-2 grid grid-cols-2 gap-1">
                  {enrollData.recovery_codes.map((code) => (
                    <code key={code} className="rounded bg-white px-2 py-1 text-xs text-slate-700 border border-amber-200">
                      {code}
                    </code>
                  ))}
                </div>
              </div>
            )}

            <form onSubmit={verifyMfa} className="flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="totp-code" className="block text-sm font-medium text-slate-700 mb-1">
                  Enter 6-digit code
                </label>
                <input
                  id="totp-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="000000"
                />
              </div>
              <button
                type="submit"
                disabled={verifyCode.length !== 6}
                className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                Verify
              </button>
            </form>
          </div>
        )}

        {mfaStep === "enrolled" && (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-800">MFA is active</p>
              <p className="mt-1 text-sm text-emerald-700">TOTP-based multi-factor authentication is enabled on your account.</p>
            </div>

            <form onSubmit={disableMfa} className="flex items-end gap-3">
              <div className="flex-1">
                <label htmlFor="disable-pw" className="block text-sm font-medium text-slate-700 mb-1">
                  Password to disable MFA
                </label>
                <input
                  id="disable-pw"
                  type="password"
                  value={disablePassword}
                  onChange={(e) => setDisablePassword(e.target.value)}
                  className="block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                  placeholder="Enter your password"
                />
              </div>
              <button
                type="submit"
                disabled={!disablePassword || disablePending}
                className="inline-flex items-center justify-center rounded-full border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                {disablePending ? "Disabling…" : "Disable MFA"}
              </button>
            </form>
          </div>
        )}
      </section>

      {/* ── Password reset ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Password</h2>
        <p className="mt-2 text-sm text-slate-500">
          Send a password reset email to the address registered with MigraAuth. Use this when a credential rotation is required or the current password is no longer trusted.
        </p>
        {resetMessage && (
          <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-700">{resetMessage}</p>
          </div>
        )}
        <div className="mt-4">
          <button
            type="button"
            onClick={requestPasswordReset}
            disabled={resetPending}
            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
          >
            {resetPending ? "Sending…" : "Send password reset email"}
          </button>
        </div>
      </section>
    </div>
  );
}
