"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/button";
import { LEGAL_PAGE_PATHS } from "@/lib/legal";
import { defaultAuthPortalBranding, resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";
import {
  acceptAllCookieConsent,
  COOKIE_CONSENT_OPEN_EVENT,
  COOKIE_CONSENT_UPDATED_EVENT,
  getCookieConsent,
  getCookieConsentPreferences,
  rejectOptionalCookieConsent,
  setCookieConsent,
  type CookieConsentRecord,
} from "@/lib/privacy/cookie-consent";

export function CookieConsentBanner() {
  const [consentRecord, setConsentRecord] = useState<CookieConsentRecord | null>(null);
  const [brandingHost, setBrandingHost] = useState(defaultAuthPortalBranding.host);
  const [visible, setVisible] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(false);
  const [preferencesEnabled, setPreferencesEnabled] = useState(false);

  useEffect(() => {
    setBrandingHost(window.location.host);

    function syncFromStorage() {
      const record = getCookieConsent();
      const preferences = getCookieConsentPreferences(record);
      setConsentRecord(record);
      setAnalyticsEnabled(preferences.analytics);
      setPreferencesEnabled(preferences.preferences);
      setVisible(!record);
    }

    function handleOpenPreferences() {
      syncFromStorage();
      setShowPreferences(true);
      setVisible(true);
    }

    syncFromStorage();
    window.addEventListener(COOKIE_CONSENT_UPDATED_EVENT, syncFromStorage as EventListener);
    window.addEventListener(COOKIE_CONSENT_OPEN_EVENT, handleOpenPreferences);

    return () => {
      window.removeEventListener(COOKIE_CONSENT_UPDATED_EVENT, syncFromStorage as EventListener);
      window.removeEventListener(COOKIE_CONSENT_OPEN_EVENT, handleOpenPreferences);
    };
  }, []);

  const authBranding = resolveAuthPortalBranding(brandingHost);

  function handleAcceptAll() {
    const record = acceptAllCookieConsent();
    if (record) {
      setConsentRecord(record);
    }
    setVisible(false);
    setShowPreferences(false);
  }

  function handleRejectOptional() {
    const record = rejectOptionalCookieConsent();
    if (record) {
      setConsentRecord(record);
    }
    setVisible(false);
    setShowPreferences(false);
  }

  function handleSavePreferences() {
    const record = setCookieConsent({
      analytics: analyticsEnabled,
      preferences: preferencesEnabled,
      source: "preferences_center",
    });
    if (record) {
      setConsentRecord(record);
    }
    setVisible(false);
    setShowPreferences(false);
  }

  if (!visible && !showPreferences) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 px-4 pb-4 sm:px-6 sm:pb-6">
      <div className="pointer-events-auto mx-auto flex w-full max-w-5xl flex-col gap-4 rounded-[2rem] border border-slate-800 bg-[radial-gradient(circle_at_top_left,rgba(109,94,252,0.14),transparent_30%),linear-gradient(180deg,#0b1220,#111827)] p-5 text-white shadow-[0_30px_80px_rgba(15,23,42,0.45)] sm:p-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-3xl">
          <p className="text-lg font-bold tracking-tight">Your privacy choices</p>
          <p className="mt-2 text-sm leading-6 text-white/72">
            {authBranding.cookieDescription} Read our{" "}
            <Link href={LEGAL_PAGE_PATHS.privacy} className="font-semibold text-white underline underline-offset-4 hover:text-white/85">
              Privacy Policy
            </Link>{" "}
            and{" "}
            <Link href={LEGAL_PAGE_PATHS.terms} className="font-semibold text-white underline underline-offset-4 hover:text-white/85">
              Terms of Service
            </Link>
            .
          </p>
          {showPreferences ? (
            <div className="mt-4 space-y-3 rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-white">Essential storage</p>
                    <p className="mt-1 text-sm text-white/68">
                      Required for secure login, session continuity, and consent records. This category is always active.
                    </p>
                  </div>
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/12 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
                    Always on
                  </span>
                </div>
              </div>
              <label className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">Preference storage</p>
                  <p className="mt-1 text-sm text-white/68">
                    Remembers non-essential interface choices so returning users get a stable experience.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={preferencesEnabled}
                  onChange={(event) => setPreferencesEnabled(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border border-white/20 bg-transparent"
                />
              </label>
              <label className="flex items-start justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-white">Optional analytics</p>
                  <p className="mt-1 text-sm text-white/68">
                    Enables event measurement for onboarding and marketing flows only after explicit consent.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={analyticsEnabled}
                  onChange={(event) => setAnalyticsEnabled(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border border-white/20 bg-transparent"
                />
              </label>
              <p className="text-xs text-white/55">
                Consent version {consentRecord?.version || "pending"}
                {consentRecord?.updatedAt ? ` · updated ${new Date(consentRecord.updatedAt).toLocaleString()}` : ""}
              </p>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ActionButton type="button" variant="ghost" onClick={() => setShowPreferences((current) => !current)} className="rounded-full border border-white/15 px-5 py-3 text-white hover:bg-white/8">
            {showPreferences ? "Hide preferences" : "Manage preferences"}
          </ActionButton>
          <ActionButton type="button" variant="ghost" onClick={handleRejectOptional} className="rounded-full border border-white/15 px-5 py-3 text-white hover:bg-white/8">
            Reject optional cookies
          </ActionButton>
          {showPreferences ? (
            <ActionButton type="button" variant="secondary" onClick={handleSavePreferences} className="rounded-full px-5 py-3">
              Save preferences
            </ActionButton>
          ) : null}
          <ActionButton type="button" onClick={handleAcceptAll} className="rounded-full px-5 py-3">
            Accept all cookies
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
