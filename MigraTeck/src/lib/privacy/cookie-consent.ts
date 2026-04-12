import { migradrivePublicConfig } from "@/lib/migradrive-public-config";

export type CookieConsentState = "accepted" | "rejected";
export type CookieConsentSource = "accept_all" | "reject_optional" | "preferences_center" | "legacy_migration";
export type CookieConsentCategory = "analytics" | "preferences";

export interface CookieConsentPreferences {
  essential: true;
  analytics: boolean;
  preferences: boolean;
}

export interface CookieConsentRecord {
  state: CookieConsentState;
  preferences: CookieConsentPreferences;
  source: CookieConsentSource;
  version: string;
  updatedAt: string;
}

export const COOKIE_CONSENT_STORAGE_KEY = migradrivePublicConfig.cookieConsentStorageKey;
export const COOKIE_CONSENT_VERSION = migradrivePublicConfig.cookieConsentVersion;
export const COOKIE_CONSENT_UPDATED_EVENT = "migradrive-cookie-consent-updated";
export const COOKIE_CONSENT_OPEN_EVENT = "migradrive-cookie-consent-open";

const legacyCookieConsentStorageKeys = Array.from(
  new Set([COOKIE_CONSENT_STORAGE_KEY, ...migradrivePublicConfig.legacyCookieConsentStorageKeys]),
);

const defaultOptionalPreferences = {
  analytics: false,
  preferences: false,
} as const;

function isCookieConsentState(value: unknown): value is CookieConsentState {
  return value === "accepted" || value === "rejected";
}

function buildCookieConsentRecord(input: {
  analytics: boolean;
  preferences: boolean;
  source: CookieConsentSource;
  updatedAt?: string;
}): CookieConsentRecord {
  const preferences: CookieConsentPreferences = {
    essential: true,
    analytics: input.analytics,
    preferences: input.preferences,
  };

  const record: CookieConsentRecord = {
    state: input.analytics || input.preferences ? "accepted" : "rejected",
    preferences,
    source: input.source,
    version: COOKIE_CONSENT_VERSION,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  };

  return record;
}

function removeLegacyCookieConsentKeys(exceptKey: string) {
  if (typeof window === "undefined") {
    return;
  }

  for (const key of legacyCookieConsentStorageKeys) {
    if (key !== exceptKey) {
      window.localStorage.removeItem(key);
    }
  }
}

function persistCookieConsentRecord(record: CookieConsentRecord): CookieConsentRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(record));
  removeLegacyCookieConsentKeys(COOKIE_CONSENT_STORAGE_KEY);
  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_UPDATED_EVENT, { detail: record }));
  return record;
}

function parseCookieConsentRecord(rawValue: string): CookieConsentRecord | null {
  try {
    const parsed = JSON.parse(rawValue) as Partial<CookieConsentRecord>;
    if (!isCookieConsentState(parsed.state) || parsed.version !== COOKIE_CONSENT_VERSION) {
      return null;
    }

    const source = parsed.source === "accept_all" || parsed.source === "reject_optional" || parsed.source === "preferences_center" || parsed.source === "legacy_migration"
      ? parsed.source
      : parsed.state === "accepted"
        ? "accept_all"
        : "reject_optional";

    if (typeof parsed.updatedAt === "string") {
      return buildCookieConsentRecord({
        analytics: parsed.preferences?.analytics === true,
        preferences: parsed.preferences?.preferences === true,
        source,
        updatedAt: parsed.updatedAt,
      });
    }

    return buildCookieConsentRecord({
      analytics: parsed.preferences?.analytics === true,
      preferences: parsed.preferences?.preferences === true,
      source,
    });
  } catch {
    if (!isCookieConsentState(rawValue)) {
      return null;
    }

    return buildCookieConsentRecord({
      analytics: rawValue === "accepted",
      preferences: rawValue === "accepted",
      source: "legacy_migration",
    });
  }
}

export function getCookieConsent(): CookieConsentRecord | null {
  if (typeof window === "undefined") {
    return null;
  }

  for (const key of legacyCookieConsentStorageKeys) {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      continue;
    }

    const record = parseCookieConsentRecord(rawValue);
    if (!record) {
      window.localStorage.removeItem(key);
      continue;
    }

    if (key !== COOKIE_CONSENT_STORAGE_KEY) {
      persistCookieConsentRecord(record);
      window.localStorage.removeItem(key);
    }

    return record;
  }

  return null;
}

export function hasCookieConsent(): boolean {
  return Boolean(getCookieConsent());
}

export function getCookieConsentPreferences(record: CookieConsentRecord | null = getCookieConsent()): CookieConsentPreferences {
  return record?.preferences || { essential: true, ...defaultOptionalPreferences };
}

export function hasCookieConsentCategory(category: CookieConsentCategory): boolean {
  const preferences = getCookieConsentPreferences();
  return preferences[category];
}

export function canUseOptionalAnalytics(): boolean {
  return hasCookieConsentCategory("analytics");
}

export function canUsePreferenceStorage(): boolean {
  return hasCookieConsentCategory("preferences");
}

export function acceptAllCookieConsent(): CookieConsentRecord | null {
  return persistCookieConsentRecord(
    buildCookieConsentRecord({
      analytics: true,
      preferences: true,
      source: "accept_all",
    }),
  );
}

export function rejectOptionalCookieConsent(): CookieConsentRecord | null {
  return persistCookieConsentRecord(
    buildCookieConsentRecord({
      analytics: false,
      preferences: false,
      source: "reject_optional",
    }),
  );
}

export function setCookieConsent(input: {
  analytics: boolean;
  preferences: boolean;
  source?: CookieConsentSource;
}): CookieConsentRecord | null {
  return persistCookieConsentRecord(
    buildCookieConsentRecord({
      analytics: input.analytics,
      preferences: input.preferences,
      source: input.source || "preferences_center",
    }),
  );
}

export function requestOpenCookiePreferences() {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(COOKIE_CONSENT_OPEN_EVENT));
}
