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

type SecurityPosture = {
  product_client_id: string | null;
  mfa_enabled: boolean;
  recovery_codes_stale: boolean;
  has_password: boolean;
  password_updated_at: string | null;
  email_verified: boolean;
  linked_providers: string[];
  sign_in_methods: number;
  can_unlink_a_provider: boolean;
};

type LinkedProvider = {
  provider: string;
  email: string | null;
  display_name: string | null;
  linked_at: string;
  last_used_at: string | null;
};

type AvailableProvider = {
  id: string;
  label: string;
};

type MfaStep = "idle" | "enrolling" | "verifying" | "enrolled";

export function SecurityWorkspace({ sessionExpiresAt }: { sessionExpiresAt: string | number }) {
  /* ── Account posture ── */
  const [securityPosture, setSecurityPosture] = useState<SecurityPosture | null>(null);
  const [postureLoading, setPostureLoading] = useState(true);
  const [postureError, setPostureError] = useState<string | null>(null);

  /* ── Sessions ── */
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [sessionMessage, setSessionMessage] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [revokeOthersPending, setRevokeOthersPending] = useState(false);

  /* ── Linked providers ── */
  const [availableProviders, setAvailableProviders] = useState<AvailableProvider[]>([]);
  const [linkedProviders, setLinkedProviders] = useState<LinkedProvider[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providersMessage, setProvidersMessage] = useState<string | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<string | null>(null);

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
  const [disableCode, setDisableCode] = useState("");
  const [disablePending, setDisablePending] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [replacementRecoveryCodes, setReplacementRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);

  /* ── Password management / recovery ── */
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [passwordCode, setPasswordCode] = useState("");
  const [passwordPending, setPasswordPending] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [resetPending, setResetPending] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    void loadSecurityPosture();
    void loadSessions();
    void loadProviders();
  }, []);

  async function loadSecurityPosture() {
    setPostureLoading(true);
    setPostureError(null);

    try {
      const res = await fetch("/api/platform/security/status", { cache: "no-store" });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setPostureError(body?.error ?? "Failed to load account security posture.");
        return;
      }

      const posture = body as SecurityPosture;
      setSecurityPosture(posture);
      setMfaStep(posture.mfa_enabled ? "enrolled" : "idle");
    } catch {
      setPostureError("Unable to reach the account security service.");
    } finally {
      setPostureLoading(false);
    }
  }

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

  async function loadProviders() {
    setProvidersLoading(true);
    setProvidersMessage(null);
    try {
      const res = await fetch("/api/platform/security/providers", {
        cache: "no-store",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setProvidersMessage(
          body?.error ?? "Unable to load connected sign-in providers.",
        );
        return;
      }
      setAvailableProviders(Array.isArray(body?.providers) ? body.providers : []);
      setLinkedProviders(Array.isArray(body?.links) ? body.links : []);
    } catch {
      setProvidersMessage("Unable to reach the provider-link service.");
    } finally {
      setProvidersLoading(false);
    }
  }

  async function revokeOtherSessions() {
    setRevokeOthersPending(true);
    setSessionMessage(null);
    try {
      const res = await fetch(
        "/api/platform/security/sessions/revoke-others",
        { method: "POST" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setSessionMessage(
          body?.error ?? "Other sessions could not be revoked.",
        );
        return;
      }
      setSessionMessage(
        String(body?.revoked_count ?? 0) +
          " other session" +
          (Number(body?.revoked_count ?? 0) === 1 ? "" : "s") +
          " revoked.",
      );
      await loadSessions();
    } catch {
      setSessionMessage("Unable to reach the session service.");
    } finally {
      setRevokeOthersPending(false);
    }
  }

  async function unlinkProvider(provider: string) {
    if (
      !window.confirm(
        "Disconnect " +
          provider +
          " from this MigraAuth account? The last sign-in method cannot be removed.",
      )
    ) {
      return;
    }

    setUnlinkingProvider(provider);
    setProvidersMessage(null);
    try {
      const res = await fetch(
        "/api/platform/security/providers/" + encodeURIComponent(provider),
        { method: "DELETE" },
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setProvidersMessage(
          body?.error ?? "Unable to disconnect this sign-in provider.",
        );
        return;
      }
      setProvidersMessage(provider + " disconnected.");
      await Promise.all([loadProviders(), loadSecurityPosture()]);
    } catch {
      setProvidersMessage("Unable to reach the provider-link service.");
    } finally {
      setUnlinkingProvider(null);
    }
  }

  async function managePassword(event: React.FormEvent) {
    event.preventDefault();
    setPasswordMessage(null);

    if (newPassword.length < 10 || newPassword.length > 128) {
      setPasswordMessage("Use a password between 10 and 128 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage("The new password and confirmation do not match.");
      return;
    }

    setPasswordPending(true);
    try {
      const proof = {
        new_password: newPassword,
        ...(currentPassword.trim()
          ? { current_password: currentPassword }
          : {}),
        ...(passwordCode.trim() ? { code: passwordCode.trim() } : {}),
      };
      const res = await fetch("/api/platform/security/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proof),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setPasswordMessage(
          body?.error ?? "Unable to update the password.",
        );
        return;
      }

      setPasswordMessage(
        body?.message ??
          "Password updated. Re-authentication is required now.",
      );
      const target =
        typeof body?.reauthenticate?.url === "string"
          ? body.reauthenticate.url
          : "/login";
      window.location.assign(target);
    } catch {
      setPasswordMessage("Unable to reach the password service.");
    } finally {
      setPasswordPending(false);
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
      await loadSecurityPosture();
    } catch {
      setMfaError("Unable to verify code.");
    }
  }

  async function disableMfa(e: React.FormEvent) {
    e.preventDefault();
    setDisablePending(true);
    setMfaError(null);

    try {
      const proof = {
        ...(disablePassword.trim() ? { password: disablePassword } : {}),
        ...(disableCode.trim() ? { code: disableCode.trim() } : {}),
      };
      const res = await fetch("/api/platform/security/mfa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proof),
      });
      const body = await res.json();
      if (!res.ok) {
        setMfaError(body?.error ?? "Failed to disable MFA.");
        return;
      }

      setMfaStep("idle");
      setMfaMessage("MFA has been disabled.");
      setDisablePassword("");
      setDisableCode("");
      await loadSecurityPosture();
    } catch {
      setMfaError("Unable to disable MFA.");
    } finally {
      setDisablePending(false);
    }
  }

  async function replaceRecoveryCodes(e: React.FormEvent) {
    e.preventDefault();
    setRecoveryPending(true);
    setRecoveryMessage(null);
    setMfaError(null);

    try {
      const proof = {
        ...(recoveryPassword.trim() ? { password: recoveryPassword } : {}),
        ...(recoveryCode.trim() ? { code: recoveryCode.trim() } : {}),
      };
      const res = await fetch("/api/platform/security/mfa/recovery-codes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(proof),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        setRecoveryMessage(body?.error ?? "Unable to replace recovery codes.");
        return;
      }

      setReplacementRecoveryCodes(Array.isArray(body?.recovery_codes) ? body.recovery_codes : []);
      setRecoveryMessage(
        body?.message ??
          "Recovery codes replaced. Save the new set now; it cannot be displayed again.",
      );
      setRecoveryPassword("");
      setRecoveryCode("");
      await loadSecurityPosture();
    } catch {
      setRecoveryMessage("Unable to reach the recovery-code service.");
    } finally {
      setRecoveryPending(false);
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
  const mfaEnabled = securityPosture?.mfa_enabled ?? mfaStep === "enrolled";
  const mfaStatus =
    postureLoading
      ? {
          label: "Checking",
          detail: "Reading the account's MFA state from MigraAuth.",
          tone: "slate",
        }
      : mfaEnabled
        ? {
            label: "Protected",
            detail: securityPosture?.recovery_codes_stale
              ? "TOTP is active, but the stored recovery codes are stale and should be replaced."
              : "TOTP is active on this MigraAuth account.",
            tone: securityPosture?.recovery_codes_stale ? "amber" : "emerald",
          }
        : mfaStep === "verifying" || mfaStep === "enrolling"
          ? {
              label: "Enrollment active",
              detail: "Authenticator setup is in progress and waiting for verification.",
              tone: "amber",
            }
          : {
              label: "Not enabled",
              detail: "This account does not currently have TOTP multi-factor authentication enabled.",
              tone: "slate",
            };

  return (
    <div className="space-y-6">
      {postureError ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Account security posture could not be refreshed: {postureError}
        </div>
      ) : null}

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
                ? securityPosture?.recovery_codes_stale
                  ? "Recovery codes need replacement"
                  : "Verification pending"
                : postureLoading
                  ? "Reading account state"
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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Active sessions</h2>
            <p className="mt-1 text-xs text-slate-400">
              Platform session expires {new Date(sessionExpiresAt).toLocaleDateString()}
            </p>
          </div>
          {currentSession && remoteSessions.length > 0 ? (
            <button
              type="button"
              onClick={() => void revokeOtherSessions()}
              disabled={revokeOthersPending}
              className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-white px-4 py-2 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
            >
              {revokeOthersPending
                ? "Revoking other sessions…"
                : "Revoke all other sessions"}
            </button>
          ) : null}
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

        {mfaStep === "idle" && !postureLoading && securityPosture?.mfa_enabled === false && (
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
              <p className="mt-1 text-sm text-emerald-700">
                TOTP-based multi-factor authentication is enabled on this account.
              </p>
            </div>

            {securityPosture?.recovery_codes_stale ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">Recovery codes need replacement</p>
                <p className="mt-1 text-sm leading-6 text-amber-800">
                  MigraAuth detected recovery codes issued by an older incompatible hash format.
                  Do not rely on the printed set for account recovery; replace them before an incident.
                </p>
              </div>
            ) : null}

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Recovery codes</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Replace the current set after re-authentication. The new plaintext codes are shown once;
                MigraAuth stores only hashes.
              </p>

              {replacementRecoveryCodes ? (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-amber-900">Save these codes now</p>
                      <p className="mt-1 text-xs leading-5 text-amber-800">
                        This is the only time this replacement set can be displayed.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(replacementRecoveryCodes.join("\n"))}
                      className="rounded-full border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800"
                    >
                      Copy all
                    </button>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {replacementRecoveryCodes.map((code) => (
                      <code
                        key={code}
                        className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-semibold text-slate-800"
                      >
                        {code}
                      </code>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setReplacementRecoveryCodes(null)}
                    className="mt-3 text-xs font-semibold text-amber-800 underline underline-offset-2"
                  >
                    I saved this set — hide it
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={replaceRecoveryCodes}
                  className={
                    "mt-4 grid gap-3 " +
                    (securityPosture?.has_password
                      ? "md:grid-cols-[1fr_1fr_auto]"
                      : "md:grid-cols-[1fr_auto]")
                  }
                >
                  {securityPosture?.has_password ? (
                    <input
                      type="password"
                      value={recoveryPassword}
                      onChange={(e) => setRecoveryPassword(e.target.value)}
                      className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="Current password"
                      aria-label="Password for recovery-code replacement"
                    />
                  ) : null}
                  <input
                    type="text"
                    value={recoveryCode}
                    onChange={(e) => setRecoveryCode(e.target.value.trimStart().slice(0, 64))}
                    className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="Authenticator or recovery code"
                    aria-label="Authenticator or recovery code for replacement"
                  />
                  <button
                    type="submit"
                    disabled={(!recoveryPassword.trim() && !recoveryCode.trim()) || recoveryPending}
                    className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                  >
                    {recoveryPending ? "Replacing…" : "Replace codes"}
                  </button>
                </form>
              )}

              {recoveryMessage ? (
                <p className="mt-3 text-xs leading-5 text-slate-600">{recoveryMessage}</p>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">Disable MFA</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">
                Re-authenticate with any credential this account actually has. MigraAuth accepts a password,
                a current authenticator code, or one unused recovery code.
              </p>

              <form
                onSubmit={disableMfa}
                className={
                  "mt-4 grid gap-3 " +
                  (securityPosture?.has_password
                    ? "md:grid-cols-[1fr_1fr_auto]"
                    : "md:grid-cols-[1fr_auto]")
                }
              >
                {securityPosture?.has_password ? (
                  <div>
                    <label htmlFor="disable-pw" className="mb-1 block text-sm font-medium text-slate-700">
                      Password
                    </label>
                    <input
                      id="disable-pw"
                      type="password"
                      value={disablePassword}
                      onChange={(e) => setDisablePassword(e.target.value)}
                      className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                      placeholder="Current password"
                    />
                  </div>
                ) : null}

                <div>
                  <label htmlFor="disable-code" className="mb-1 block text-sm font-medium text-slate-700">
                    Authenticator or recovery code
                  </label>
                  <input
                    id="disable-code"
                    type="text"
                    autoComplete="one-time-code"
                    value={disableCode}
                    onChange={(e) => setDisableCode(e.target.value.trimStart().slice(0, 64))}
                    className="block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder="6-digit code or recovery code"
                  />
                </div>

                <button
                  type="submit"
                  disabled={(!disablePassword.trim() && !disableCode.trim()) || disablePending}
                  className="inline-flex items-center justify-center self-end rounded-full border border-red-200 bg-white px-5 py-2.5 text-sm font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                >
                  {disablePending ? "Disabling…" : "Disable MFA"}
                </button>
              </form>
            </div>
          </div>
        )}
      </section>

      {/* ── Credential posture / recovery ── */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-base font-semibold text-slate-900">Sign-in credentials</h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          MigraAuth is the credential authority. This view shows which sign-in methods actually exist before offering a recovery action.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Password</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {postureLoading ? "Checking…" : securityPosture?.has_password ? "Configured" : "Not configured"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {securityPosture?.has_password
                ? securityPosture.password_updated_at
                  ? "Updated " + new Date(securityPosture.password_updated_at).toLocaleString()
                  : "Password credential is enabled."
                : "This may be a provider-only account."}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Email</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {postureLoading ? "Checking…" : securityPosture?.email_verified ? "Verified" : "Not verified"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Recovery email flows should only be trusted after identity verification.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Sign-in methods</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {postureLoading ? "Checking…" : String(securityPosture?.sign_in_methods ?? 0)}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {securityPosture?.linked_providers.length
                ? "Linked: " + securityPosture.linked_providers.join(", ")
                : "No linked external provider is reported."}
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Last-method guard</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {postureLoading
                ? "Checking…"
                : securityPosture?.can_unlink_a_provider
                  ? "Redundant"
                  : "Protected"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {securityPosture?.can_unlink_a_provider
                ? "At least one other sign-in method remains if a provider is disconnected."
                : "The account must not lose its only remaining sign-in method."}
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  Connected sign-in providers
                </p>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Add redundant sign-in methods or disconnect providers you no longer use.
                  MigraAuth refuses any change that would remove the account&apos;s last way in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadProviders()}
                disabled={providersLoading}
                className="shrink-0 text-xs font-semibold text-blue-600 disabled:opacity-50"
              >
                {providersLoading ? "Refreshing…" : "Refresh"}
              </button>
            </div>

            {providersMessage ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700">
                {providersMessage}
              </div>
            ) : null}

            {providersLoading && availableProviders.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                Loading configured sign-in providers…
              </p>
            ) : availableProviders.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">
                No external sign-in provider is configured on this MigraAuth deployment.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {availableProviders.map((provider) => {
                  const linked = linkedProviders.find(
                    (item) => item.provider === provider.id,
                  );
                  return (
                    <div
                      key={provider.id}
                      className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {provider.label}
                          </p>
                          <span
                            className={
                              "rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] " +
                              (linked
                                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                                : "border-slate-200 bg-slate-50 text-slate-500")
                            }
                          >
                            {linked ? "Linked" : "Available"}
                          </span>
                        </div>
                        {linked ? (
                          <p className="mt-1 truncate text-xs text-slate-500">
                            {linked.email ??
                              linked.display_name ??
                              "Provider identity linked"}
                            {linked.last_used_at
                              ? " · last used " +
                                new Date(linked.last_used_at).toLocaleDateString()
                              : ""}
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-slate-500">
                            Add {provider.label} as another way to sign in.
                          </p>
                        )}
                      </div>

                      {linked ? (
                        <button
                          type="button"
                          onClick={() => void unlinkProvider(provider.id)}
                          disabled={
                            unlinkingProvider === provider.id ||
                            securityPosture?.can_unlink_a_provider === false
                          }
                          title={
                            securityPosture?.can_unlink_a_provider === false
                              ? "Add another sign-in method before disconnecting this provider."
                              : undefined
                          }
                          className="inline-flex shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {unlinkingProvider === provider.id
                            ? "Disconnecting…"
                            : "Disconnect"}
                        </button>
                      ) : (
                        <a
                          href={
                            "/api/platform/security/providers/" +
                            encodeURIComponent(provider.id) +
                            "/link"
                          }
                          className="inline-flex shrink-0 items-center justify-center rounded-full border border-blue-200 bg-white px-3 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50"
                        >
                          Link provider
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <p className="text-sm font-semibold text-slate-900">
              {securityPosture?.has_password ? "Change password" : "Set a password"}
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {securityPosture?.has_password
                ? "Use your current password or an MFA code as proof. A successful change ends this session so the new password is immediately proven by signing in again."
                : mfaEnabled
                  ? "This account has no password yet. Prove the change with your authenticator or a recovery code."
                  : "This account has no password yet. A recent provider sign-in can authorize adding one; stale sessions will be asked to sign in again."}
            </p>

            {passwordMessage ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-700">
                {passwordMessage}
              </div>
            ) : null}

            <form onSubmit={managePassword} className="mt-4 space-y-3">
              {securityPosture?.has_password ? (
                <input
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  placeholder="Current password"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                />
              ) : null}

              {mfaEnabled ? (
                <input
                  type="text"
                  autoComplete="one-time-code"
                  value={passwordCode}
                  onChange={(event) =>
                    setPasswordCode(event.target.value.trimStart().slice(0, 64))
                  }
                  placeholder="Authenticator or recovery code"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                />
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2">
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={10}
                  maxLength={128}
                  placeholder="New password"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={10}
                  maxLength={128}
                  placeholder="Confirm new password"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
                />
              </div>

              <button
                type="submit"
                disabled={
                  passwordPending ||
                  newPassword.length < 10 ||
                  confirmPassword.length < 10 ||
                  (securityPosture?.has_password === true &&
                    !currentPassword.trim() &&
                    !(mfaEnabled && passwordCode.trim())) ||
                  (securityPosture?.has_password === false &&
                    mfaEnabled &&
                    !passwordCode.trim())
                }
                className="inline-flex items-center justify-center rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
              >
                {passwordPending
                  ? "Updating…"
                  : securityPosture?.has_password
                    ? "Change password"
                    : "Set password"}
              </button>
            </form>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <p className="text-sm font-semibold text-slate-900">
            Email-based password recovery
          </p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Use this when you cannot complete the signed-in credential change above.
            Recovery is only offered to a verified account email.
          </p>

          {resetMessage ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm text-slate-700">{resetMessage}</p>
            </div>
          ) : null}

          <div className="mt-4">
            <button
              type="button"
              onClick={requestPasswordReset}
              disabled={
                resetPending || securityPosture?.email_verified === false
              }
              className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            >
              {resetPending
                ? "Sending…"
                : securityPosture?.has_password
                  ? "Send password reset email"
                  : "Send password setup email"}
            </button>
            {securityPosture?.email_verified === false ? (
              <p className="mt-2 text-xs text-amber-700">
                Verify the account email before using email-based password recovery.
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
