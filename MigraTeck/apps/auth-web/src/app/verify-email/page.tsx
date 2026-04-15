"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button, toBrandStyle } from "@migrateck/auth-ui";
import { authFetch } from "@/lib/api";
import { resolveAuthBrandTheme } from "@/lib/branding";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const token = searchParams.get("token");
  const email = searchParams.get("email");
  const brand = useMemo(() => resolveAuthBrandTheme(clientId), [clientId]);
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);
  const queryString = searchParams.toString();

  const [status, setStatus] = useState<"idle" | "verifying" | "success" | "error">(token ? "verifying" : "idle");
  const [message, setMessage] = useState("");
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!token) {
      return;
    }

    authFetch<{ message?: string }>("/v1/verify-email", {
      method: "POST",
      body: { token },
    })
      .then((response) => {
        if (response.ok) {
          setStatus("success");
          setMessage("Your email has been verified. You can now continue securely.");
          return;
        }

        setStatus("error");
        setMessage(response.data.message ?? "Verification failed or the link has expired.");
      })
      .catch(() => {
        setStatus("error");
        setMessage("Network error. Please try again.");
      });
  }, [token]);

  async function handleResend(event: FormEvent) {
    event.preventDefault();
    if (!email) {
      return;
    }

    setResending(true);
    try {
      await authFetch("/v1/resend-verification", {
        method: "POST",
        body: { email },
      });
      setMessage("A new verification email has been sent.");
    } catch {
      setMessage("Could not resend the email. Please try again later.");
    } finally {
      setResending(false);
    }
  }

  const heading =
    status === "success"
      ? "Email verified"
      : status === "error"
        ? "Verification failed"
        : token
          ? "Verifying your email"
          : "Check your inbox";

  const subtitle =
    status === "success"
      ? "Your identity is confirmed. You can now access MigraTeck products."
      : status === "error"
        ? "The verification link is invalid or has expired."
        : token
          ? "We are validating this verification link now."
          : `We sent a verification link to ${email ?? "your inbox"}.`;

  return (
    <div className="min-h-screen text-white" style={brandStyle}>
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
              {/* ── brand badge ──────────────────────────────────── */}
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
                {heading}
              </h1>

              <p className="mx-auto mt-2 max-w-[300px] text-sm leading-6 text-slate-300/80">
                {subtitle}
              </p>
            </div>

            {status === "verifying" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-4 text-sm leading-6 text-white/70">
                  Please wait while we confirm your email address.
                </div>
              </div>
            ) : status === "success" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.06] px-4 py-4 text-sm leading-6 text-emerald-200">
                  {message}
                </div>

                <Button
                  type="button"
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    window.location.href = `/login${queryString ? `?${queryString}` : ""}`;
                  }}
                >
                  Continue to sign in
                </Button>
              </div>
            ) : status === "error" ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-rose-400/20 bg-rose-500/[0.06] px-4 py-4 text-sm leading-6 text-rose-200">
                  {message}
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    window.location.href = `/signup${queryString ? `?${queryString}` : ""}`;
                  }}
                >
                  Return to signup
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-4 text-sm leading-6 text-white/70">
                  Open the link in your email to activate your account. If you need another copy, request a resend below.
                </div>

                {message ? (
                  <div className="rounded-2xl border border-fuchsia-400/20 bg-fuchsia-500/[0.06] px-4 py-3 text-sm text-fuchsia-200">
                    {message}
                  </div>
                ) : null}

                {email ? (
                  <form onSubmit={handleResend}>
                    <Button type="submit" variant="secondary" className="w-full" size="lg" disabled={resending}>
                      {resending ? "Sending..." : "Resend verification email"}
                    </Button>
                  </form>
                ) : null}
              </div>
            )}

            <div className="mt-6 rounded-2xl border border-white/[0.08] bg-white/[0.025] px-4 py-3">
              <p className="text-center text-xs leading-5 text-white/45">
                Secure authentication powered by MigraTeck.
              </p>
            </div>

            <div className="mt-6 text-center text-sm text-white/55">
              <Link
                href={`/login${queryString ? `?${queryString}` : ""}`}
                className="font-semibold text-white transition hover:text-[var(--brand-accent)]"
              >
                Back to sign in
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense>
      <VerifyEmailInner />
    </Suspense>
  );
}
