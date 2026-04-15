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

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const queryString = searchParams.toString();
  const effectiveClientId = clientId ?? "migraauth_web";
  const brand = useMemo(() => resolveAuthBrandTheme(clientId), [clientId]);
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);
  const legalTermsUrl = "https://migrateck.com/legal/terms";
  const legalPaymentUrl = "https://migrateck.com/legal/payment";

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    if (!acceptedTerms) {
      setError("You must accept the terms to continue.");
      return;
    }

    setLoading(true);

    try {
      const response = await authFetch<{
        message?: string;
      }>("/v1/signup", {
        method: "POST",
        body: {
          email,
          password,
          display_name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
          client_id: effectiveClientId,
          redirect_uri: redirectUri ?? `${window.location.origin}/login`,
        },
      });

      if (!response.ok) {
        setError(response.data.message ?? "Signup failed.");
        setLoading(false);
        return;
      }

      router.push(`/verify-email?email=${encodeURIComponent(email)}${queryString ? `&${queryString}` : ""}`);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
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

        <div className="w-full max-w-[480px]">
          {/* ── premium glass card ─────────────────────────────── */}
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.06] p-8 shadow-[0_26px_90px_rgba(3,7,18,0.38)] backdrop-blur-xl sm:p-9">
            {/* top gradient line */}
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)]" />
            {/* inner inset border */}
            <div className="pointer-events-none absolute inset-[1px] rounded-[27px] border border-white/[0.06]" />

            <div className="relative mb-6 text-center">
              {/* ── brand badge ──────────────────────────────────── */}
              <div className="mb-5 flex justify-center">
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
                      Platform Access
                    </div>
                  </div>
                </div>
              </div>

              <h1 className="font-[var(--font-display)] text-[26px] font-bold tracking-[-0.03em] text-white sm:text-[28px]">
                Create your {brand.productName} access
              </h1>

              <p className="mx-auto mt-2 max-w-[340px] text-sm leading-6 text-slate-300/80">
                Set up your secure identity once, then continue into the product experience.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  id="signup-first-name"
                  label="First name"
                  autoComplete="given-name"
                  placeholder="Avery"
                  value={firstName}
                  onChange={(event) => setFirstName(event.target.value)}
                />
                <Input
                  id="signup-last-name"
                  label="Last name"
                  autoComplete="family-name"
                  placeholder="Morgan"
                  value={lastName}
                  onChange={(event) => setLastName(event.target.value)}
                />
              </div>

              <Input
                id="signup-email"
                label="Email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />

              <PasswordInput
                id="signup-password"
                label="Password"
                autoComplete="new-password"
                placeholder="Create a password"
                hint="At least 8 characters. MFA and passkeys can be added after signup."
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />

              <PasswordInput
                id="signup-confirm-password"
                label="Confirm password"
                autoComplete="new-password"
                placeholder="Repeat your password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                error={error}
              />

              <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-zinc-300">
                <input
                  type="checkbox"
                  checked={acceptedTerms}
                  onChange={(event) => setAcceptedTerms(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-white/20 bg-transparent"
                />
                <span>
                  I agree to the{" "}
                  <Link
                    href={legalTermsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-white underline underline-offset-4"
                  >
                    Terms of Service
                  </Link>{" "}
                  and{" "}
                  <Link
                    href={legalPaymentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-semibold text-white underline underline-offset-4"
                  >
                    Payment Policy
                  </Link>{" "}
                  and understand this account will be used across the MigraTeck ecosystem.
                </span>
              </label>

              <Button type="submit" className="w-full" size="lg" disabled={loading}>
                {loading ? "Creating account..." : "Create account"}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-white/55">
              Already have an account?{" "}
              <Link
                href={`/login${queryString ? `?${queryString}` : ""}`}
                className="font-semibold text-white transition hover:text-[var(--brand-accent)]"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupForm />
    </Suspense>
  );
}
