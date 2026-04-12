function readStringEnv(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function parseAddressLines(value: string | undefined, fallback: string[]): string[] {
  if (!value) {
    return fallback;
  }

  const lines = value
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.length > 0 ? lines : fallback;
}

function resolveWebsiteHost(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).host;
  } catch {
    return websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export const migradrivePublicConfig = {
  brandName: readStringEnv(process.env.NEXT_PUBLIC_MIGRADRIVE_BRAND_NAME, "MigraDrive"),
  operatorName: readStringEnv(process.env.NEXT_PUBLIC_MIGRADRIVE_OPERATOR_NAME, "MigraTeck LLC"),
  websiteUrl: readStringEnv(process.env.NEXT_PUBLIC_MIGRADRIVE_WEBSITE_URL, "https://migradrive.com"),
  privacyEmail: readStringEnv(process.env.NEXT_PUBLIC_MIGRADRIVE_PRIVACY_EMAIL, "privacy@migradrive.com"),
  legalEmail: readStringEnv(process.env.NEXT_PUBLIC_MIGRADRIVE_LEGAL_EMAIL, "legal@migradrive.com"),
  supportEmail: readStringEnv(process.env.NEXT_PUBLIC_MIGRADRIVE_SUPPORT_EMAIL, "support@migradrive.com"),
  addressLines: parseAddressLines(process.env.NEXT_PUBLIC_MIGRADRIVE_ADDRESS_LINES, [
    "4957 Coconut Creek Pkwy",
    "Unit #3052",
    "Coconut Creek, FL 33063",
    "United States",
  ]),
  legalLastUpdated: readStringEnv(process.env.NEXT_PUBLIC_MIGRADRIVE_LEGAL_LAST_UPDATED, "April 11, 2026"),
  cookieConsentVersion: readStringEnv(process.env.NEXT_PUBLIC_COOKIE_CONSENT_VERSION, "2026-04-11"),
  cookieConsentStorageKey: readStringEnv(process.env.NEXT_PUBLIC_COOKIE_CONSENT_STORAGE_KEY, "migradrive_cookie_consent"),
  legacyCookieConsentStorageKeys: ["migrateck_cookie_consent"],
} as const;

export const migradriveWebsiteHost = resolveWebsiteHost(migradrivePublicConfig.websiteUrl);