"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  Button,
  Input,
  OtpInput,
  toBrandStyle,
} from "@migrateck/auth-ui";
import { authFetch } from "@/lib/api";
import { buildContinueLabel, resolveAuthBrandTheme } from "@/lib/branding";

type Method = "totp" | "recovery" | "passkey";

function MfaForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = searchParams.get("client_id");
  const redirectUri = searchParams.get("redirect_uri");
  const state = searchParams.get("state");
  const codeChallenge = searchParams.get("code_challenge");
  const codeChallengeMethod = searchParams.get("code_challenge_method");
  const scope = searchParams.get("scope");
  const nonce = searchParams.get("nonce");
  const brand = useMemo(() => resolveAuthBrandTheme(clientId), [clientId]);
  const brandStyle = useMemo(() => toBrandStyle(brand), [brand]);

  const [method, setMethod] = useState<Method>("totp");
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setCode(["", "", "", "", "", ""]);
    setRecoveryCode("");
    setError("");
  }, [method]);

  async function completeOAuthFlow() {
    if (!clientId || !redirectUri) {
      router.push("/");
      return;
    }

    const response = await authFetch<{ code?: string }>("/authorize/complete", {
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

    if (!response.ok || !response.data.code) {
      router.push("/");
      return;
    }

    const url = new URL(redirectUri);
    url.searchParams.set("code", response.data.code);
    if (state) {
      url.searchParams.set("state", state);
    }
    window.location.href = url.toString();
  }

  async function handleVerify(event: FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      let payload: { code: string } | { recoveryCode: string };

      if (method === "recovery") {
        const sanitizedRecoveryCode = recoveryCode.trim();
        if (!sanitizedRecoveryCode) {
          setError("Enter a recovery code.");
          setLoading(false);
          return;
        }
        payload = { recoveryCode: sanitizedRecoveryCode };
      } else {
        const totpCode = code.join("");
        if (totpCode.length !== 6) {
          setError("Enter all 6 digits.");
          setLoading(false);
          return;
        }
        payload = { code: totpCode };
      }

      const response = await authFetch<{ message?: string }>("/v1/mfa/totp/verify", {
        method: "POST",
        body: payload,
      });

      if (!response.ok) {
        setError(response.data.message ?? "Verification failed.");
        setLoading(false);
        return;
      }

      await completeOAuthFlow();
    } catch {
      setError("Network error. Please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen text-white" style={brandStyle}>
      <div className="relative isolate flex min-h-screen items-center justify-center overflow-hidden px-4 py-10 sm:px-6">
        {/* ── background ─── */}
        <div className="absolute inset-0 -z-10 bg-[linear-gradient(180deg,#080b20_0%,#0f1733_48%,#080b20_100%)]" />
        <div className="pointer-events-none absolute -left-40 top-16 h-[500px] w-[500px] rounded-full blur-[120px]" style={{ background: "var(--brand-start)", opacity: 0.18 }} />
        <div className="pointer-events-none absolute -right-32 bottom-16 h-[400px] w-[400px] rounded-full blur-[100px]" style={{ background: "var(--brand-end)", opacity: 0.14 }} />
        <div className="absolute inset-0 -z-10 opacity-[0.03] [background-image:linear-gradient(rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:40px_40px]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),transparent)]" />

        <div className="w-full max-w-[440px]">
          {/* ── glass card ─── */}
          <div className="relative overflow-hidden rounded-[28px] border border-white/[0.14] bg-white/[0.06] p-8 shadow-[0_26px_90px_rgba(3,7,18,0.38)] backdrop-blur-xl sm:p-9">
            <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.6),transparent)]" />
            <div className="pointer-events-none absolute inset-[1px] rounded-[27px] border border-white/[0.06]" />

            <div className="relative space-y-6">
              {/* ── brand badge ─── */}
              <div className="flex justify-center">
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
                      {clientId ? buildContinueLabel(clientId) : "Protected entry"}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── heading ─── */}
              <div className="text-center">
                <h1 className="text-2xl font-semibold tracking-tight text-white">Two-factor authentication</h1>
                <p className="mt-2 text-sm text-white/50">
                  Choose a verification method and continue securely.
                </p>
              </div>

              {/* ── method selector ─── */}
              <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/15 p-1">
                {[
                  { key: "totp", label: "Authenticator" },
                  { key: "recovery", label: "Recovery code" },
                  { key: "passkey", label: "Passkey" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setMethod(item.key as Method)}
                    className={
                      method === item.key
                        ? "rounded-2xl bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] px-3 py-3 text-sm font-semibold text-white"
                        : "rounded-2xl px-3 py-3 text-sm font-medium text-zinc-400 transition hover:text-white"
                    }
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* ── form ─── */}
              {method === "passkey" ? (
                <div className="space-y-4 rounded-2xl border border-white/10 bg-black/15 p-5">
                  <p className="text-sm text-zinc-300">
                    Passkey challenge UI is reserved here, but passkey verification is not enabled in this deployment yet.
                  </p>
                  <Button type="button" variant="secondary" className="w-full" disabled>
                    Passkey challenge unavailable
                  </Button>
                </div>
              ) : (
                <form onSubmit={handleVerify} className="space-y-4">
                  {method === "totp" ? (
                    <div className="space-y-4 rounded-2xl border border-white/10 bg-black/15 p-5">
                      <OtpInput value={code} onChange={setCode} />
                      <p className="text-center text-sm text-zinc-400">
                        Enter the 6-digit code from your authenticator app. Codes refresh every 30 seconds.
                      </p>
                    </div>
                  ) : (
                    <Input
                      id="recovery-code"
                      label="Recovery code"
                      placeholder="xxxx-xxxx"
                      value={recoveryCode}
                      onChange={(event) => setRecoveryCode(event.target.value)}
                    />
                  )}

                  {error ? <p className="text-sm text-rose-300">{error}</p> : null}

                  <Button type="submit" className="w-full" size="lg" disabled={loading}>
                    {loading ? "Verifying..." : "Verify and continue"}
                  </Button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MfaPage() {
  return (
    <Suspense>
      <MfaForm />
    </Suspense>
  );
}
