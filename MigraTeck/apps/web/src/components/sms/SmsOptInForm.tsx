"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

/**
 * CTIA-compliant SMS consent disclosure shown beside the (unchecked-by-default)
 * checkbox. This exact text is submitted as `consentText` so the consent record
 * captures what the user agreed to. Keep this verbatim.
 */
export const SMS_CONSENT_DISCLOSURE =
  "By providing your mobile number and checking this box, you agree to receive recurring automated account verification, security, and service notification text messages from MigraTeck LLC (Pale / AnnouPale) at the number provided. Consent is not a condition of any purchase. Message frequency varies. Message and data rates may apply. Reply STOP to unsubscribe at any time and HELP for help. See our Privacy Policy and SMS Terms.";

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "success" }
  | { status: "error"; message: string };

export function SmsOptInForm() {
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const canSubmit = consent && phone.trim().length > 0 && state.status !== "submitting";

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setState({ status: "submitting" });

    try {
      const res = await fetch("/api/sms-opt-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: phone.trim(),
          consent: true,
          consentText: SMS_CONSENT_DISCLOSURE,
        }),
      });

      if (!res.ok) {
        let message = "We could not record your opt-in. Please try again.";
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          /* ignore body parse errors, keep default message */
        }
        setState({ status: "error", message });
        return;
      }

      setState({ status: "success" });
    } catch {
      setState({
        status: "error",
        message: "Network error. Please check your connection and try again.",
      });
    }
  }

  if (state.status === "success") {
    return (
      <div className={cn(ui.card, "p-6 sm:p-8")}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <div>
            <h3 className={cn(ui.h3, "text-xl")}>You&apos;re opted in</h3>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              Thanks — we&apos;ve recorded your consent. You can reply STOP to any message to
              unsubscribe at any time, or HELP for assistance.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={cn(ui.card, "p-6 sm:p-8")} noValidate>
      <label htmlFor="sms-phone" className="block text-sm font-semibold text-white">
        Mobile number
      </label>
      <input
        id="sms-phone"
        name="phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        placeholder="(555) 123-4567"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        className="mt-2 w-full rounded-xl border border-white/15 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 outline-none transition-colors focus:border-blue-400 focus:bg-white/[0.06]"
      />

      <div className="mt-6 flex items-start gap-3">
        <input
          id="sms-consent"
          name="consent"
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-4 w-4 shrink-0 rounded border-white/20 bg-white/[0.04] text-blue-500 focus:ring-blue-400"
        />
        <label htmlFor="sms-consent" className="text-sm leading-6 text-slate-300">
          By providing your mobile number and checking this box, you agree to receive recurring
          automated account verification, security, and service notification text messages from
          MigraTeck LLC (Pale / AnnouPale) at the number provided. Consent is not a condition of any
          purchase. Message frequency varies. Message and data rates may apply. Reply STOP to
          unsubscribe at any time and HELP for help. See our{" "}
          <Link href="/legal/privacy" className="font-semibold text-blue-400 hover:text-blue-300 underline underline-offset-2">
            Privacy Policy
          </Link>{" "}
          and{" "}
          <Link href="/legal/sms-terms" className="font-semibold text-blue-400 hover:text-blue-300 underline underline-offset-2">
            SMS Terms
          </Link>
          .
        </label>
      </div>

      {state.status === "error" ? (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {state.message}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className={cn(ui.btnPrimary, "mt-6 w-full disabled:cursor-not-allowed disabled:opacity-40")}
      >
        {state.status === "submitting" ? "Submitting…" : "Opt in to text messages"}
      </button>
    </form>
  );
}
