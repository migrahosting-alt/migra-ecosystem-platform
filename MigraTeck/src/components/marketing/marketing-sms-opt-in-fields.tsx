"use client";

interface MarketingSmsOptInFieldsProps {
  phone: string;
  onPhoneChange: (value: string) => void;
  smsMarketingConsent: boolean;
  onConsentChange: (value: boolean) => void;
  disabled?: boolean;
  brandName?: string;
  supportEmail?: string | null;
  showPhoneField?: boolean;
}

export function MarketingSmsOptInFields({
  phone,
  onPhoneChange,
  smsMarketingConsent,
  onConsentChange,
  disabled = false,
  brandName = "MigraHosting",
  supportEmail = "admin@migrahosting.com",
  showPhoneField = true,
}: MarketingSmsOptInFieldsProps) {
  return (
    <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <p className="text-sm font-semibold text-[var(--ink)]">Optional SMS updates</p>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Use this only if you want marketing and announcement texts from {brandName}. This is optional and not required
        to use the website or request services.
      </p>

      {showPhoneField ? (
        <div className="mt-3">
          <label className="mb-1 block text-sm font-semibold text-[var(--ink)]">Mobile phone</label>
          <input
            type="tel"
            value={phone}
            onChange={(event) => onPhoneChange(event.target.value)}
            className="w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none ring-[var(--brand-500)] transition focus:ring-2"
            placeholder="(555) 555-5555"
            disabled={disabled}
          />
        </div>
      ) : null}

      <label className="mt-3 flex items-start gap-3 rounded-xl border border-[var(--line)] bg-white p-3 text-sm text-[var(--ink)]">
        <input
          type="checkbox"
          checked={smsMarketingConsent}
          onChange={(event) => onConsentChange(event.target.checked)}
          className="mt-1"
          disabled={disabled}
        />
        <span>
          <span className="font-semibold">
            I agree to receive SMS and MMS marketing messages, updates, and offers from {brandName}.
          </span>
          <span className="mt-1 block text-[var(--ink-muted)]">
            Consent is not a condition of purchase. Message frequency may vary. Message and data rates may apply. Reply
            STOP to opt out and HELP for help.{supportEmail ? ` Questions: ${supportEmail}.` : ""}
          </span>
        </span>
      </label>
    </div>
  );
}
