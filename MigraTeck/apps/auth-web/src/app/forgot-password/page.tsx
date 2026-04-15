"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { Button, Input, toBrandStyle } from "@migrateck/auth-ui";
import { authFetch } from "@/lib/api";
import { resolveAuthBrandTheme } from "@/lib/branding";

function ForgotPasswordInner() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const brand = useMemo(() => resolveAuthBrandTheme(clientId), [clientId]);
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);
  const queryString = searchParams.toString();

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const response = await authFetch<{ message?: string }>("/v1/forgot-password", {
        method: "POST",
        body: {
          email,
          client_id: clientId ?? undefined,
        },
      });

      if (!response.ok) {
        setError(response.data.message ?? "Could not send a reset link right now.");
        setLoading(false);
        return;
      }

      setSent(true);
      setLoading(false);
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen text-white" style={brandStyle}>
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#080b20_0%,#0f1733_48%,#080b20_100%)]" />
        <div className="pointer-events-none absolute -left-40 top-16 h-[500px] w-[500px] rounded-full blur-[120px]" style={{ background: "var(--brand-start)", opacity: 0.18 }} />
        <div className="pointer-events-none absolute -right-32 bottom-16 h-[400px] w-[400px] rounded-full blur-[100px]" style={{ background: "var(--brand-end)", opacity: 0.14 }} />
        <div className="absolute inset-0 -z-10 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent)]" />

        <div className="w-full max-w-[420px]">
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.06] p-8 shadow-[0_26px_90px_rgba(3,7,18,0.38)] backdrop-blur-xl sm:p-9">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)]" />
            <div className="pointer-events-none absolute inset-[1px] rounded-[27px] border border-white/[0.06]" />

            <div className="relative mb-8 text-center">
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
                {sent ? "Check your email" : "Reset your password"}
              </h1>

              <p className="mx-auto mt-2 max-w-[300px] text-sm leading-6 text-slate-300/80">
                {sent
                  ? `If an account exists for ${email}, a reset link is on the way.`
                  : "Enter your email and we will send you a secure reset link."}
              </p>
            </div>

            {sent ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-4 text-sm leading-6 text-white/70">
                  Open the email, follow the link, and return here to choose a new password. If it does not show up right away, check spam or junk.
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  className="w-full"
                  size="lg"
                  onClick={() => {
                    setSent(false);
                    setError("");
                  }}
                >
                  Send another link
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <Input
                  id="forgot-password-email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="you@company.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  error={error}
                />

                <Button type="submit" className="w-full" size="lg" disabled={loading}>
                  {loading ? "Sending..." : "Send reset link"}
                </Button>
              </form>
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

export default function ForgotPasswordPage() {
  return (
    <Suspense>
      <ForgotPasswordInner />
    </Suspense>
  );
}
