"use client";

import type { FormEvent } from "react";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MarketingSmsOptInFields } from "@/components/marketing/marketing-sms-opt-in-fields";
import { ActionButton } from "@/components/ui/button";
import { setAccessToken } from "@/lib/auth/client-token";
import { LEGAL_PAGE_PATHS } from "@/lib/legal";
import type { AuthPortalBranding } from "@/lib/migradrive-auth-branding";

export function SignupForm({ authBranding }: { authBranding: AuthPortalBranding }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [phone, setPhone] = useState("");
  const [smsMarketingConsent, setSmsMarketingConsent] = useState(false);
  const [acceptedLegalTerms, setAcceptedLegalTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [registrationSummary, setRegistrationSummary] = useState<{
    orgSlug: string;
    tenantStatus: string;
    planCode: string;
    storageQuotaGb: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        password,
        organizationName,
        phone: phone.trim() || null,
        smsMarketingConsent,
      }),
    });

    const payload = (await response.json()) as {
      message?: string;
      error?: string;
      data?: {
        accessToken?: string;
        organization?: { slug?: string };
        tenant?: { status?: string; planCode?: string; storageQuotaGb?: number };
        verificationRequired?: boolean;
      };
    };
    setIsLoading(false);

    if (!response.ok) {
      setError(payload.error || `Unable to create your ${authBranding.productName} account.`);
      return;
    }

    setAccessToken(payload.data?.accessToken || null);

    if (payload.data?.accessToken) {
      router.push("/app/drive");
      router.refresh();
      return;
    }

    setRegistrationSummary(
      payload.data?.organization?.slug && payload.data?.tenant?.status && payload.data?.tenant?.planCode && payload.data?.tenant?.storageQuotaGb
        ? {
            orgSlug: payload.data.organization.slug,
            tenantStatus: payload.data.tenant.status,
            planCode: payload.data.tenant.planCode,
            storageQuotaGb: payload.data.tenant.storageQuotaGb,
          }
        : null,
    );
      setMessage(payload.message || `Account created. Check your email to verify your ${authBranding.productName} access.`);
    setPassword("");
  }

  return (
    <div className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Full name</label>
          <input
            type="text"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Password</label>
          <input
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Organization name</label>
          <input
            type="text"
            required
            value={organizationName}
            onChange={(event) => setOrganizationName(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Mobile phone for sign-in codes</label>
          <input
            type="tel"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
            placeholder="(555) 555-5555"
          />
          <p className="mt-1 text-xs text-[var(--ink-muted)]">Optional, but required if you want to sign in with text-message codes.</p>
        </div>
        <MarketingSmsOptInFields
          phone={phone}
          onPhoneChange={setPhone}
          smsMarketingConsent={smsMarketingConsent}
          onConsentChange={setSmsMarketingConsent}
          disabled={isLoading}
          showPhoneField={false}
        />
        <label className="flex items-start gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm text-[var(--ink-muted)]">
          <input
            type="checkbox"
            required
            checked={acceptedLegalTerms}
            onChange={(event) => setAcceptedLegalTerms(event.target.checked)}
            className="mt-1 h-4 w-4 rounded border border-[var(--line)]"
          />
          <span>
            I agree to the{" "}
            <Link href={LEGAL_PAGE_PATHS.terms} className="font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link href={LEGAL_PAGE_PATHS.privacy} className="font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <ActionButton type="submit" disabled={isLoading || !acceptedLegalTerms} className="w-full">
          {isLoading ? "Creating account..." : `Create ${authBranding.shortName} account`}
        </ActionButton>
      </form>
      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
      {registrationSummary ? (
        <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <p className="font-semibold">Starter account path created.</p>
          <p className="mt-1">Organization slug: {registrationSummary.orgSlug}</p>
          <p>Tenant state: {registrationSummary.tenantStatus} · plan {registrationSummary.planCode} · {registrationSummary.storageQuotaGb} GiB quota</p>
          <p className="mt-2">
            Verify your email, then continue to <Link href="/login" className="font-semibold underline">login</Link>.
          </p>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </div>
  );
}
