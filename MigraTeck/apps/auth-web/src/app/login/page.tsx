"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  Button,
  Input,
  PasswordInput,
  toBrandStyle,
} from "@migrateck/auth-ui";
import { authFetch } from "@/lib/api";
import { resolveAuthBrandTheme } from "@/lib/branding";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const scope = searchParams.get("scope");
  const nonce = searchParams.get("nonce");
  const effectiveClientId = clientId ?? "migraauth_web";
  const brand = useMemo(() => resolveAuthBrandTheme(clientId), [clientId]);
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);

  const isOAuthFlow = !!(clientId && redirectUri && state && codeChallenge);
  const queryString = searchParams.toString();

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await authFetch<{
        mfa_required?: boolean;
        requires_mfa?: boolean;
        message?: string;
      }>("/v1/login", {
        method: "POST",
        body: {
          email,
          password,
          client_id: effectiveClientId,
        },
      });

      if (!response.ok) {
        setError(response.data.message ?? "Login failed.");
        setLoading(false);
        return;
      }

      if (response.data.mfa_required || response.data.requires_mfa) {
        const mfaUrl = new URL("/mfa", window.location.origin);
        if (isOAuthFlow) {
          mfaUrl.search = queryString;
        }
        router.push(mfaUrl.pathname + mfaUrl.search);
        return;
      }

      if (isOAuthFlow) {
        await completeOAuthFlow();
        return;
      }

      router.push("/sessions");
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  async function completeOAuthFlow() {
    const response = await authFetch<{
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

    if (!response.ok) {
      setError("Failed to complete authorization.");
      setLoading(false);
      return;
    }

    const url = new URL(response.data.redirect_uri);
    url.searchParams.set("code", response.data.code);
    url.searchParams.set("state", response.data.state);
    window.location.href = url.toString();
  }

  return (
    <div
      className="min-h-screen text-white"
      style={brandStyle}
    >
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        {/* ── background: homepage-aligned deep navy gradient ─── */}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#080b20_0%,#0f1733_48%,#080b20_100%)]" />
        {/* brand-aware glow orbs */}
        <div className="pointer-events-none absolute -left-40 top-16 h-[500px] w-[500px] rounded-full blur-[120px]" style={{ background: "var(--brand-start)", opacity: 0.18 }} />
        <div className="pointer-events-none absolute -right-32 bottom-16 h-[400px] w-[400px] rounded-full blur-[100px]" style={{ background: "var(--brand-end)", opacity: 0.14 }} />
        {/* mesh grid overlay */}
        <div className="absolute inset-0 -z-10 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
        {/* top gradient wash */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent)]" />

        <div className="w-full max-w-[420px]">
          {/* ── premium glass card ─────────────────────────────── */}
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.06] p-8 shadow-[0_26px_90px_rgba(3,7,18,0.38)] backdrop-blur-xl sm:p-9">
            {/* top gradient line */}
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)]" />
            {/* inner inset border */}
            <div className="pointer-events-none absolute inset-[1px] rounded-[27px] border border-white/[0.06]" />

            <div className="relative mb-8 text-center">
              {/* ── brand badge (monogram-driven) ──────────────── */}
              <div className="mb-6 flex justify-center">
                <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 backdrop-blur-sm">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl">
                    <Image
                      src="/brands/migrateck-logo.png"
                      alt={brand.productName}
                      fill
                      className="object-contain"
                      priority
                    />
                  </div>
                  <div className="text-left leading-none">
                    <div className="text-lg font-semibold tracking-[-0.02em] text-white">
                      {brand.productName}
                    </div>
                    <div className="mt-1.5 text-[10px] font-medium uppercase tracking-[0.26em] text-white/50">
                      {brand.securityLabel ?? "Account access"}
                    </div>
                  </div>
                </div>
              </div>

              <h1 className="font-[var(--font-display)] text-[30px] font-bold tracking-[-0.03em] text-white sm:text-[32px]">
                Sign in to {brand.productName}
              </h1>

              <p className="mx-auto mt-2 max-w-[300px] text-sm leading-6 text-slate-300/80">
                Use your MigraTeck account to continue.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-4">
                <Input
                  id="login-email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />

                <PasswordInput
                  id="login-password"
                  label="Password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  error={error}
                />
              </div>

              <div className="flex justify-end">
                <Link
                  href={`/forgot-password${queryString ? `?${queryString}` : ""}`}
                  className="text-xs text-white/55 transition hover:text-white"
                >
                  Forgot password?
                </Link>
              </div>

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? "Signing in..." : "Sign in"}
              </Button>
            </form>

            <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3">
              <p className="text-center text-xs leading-5 text-white/45">
                Secure authentication powered by MigraTeck.
              </p>
            </div>

            <div className="mt-6 text-center text-sm text-white/55">
              Don&apos;t have an account?{" "}
              <Link
                href={`/signup${queryString ? `?${queryString}` : ""}`}
                className="font-semibold text-white transition hover:text-[var(--brand-accent)]"
              >
                Create one
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
