"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ActionButton } from "@/components/ui/button";
import { setAccessToken } from "@/lib/auth/client-token";
import type { AuthPortalBranding } from "@/lib/migradrive-auth-branding";

export function LoginForm({ authBranding }: { authBranding: AuthPortalBranding }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [smsCode, setSmsCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSmsLoading, setIsSmsLoading] = useState(false);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [smsCodeSent, setSmsCodeSent] = useState(false);
  const [smsMessage, setSmsMessage] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const router = useRouter();

  const callbackUrl = useMemo(() => {
    const next = searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) {
      return next;
    }
    return authBranding.appLandingPath;
  }, [searchParams]);
  const magicLinkEnabled = process.env.NEXT_PUBLIC_ENABLE_MAGIC_LINKS === "true";
  const smsLoginEnabled = process.env.NEXT_PUBLIC_ENABLE_SMS_LOGIN !== "false";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsLoading(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        password,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { data?: { accessToken?: string }; error?: string }
      | null;

    setIsLoading(false);

    if (!response.ok) {
      if (response.status === 403) {
        setError(authBranding.verifyEmailMessage);
        return;
      }

      if (response.status === 429) {
        setError("Too many login attempts. Try again later.");
        return;
      }

      setError(payload?.error || authBranding.invalidCredentialsMessage);
      return;
    }

    setAccessToken(payload?.data?.accessToken || null);

    router.push(callbackUrl);
    router.refresh();
  }

  async function handleMagicLink() {
    setError(null);
    setMagicLinkSent(false);
    setIsLoading(true);

    const response = await fetch("/api/auth/magic-link/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        callbackUrl,
      }),
    });

    setIsLoading(false);

    if (!response.ok) {
      setError("Magic link is unavailable right now.");
      return;
    }

    setMagicLinkSent(true);
  }

  async function handleSmsRequest() {
    setError(null);
    setSmsMessage(null);
    setIsSmsLoading(true);

    const response = await fetch("/api/auth/sms/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        phone,
      }),
    });

    setIsSmsLoading(false);

    if (!response.ok) {
      if (response.status === 429) {
        setError("Too many code requests. Try again later.");
        return;
      }

      setError("SMS delivery is unavailable right now.");
      return;
    }

    setSmsCodeSent(true);
    setSmsMessage("If the number is eligible, a sign-in code has been sent.");
  }

  async function handleSmsVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSmsMessage(null);
    setIsSmsLoading(true);

    const response = await fetch("/api/auth/sms/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        phone,
        code: smsCode,
      }),
    });

    setIsSmsLoading(false);

    if (!response.ok) {
      if (response.status === 429) {
        setError("Too many verification attempts. Try again later.");
        return;
      }

      setError("Invalid or expired code.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm">
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div>
          <label htmlFor="login-email" className="mb-1 block text-sm font-semibold text-[var(--ink)]">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label htmlFor="login-password" className="mb-1 block text-sm font-semibold text-[var(--ink)]">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <ActionButton type="submit" disabled={isLoading} className="w-full">
          {isLoading ? "Signing in..." : authBranding.signInLabel}
        </ActionButton>
      </form>
      {magicLinkEnabled ? (
        <ActionButton variant="secondary" className="w-full" onClick={handleMagicLink} disabled={isLoading || !email}>
          Send magic link
        </ActionButton>
      ) : null}
      {magicLinkSent ? <p className="text-sm text-green-700">{authBranding.magicLinkMessage}</p> : null}
      {smsLoginEnabled ? (
        <div className="space-y-4 border-t border-[var(--line)] pt-4">
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">{authBranding.smsHeading}</p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">{authBranding.smsDescription}</p>
          </div>
          <form className="space-y-4" onSubmit={handleSmsVerify}>
            <div>
              <label htmlFor="login-phone" className="mb-1 block text-sm font-semibold text-[var(--ink)]">
                Mobile phone
              </label>
              <input
                id="login-phone"
                type="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
                placeholder="(555) 555-5555"
              />
            </div>
            {smsCodeSent ? (
              <div>
                <label htmlFor="login-sms-code" className="mb-1 block text-sm font-semibold text-[var(--ink)]">
                  Verification code
                </label>
                <input
                  id="login-sms-code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  value={smsCode}
                  onChange={(event) => setSmsCode(event.target.value)}
                  className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm tracking-[0.35em] text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
                  placeholder="123456"
                />
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionButton variant="secondary" onClick={handleSmsRequest} disabled={isSmsLoading || !phone}>
                {isSmsLoading ? "Sending..." : "Send code"}
              </ActionButton>
              {smsCodeSent ? (
                <ActionButton type="submit" disabled={isSmsLoading || smsCode.trim().length !== 6}>
                  {isSmsLoading ? "Signing in..." : "Sign in with code"}
                </ActionButton>
              ) : null}
            </div>
          </form>
          {smsMessage ? <p className="text-sm text-green-700">{smsMessage}</p> : null}
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
