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
import { resolveAuthBrandTheme, resolveProductHomeUrl } from "@/lib/branding";

function extractApiErrorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const maybe = payload as {
    message?: unknown;
    error?: {
      message?: unknown;
      details?: Array<{ message?: unknown; path?: unknown }>;
    } | unknown;
  };

  if (typeof maybe.message === "string" && maybe.message.trim()) {
    return maybe.message;
  }

  if (
    maybe.error
    && typeof maybe.error === "object"
    && "message" in maybe.error
    && typeof (maybe.error as { message?: unknown }).message === "string"
    && (maybe.error as { message: string }).message.trim()
  ) {
    return (maybe.error as { message: string }).message;
  }

  if (
    maybe.error
    && typeof maybe.error === "object"
    && "details" in maybe.error
    && Array.isArray((maybe.error as { details?: unknown }).details)
  ) {
    const details = (maybe.error as { details: Array<{ message?: unknown; path?: unknown }> }).details;
    const first = details[0];
    if (first && typeof first.message === "string" && first.message.trim()) {
      if (Array.isArray(first.path) && first.path.length > 0) {
        return `${String(first.path[0])}: ${first.message}`;
      }
      return first.message;
    }
  }

  return fallback;
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const queryString = searchParams.toString();
  const effectiveClientId = clientId ?? "migraauth_web";
  const brand = useMemo(() => resolveAuthBrandTheme(clientId), [clientId]);
  const isAnnouPale = brand.productKey === "annoupale";
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);
  const productHomeUrl = useMemo(() => resolveProductHomeUrl(clientId), [clientId]);
  const legalTermsUrl = useMemo(() => {
    if (brand.productKey === "annoupale") {
      return "https://annoupale.com/terms";
    }
    return "https://migrateck.com/legal/terms";
  }, [brand.productKey]);
  const legalPaymentUrl = useMemo(() => {
    if (brand.productKey === "annoupale") {
      return "https://annoupale.com/payment-policy";
    }
    return "https://migrateck.com/legal/payment";
  }, [brand.productKey]);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [identifier, setIdentifier] = useState("");
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
        error?: {
          message?: string;
          details?: Array<{ message?: string; path?: Array<string | number> }>;
        };
        challenge_id?: string;
        channel?: string;
        masked_destination?: string;
      }>("/v1/signup", {
        method: "POST",
        body: {
          identifier: identifier.trim(),
          // Backward compatibility for staging auth-api revisions that still require `email`.
          email: identifier.trim(),
          password,
          display_name: [firstName, lastName].filter(Boolean).join(" ") || undefined,
          client_id: effectiveClientId,
          redirect_uri: redirectUri ?? `${window.location.origin}/login`,
        },
      });

      if (!response.ok) {
        setError(extractApiErrorMessage(response.data, "Signup failed. Please check your details and try again."));
        setLoading(false);
        return;
      }

      const verifyUrl = new URL("/verify-email", window.location.origin);
      if (response.data.challenge_id) {
        verifyUrl.searchParams.set("challenge_id", response.data.challenge_id);
      }
      verifyUrl.searchParams.set("identifier", identifier);
      if (response.data.channel) {
        verifyUrl.searchParams.set("channel", response.data.channel);
      }
      if (response.data.masked_destination) {
        verifyUrl.searchParams.set("masked_destination", response.data.masked_destination);
      }
      if (queryString) {
        new URLSearchParams(queryString).forEach((value, key) => {
          verifyUrl.searchParams.set(key, value);
        });
      }

      router.push(verifyUrl.pathname + verifyUrl.search);
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
                <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 backdrop-blur-sm">
                  <div className={isAnnouPale ? "relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl" : "relative h-11 w-11 shrink-0 overflow-hidden rounded-2xl"}>
                    <Image
                      src={brand.productKey === "annoupale" ? "/brands/products/annoupale-official_logo.png" : "/brands/migrateck-logo.png"}
                      alt={brand.productName}
                      fill
                      className={isAnnouPale ? "object-contain scale-[1.22]" : "object-contain"}
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
                id="signup-identifier"
                label="Email or phone"
                type="text"
                autoComplete="username"
                placeholder="you@company.com or +1 555 555 0123"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
              />

              <PasswordInput
                id="signup-password"
                label="Password"
                autoComplete="new-password"
                placeholder="Create a password"
                hint="At least 10 characters. MFA and passkeys can be added after signup."
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
                  and understand this account will be used for {new URL(productHomeUrl).hostname.replace(/^www\./, "")}.
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
