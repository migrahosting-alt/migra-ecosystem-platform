import type { AuthBrandTheme } from "@migrateck/auth-ui";

const defaultBullets = [
  "One identity across the MigraTeck ecosystem",
  "Centralized sessions, MFA, and audit-backed security",
  "Product-native branding with a shared authentication engine",
];

export const migraAuthBrand: AuthBrandTheme = {
  productKey: "migraauth",
  productName: "MigraAuth",
  securityLabel: "Identity & Security",
  monogram: "MA",
  eyebrow: "Security core",
  headline: "Secure access to your MigraTeck ecosystem",
  supportCopy: "Authentication stays centralized in MigraAuth while each product keeps its own branded entry experience.",
  trustBullets: defaultBullets,
  gradientStart: "#7c3aed",
  gradientEnd: "#ec4899",
  accent: "#a855f7",
  backgroundStyle: "soft-gradient",
};

const productBrands: Record<string, AuthBrandTheme> = {
  migrateck: {
    ...migraAuthBrand,
    productKey: "migrateck",
    productName: "MigraTeck",
    securityLabel: "Platform access",
    monogram: "MT",
    eyebrow: "Platform identity",
    headline: "Secure access to your MigraTeck workspace",
    supportCopy: "Sign in once to move between platform operations, product launches, and your organization workspace.",
    gradientStart: "#1e40af",
    gradientEnd: "#0ea5e9",
    accent: "#2563eb",
  },
  migrahosting: {
    ...migraAuthBrand,
    productKey: "migrahosting",
    productName: "MigraHosting",
    securityLabel: "Hosting access",
    monogram: "MH",
    eyebrow: "Hosting access",
    headline: "Sign in to MigraHosting",
    helperCopy: "Use your MigraTeck account to continue.",
    supportCopy: "Secure authentication powered by MigraTeck.",
    trustBullets: [],
  },
  migradrive: {
    ...migraAuthBrand,
    productKey: "migradrive",
    productName: "MigraDrive",
    securityLabel: "Storage access",
    monogram: "MD",
    eyebrow: "Storage identity",
    headline: "Secure access to your MigraDrive workspace",
    supportCopy: "Identity stays centralized while tenant access, file operations, and admin actions remain product-aware.",
  },
  migramail: {
    ...migraAuthBrand,
    productKey: "migramail",
    productName: "MigraMail",
    securityLabel: "Mail access",
    monogram: "MM",
    eyebrow: "Communications identity",
    headline: "Secure access to your MigraMail operations",
    supportCopy: "Centralized authentication for mail, admin, and user-facing sessions across your environment.",
  },
  migrapanel: {
    ...migraAuthBrand,
    productKey: "migrapanel",
    productName: "MigraPanel",
    securityLabel: "Panel access",
    monogram: "MP",
    eyebrow: "Control surface",
    headline: "Secure access to your MigraPanel environment",
    supportCopy: "MigraAuth keeps sessions, MFA, and audits unified while MigraPanel keeps its own operational UX.",
  },
  migravoice: {
    ...migraAuthBrand,
    productKey: "migravoice",
    productName: "MigraVoice",
    securityLabel: "Voice access",
    monogram: "MV",
    eyebrow: "Voice identity",
    headline: "Secure access to your MigraVoice workspace",
    supportCopy: "Use one central identity for voice operations, teams, and secure account recovery.",
  },
  migrainvoice: {
    ...migraAuthBrand,
    productKey: "migrainvoice",
    productName: "MigraInvoice",
    securityLabel: "Invoice access",
    monogram: "MI",
    eyebrow: "Billing identity",
    headline: "Secure access to your MigraInvoice workspace",
    supportCopy: "Shared authentication infrastructure with product-specific billing workflows, permissions, and audit visibility.",
  },
  migrabuilder: {
    ...migraAuthBrand,
    productKey: "migrabuilder",
    productName: "MigraBuilder",
    securityLabel: "Builder access",
    monogram: "MB",
    eyebrow: "Builder identity",
    headline: "Secure access to your MigraBuilder workspace",
    supportCopy: "Brand-matched sign-in for Builder while all identity, sessions, and MFA stay inside MigraAuth.",
  },
};

function normalizeClientId(clientId: string | null | undefined) {
  return (clientId ?? "").toLowerCase();
}

export function resolveAuthBrandTheme(clientId: string | null | undefined) {
  const normalized = normalizeClientId(clientId);

  if (!normalized) {
    return migraAuthBrand;
  }

  const match = Object.entries(productBrands).find(([key]) => normalized.includes(key));
  return match?.[1] ?? migraAuthBrand;
}

export function buildContinueLabel(clientId: string | null | undefined) {
  const theme = resolveAuthBrandTheme(clientId);
  return theme.productKey === "migraauth"
    ? "Continue into MigraAuth"
    : `Continue to ${theme.productName}`;
}
