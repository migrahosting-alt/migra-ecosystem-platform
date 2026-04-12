"use client";

import { Suspense, useState, useRef, useEffect, type FormEvent, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authFetch } from "@/lib/api";

function MfaForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // OAuth flow params
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const scope = searchParams.get("scope");
  const nonce = searchParams.get("nonce");

  useEffect(() => {
    inputRefs.current[0]?.focus();
  }, []);

  function handleDigitChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const next = [...code];
    next[index] = value.slice(-1);
    setCode(next);
    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  }

  function handleKeyDown(index: number, e: KeyboardEvent) {
    if (e.key === "Backspace" && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
    if (pasted.length === 6) {
      e.preventDefault();
      setCode(pasted.split(""));
      inputRefs.current[5]?.focus();
    }
  }

  async function completeOAuthFlow() {
    if (!clientId || !redirectUri) {
      router.push("/");
      return;
    }

    const res = await authFetch<{ code?: string; error?: string }>("/authorize/complete", {
      method: "POST",
      body: {
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scope ?? "openid profile email",
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod ?? "S256",
        nonce: nonce ?? undefined,
      },
    });

    if (res.ok && res.data.code) {
      const url = new URL(redirectUri);
      url.searchParams.set("code", res.data.code);
      if (state) url.searchParams.set("state", state);
      window.location.href = url.toString();
    } else {
      router.push("/");
    }
  }

  async function handleTotpSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const totpCode = code.join("");
    if (totpCode.length !== 6) {
      setError("Enter all 6 digits.");
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch<{ message?: string; error?: string }>("/v1/mfa/totp/verify", {
        method: "POST",
        body: { code: totpCode },
      });

      if (!res.ok) {
        setError(res.data.message ?? "Invalid code.");
        setLoading(false);
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        return;
      }

      await completeOAuthFlow();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  async function handleRecoverySubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (!recoveryCode.trim()) {
      setError("Enter a recovery code.");
      return;
    }

    setLoading(true);
    try {
      const res = await authFetch<{ message?: string; error?: string }>("/v1/mfa/totp/verify", {
        method: "POST",
        body: { recoveryCode: recoveryCode.trim() },
      });

      if (!res.ok) {
        setError(res.data.message ?? "Invalid recovery code.");
        setLoading(false);
        return;
      }

      await completeOAuthFlow();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  if (showRecovery) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Recovery code</h1>
        <p className="mt-1 text-sm text-slate-500">
          Enter one of your backup recovery codes.
        </p>

        <form onSubmit={handleRecoverySubmit} className="mt-6 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <input
            type="text"
            autoFocus
            value={recoveryCode}
            onChange={(e) => setRecoveryCode(e.target.value)}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm font-mono shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="xxxx-xxxx"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Verifying…" : "Verify"}
          </button>
        </form>

        <p className="mt-4 text-center">
          <button
            type="button"
            onClick={() => { setShowRecovery(false); setError(""); }}
            className="text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Use authenticator app instead
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Two-factor authentication</h1>
      <p className="mt-1 text-sm text-slate-500">
        Enter the 6-digit code from your authenticator app.
      </p>

      <form onSubmit={handleTotpSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-center gap-2" onPaste={handlePaste}>
          {code.map((digit, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={digit}
              onChange={(e) => handleDigitChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              className="h-12 w-10 rounded-lg border border-slate-300 text-center text-lg font-semibold shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          ))}
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Verifying…" : "Verify"}
        </button>
      </form>

      <p className="mt-4 text-center">
        <button
          type="button"
          onClick={() => { setShowRecovery(true); setError(""); }}
          className="text-sm font-medium text-blue-600 hover:text-blue-700"
        >
          Use a recovery code
        </button>
      </p>
    </div>
  );
}

export default function MfaPage() {
  return <Suspense><MfaForm /></Suspense>;
}
