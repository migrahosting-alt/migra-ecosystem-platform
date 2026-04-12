"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface MigraMarketOptInFormProps {
  orgSlug: string;
  formSlug: string;
  orgName: string;
  brandName: string;
  supportEmail: string | null;
  thankYouMessage: string;
  consentLabel: string;
}

export function MigraMarketOptInForm({
  orgSlug,
  formSlug,
  orgName,
  brandName,
  supportEmail,
  thankYouMessage,
  consentLabel,
}: MigraMarketOptInFormProps) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const disclosure = useMemo(() => {
    const supportLine = supportEmail ? ` Questions: ${supportEmail}.` : "";
    return `By opting in, you agree to receive marketing and update messages from ${brandName}. Consent is not a condition of purchase. Reply STOP to opt out and HELP for help. Message and data rates may apply.${supportLine}`;
  }, [brandName, supportEmail]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch("/api/migramarket/intake/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orgSlug,
          formSlug,
          fullName,
          phone,
          email: email || null,
          company: company || null,
          landingPage: `/migramarket/opt-in/${orgSlug}/${formSlug}`,
          notes: "sms_opt_in_landing_page",
          smsConsent: true,
        }),
      });

      const payload = (await response.json().catch(() => null)) as { error?: string; thankYouMessage?: string } | null;
      if (!response.ok) {
        setError(payload?.error || "We could not record your opt-in right now.");
        return;
      }

      setSuccess(payload?.thankYouMessage || thankYouMessage);
      setFullName("");
      setPhone("");
      setEmail("");
      setCompany("");
      setSmsConsent(false);
    } catch {
      setError("We could not record your opt-in right now.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-[2rem] border border-[var(--line)] bg-white/95 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur">
      <div className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--brand-600)]">SMS Opt-In</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--ink)]">
          Subscribe to {brandName} text updates.
        </h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-muted)]">
          Use this page to collect documented SMS consent before adding anyone to a marketing audience. Best uses:
          email outreach, QR codes, website buttons, social bios, or direct messages.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 grid gap-4 md:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-[var(--ink-muted)]">Full name</span>
          <input
            required
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] px-3 py-2"
            placeholder="First and last name"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-[var(--ink-muted)]">Mobile phone</span>
          <input
            required
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] px-3 py-2"
            placeholder="(555) 555-5555"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-[var(--ink-muted)]">Email</span>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] px-3 py-2"
            placeholder="name@example.com"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-[var(--ink-muted)]">Company</span>
          <input
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] px-3 py-2"
            placeholder={orgName}
          />
        </label>

        <label className="md:col-span-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm leading-6 text-[var(--ink)]">
          <span className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={smsConsent}
              onChange={(event) => setSmsConsent(event.target.checked)}
              className="mt-1"
              required
            />
            <span>
              <span className="block font-semibold">{consentLabel}</span>
              <span className="mt-2 block text-[var(--ink-muted)]">{disclosure}</span>
            </span>
          </span>
        </label>

        <div className="md:col-span-2 flex flex-wrap items-center gap-3">
          <ActionButton type="submit" disabled={submitting || !smsConsent}>
            {submitting ? "Submitting..." : "Opt in to SMS updates"}
          </ActionButton>
          {success ? <span className="text-sm text-green-700">{success}</span> : null}
          {error ? <span className="text-sm text-red-700">{error}</span> : null}
        </div>
      </form>
    </div>
  );
}
