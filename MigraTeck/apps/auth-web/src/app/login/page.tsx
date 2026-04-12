"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { authFetch, API_BASE } from "@/lib/api";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // OAuth params (if redirected from /authorize)
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const scope = searchParams.get("scope");
  const nonce = searchParams.get("nonce");

  const isOAuthFlow = !!(clientId && redirectUri && state && codeChallenge);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await authFetch<{
        user?: { id: string; email: string };
        mfa_required?: boolean;
        error?: string;
        message?: string;
      }>("/v1/login", {
        method: "POST",
        body: { email, password },
      });

      if (!res.ok) {
        setError(res.data.message ?? "Login failed.");
        setLoading(false);
        return;
      }

      if (res.data.mfa_required) {
        // Redirect to MFA page with OAuth params
        const mfaUrl = new URL("/mfa", window.location.origin);
        if (isOAuthFlow) {
          mfaUrl.searchParams.set("client_id", clientId!);
          mfaUrl.searchParams.set("redirect_uri", redirectUri!);
          mfaUrl.searchParams.set("state", state!);
          mfaUrl.searchParams.set("code_challenge", codeChallenge!);
          mfaUrl.searchParams.set("code_challenge_method", codeChallengeMethod!);
          if (scope) mfaUrl.searchParams.set("scope", scope);
          if (nonce) mfaUrl.searchParams.set("nonce", nonce);
        }
        router.push(mfaUrl.pathname + mfaUrl.search);
        return;
      }

      // Login successful — handle OAuth redirect or go to sessions
      if (isOAuthFlow) {
        await completeOAuthFlow();
      } else {
        router.push("/sessions");
      }
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  async function completeOAuthFlow() {
    const res = await authFetch<{
      redirect_uri: string;
      code: string;
      state: string;
    }>("/authorize/complete", {
      method: "POST",
      body: {
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod,
        scope: scope ?? "openid",
        nonce: nonce ?? undefined,
      },
    });

    if (res.ok) {
      const url = new URL(res.data.redirect_uri);
      url.searchParams.set("code", res.data.code);
      url.searchParams.set("state", res.data.state);
      window.location.href = url.toString();
    } else {
      setError("Failed to complete authorization.");
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-semibold text-slate-900">Sign in</h1>
      {isOAuthFlow && (
        <p className="mt-1 text-sm text-slate-500">
          Sign in to continue to your app
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="you@company.com"
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-slate-700">
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?{" "}
        <Link
          href={`/signup${isOAuthFlow ? `?${searchParams.toString()}` : ""}`}
          className="font-medium text-blue-600 hover:text-blue-700"
        >
          Create account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
