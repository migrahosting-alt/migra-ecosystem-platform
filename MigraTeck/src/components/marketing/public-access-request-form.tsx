"use client";

import { useEffect, useState } from "react";
import { MarketingSmsOptInFields } from "@/components/marketing/marketing-sms-opt-in-fields";
import { ActionButton } from "@/components/ui/button";
import { canUseOptionalAnalytics } from "@/lib/privacy/cookie-consent";
import type { MigraHostingBillingCycle } from "@/lib/migrahosting-pricing";

const defaultResponseSlaBusinessDays = 2;

interface PublicAccessRequestFormProps {
  source: "signup_blocked" | "request_access_page";
  intro: string;
  productLabel?: string;
  interestContext?: {
    productInterest?: string | undefined;
    planInterest?: string | undefined;
    billingPreference?: MigraHostingBillingCycle | undefined;
    sourceContext?: string | undefined;
    defaultUseCase?: string | undefined;
  };
}

interface RequestAccessResponse {
  message?: string;
  error?: string;
  reference?: string;
  responseSlaBusinessDays?: number;
  confirmationEmailSent?: boolean;
}

interface SubmissionState {
  email: string;
  reference: string | null;
  responseSlaBusinessDays: number;
  confirmationEmailSent: boolean;
}

function getEmailDomain(email: string): string {
  const [, domain] = email.toLowerCase().split("@");
  return domain || "unknown";
}

function trackMarketingEvent(eventName: string, properties: Record<string, unknown>) {
  if (typeof window === "undefined") {
    return;
  }

  if (!canUseOptionalAnalytics()) {
    return;
  }

  const payload = { event: eventName, ...properties };
  const analyticsWindow = window as Window & {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    plausible?: (...args: unknown[]) => void;
  };

  if (Array.isArray(analyticsWindow.dataLayer)) {
    analyticsWindow.dataLayer.push(payload);
  }

  if (typeof analyticsWindow.gtag === "function") {
    analyticsWindow.gtag("event", eventName, properties);
  }

  if (typeof analyticsWindow.plausible === "function") {
    analyticsWindow.plausible(eventName, { props: properties });
  }

  window.dispatchEvent(new CustomEvent("migrateck:analytics", { detail: payload }));
}

export function PublicAccessRequestForm({ source, intro, productLabel = "MigraDrive", interestContext }: PublicAccessRequestFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [useCase, setUseCase] = useState(interestContext?.defaultUseCase || "");
  const [phone, setPhone] = useState("");
  const [smsMarketingConsent, setSmsMarketingConsent] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submission, setSubmission] = useState<SubmissionState | null>(null);

  const selectedInterest = [interestContext?.productInterest, interestContext?.planInterest]
    .filter((value): value is string => Boolean(value))
    .join(" · ");
  const selectedBillingLabel =
    interestContext?.billingPreference === "yearly"
      ? "Yearly billing preference"
      : interestContext?.billingPreference === "monthly"
        ? "Monthly billing preference"
        : null;

  useEffect(() => {
    if (source === "signup_blocked") {
      trackMarketingEvent("view_signup_blocked", {
        source,
        path: window.location.pathname,
      });
    }
  }, [source]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setError(null);

    const normalizedName = name.trim();
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedCompany = company.trim();
    const normalizedUseCase = useCase.trim();

    let response: Response;
    try {
      response = await fetch("/api/auth/request-access", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: normalizedName,
          email: normalizedEmail,
          company: normalizedCompany,
          useCase: normalizedUseCase,
          phone: phone.trim() || null,
          smsMarketingConsent,
          productInterest: interestContext?.productInterest,
          planInterest: interestContext?.planInterest,
          billingPreference: interestContext?.billingPreference,
          sourceContext: interestContext?.sourceContext,
        }),
      });
    } catch {
      setIsLoading(false);
      setError("Unable to submit your request right now. Please try again.");
      return;
    }

    const payload = (await response.json().catch(() => null)) as RequestAccessResponse | null;

    setIsLoading(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to submit your request right now. Please try again.");
      return;
    }

    const responseSlaBusinessDays = payload?.responseSlaBusinessDays || defaultResponseSlaBusinessDays;
    const confirmationEmailSent = Boolean(payload?.confirmationEmailSent);

    setSubmission({
      email: normalizedEmail,
      reference: payload?.reference || null,
      responseSlaBusinessDays,
      confirmationEmailSent,
    });

    setName("");
    setEmail("");
    setCompany("");
    setUseCase("");
    setPhone("");
    setSmsMarketingConsent(false);

    trackMarketingEvent("request_access_submitted", {
      source,
      path: window.location.pathname,
      emailDomain: getEmailDomain(normalizedEmail),
      responseSlaBusinessDays,
      confirmationEmailSent,
      productInterest: interestContext?.productInterest,
      planInterest: interestContext?.planInterest,
      billingPreference: interestContext?.billingPreference,
    });
  }

  if (submission) {
    return (
      <article className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <h2 className="text-xl font-bold text-emerald-900">
          {source === "signup_blocked" ? `${productLabel} access request received` : "Access request received"}
        </h2>
        <p className="mt-2 text-sm text-emerald-800">
          {source === "signup_blocked" ? `${productLabel} onboarding` : "Platform operations"} reviews requests within {submission.responseSlaBusinessDays} business days.
        </p>
        <p className="mt-2 text-sm text-emerald-800">
          {submission.confirmationEmailSent
            ? `A confirmation email was sent to ${submission.email}.`
            : `We will follow up at ${submission.email}.`}
        </p>
        {submission.reference ? (
          <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-emerald-700">Reference: {submission.reference}</p>
        ) : null}
      </article>
    );
  }

  const heading = source === "signup_blocked" ? `${productLabel} signup is currently unavailable` : "Request access";
  const actionLabel =
    source === "signup_blocked"
      ? `Request ${productLabel} access`
      : interestContext?.planInterest
        ? `Request ${interestContext.planInterest}`
        : interestContext?.productInterest
          ? `Request ${interestContext.productInterest}`
          : "Request Access";

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold">{heading}</h2>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">{intro}</p>
      <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        Typical response time: within 2 business days
      </p>
      {selectedInterest ? (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <p className="font-semibold">Selected infrastructure request</p>
          <p className="mt-1">{selectedInterest}</p>
          {selectedBillingLabel ? <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-emerald-700">{selectedBillingLabel}</p> : null}
        </div>
      ) : null}
      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Full name</label>
          <input
            type="text"
            required
            minLength={2}
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Work email</label>
          <input
            type="email"
            required
            maxLength={320}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Company</label>
          <input
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Use case</label>
          <textarea
            required
            minLength={20}
            maxLength={2000}
            value={useCase}
            onChange={(event) => setUseCase(event.target.value)}
            rows={4}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
            placeholder={interestContext?.planInterest ? "Describe the workload, expected cutover timing, region, and management expectations for this VPS request." : "Describe your team, rollout goals, and expected timeline."}
          />
        </div>
        <MarketingSmsOptInFields
          phone={phone}
          onPhoneChange={setPhone}
          smsMarketingConsent={smsMarketingConsent}
          onConsentChange={setSmsMarketingConsent}
          disabled={isLoading}
        />
        <ActionButton type="submit" disabled={isLoading} className="w-full">
          {isLoading ? "Submitting request..." : actionLabel}
        </ActionButton>
      </form>
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
    </article>
  );
}
