export const MIGRADRIVE_SITE_URL = "https://migradrive.com";

export type AuthPortalBranding = {
  host: string;
  productName: string;
  shortName: string;
  sectionLabel: string;
  headerLabel: string;
  siteUrl: string;
  appLandingPath: string;
  siteLabel: string;
  heading: string;
  description: string;
  featureBullets: string[];
  recoveryLabel: string;
  recoveryHeading: string;
  recoveryDescription: string;
  resetHeading: string;
  resetDescription: string;
  verifyLabel: string;
  verifyHeading: string;
  verifyDescription: string;
  signInLabel: string;
  invalidCredentialsMessage: string;
  verifyEmailMessage: string;
  magicLinkMessage: string;
  smsHeading: string;
  smsDescription: string;
  footerLabel: string;
  footerHeading: string;
  footerDescription: string;
  supportEmail: string;
  cookieDescription: string;
};

export const defaultAuthPortalBranding: AuthPortalBranding = {
  host: MIGRADRIVE_SITE_URL,
  productName: "MigraDrive",
  shortName: "MigraDrive",
  sectionLabel: "MigraDrive workspace access",
  headerLabel: "Secure workspace",
  siteUrl: MIGRADRIVE_SITE_URL,
  appLandingPath: "/app",
  siteLabel: "MigraDrive Home",
  heading: "Log in to MigraDrive",
  description:
    "Open your files, shared workspaces, and storage controls with your password, a magic link, or a text-message sign-in code.",
  featureBullets: [
    "Password login gives you direct access to the MigraDrive console and tenant controls.",
    "Magic links and SMS codes reduce friction for teams that need fast, secure sign-in from any device.",
  ],
  recoveryLabel: "MigraDrive account recovery",
  recoveryHeading: "Reset your MigraDrive password",
  recoveryDescription:
    "Send a recovery link to the email address tied to your MigraDrive workspace so you can regain access safely.",
  resetHeading: "Set a new MigraDrive password",
  resetDescription:
    "Choose a new password for your MigraDrive workspace to restore access to your files and team shares.",
  verifyLabel: "MigraDrive account setup",
  verifyHeading: "Verify your MigraDrive email",
  verifyDescription:
    "Confirm your email address to activate your MigraDrive workspace and continue into the drive console.",
  signInLabel: "Sign in to MigraDrive",
  invalidCredentialsMessage: "Invalid MigraDrive credentials.",
  verifyEmailMessage: "Verify your email before logging in to MigraDrive.",
  magicLinkMessage: "Magic link sent. Check your inbox for MigraDrive access.",
  smsHeading: "Or sign in with a text message",
  smsDescription:
    "Use the mobile number saved on your account to receive a six-digit MigraDrive sign-in code.",
  footerLabel: "MigraDrive workspace",
  footerHeading: "Secure file access and account recovery inside the same trusted surface.",
  footerDescription:
    "Use this portal to create accounts, verify access, recover credentials, and reach MigraDrive support.",
  supportEmail: "support@migradrive.com",
  cookieDescription:
    "MigraDrive uses essential storage for secure authentication, session continuity, and consent preferences. Optional analytics or preference storage should only run after consent.",
};

export const vpsAuthPortalBranding: AuthPortalBranding = {
  host: "https://vps.migrahosting.com",
  productName: "MigraHosting VPS",
  shortName: "MigraHosting VPS",
  sectionLabel: "MigraHosting VPS portal access",
  headerLabel: "VPS client portal",
  siteUrl: "https://vps.migrahosting.com/app/vps",
  appLandingPath: "/app/vps",
  siteLabel: "VPS Portal Home",
  heading: "Log in to your VPS portal",
  description:
    "Access your VPS dashboard, console sessions, networking controls, firewall tools, backups, and billing from one secure portal.",
  featureBullets: [
    "Password login takes you straight into your VPS fleet, console access, and infrastructure controls.",
    "Text-message sign-in helps operators and clients get back into the VPS portal quickly from any device.",
  ],
  recoveryLabel: "MigraHosting VPS account recovery",
  recoveryHeading: "Reset your VPS portal password",
  recoveryDescription:
    "Send a recovery link to the email address tied to your VPS portal account so you can restore access safely.",
  resetHeading: "Set a new VPS portal password",
  resetDescription:
    "Choose a new password for your VPS portal account to regain access to your servers, console sessions, and billing controls.",
  verifyLabel: "MigraHosting VPS account setup",
  verifyHeading: "Verify your VPS portal email",
  verifyDescription:
    "Confirm your email address to activate your VPS portal account and continue into the server workspace.",
  signInLabel: "Sign in to VPS Portal",
  invalidCredentialsMessage: "Invalid VPS portal credentials.",
  verifyEmailMessage: "Verify your email before logging in to the VPS portal.",
  magicLinkMessage: "Magic link sent. Check your inbox for VPS portal access.",
  smsHeading: "Or sign in with a text message",
  smsDescription:
    "Use the mobile number saved on your account to receive a six-digit VPS portal sign-in code.",
  footerLabel: "MigraHosting VPS portal",
  footerHeading: "Secure VPS access and account recovery inside one managed portal.",
  footerDescription:
    "Use this portal to verify access, recover credentials, and manage VPS services with MigraHosting support.",
  supportEmail: "support@migrahosting.com",
  cookieDescription:
    "The VPS portal uses essential storage for secure authentication, session continuity, and consent preferences. Optional analytics or preference storage should only run after consent.",
};

const MIGRADRIVE_AUTH_PATHS = new Set([
  "/signup",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
]);

export const VPS_PORTAL_HOST = "vps.migrahosting.com";

function normalizePortalHostname(hostname: string | null | undefined): string {
  return (hostname || "")
    .split(",")[0]
    ?.trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function isMigraDriveAuthPath(pathname: string | null | undefined): boolean {
  if (!pathname) {
    return false;
  }

  return MIGRADRIVE_AUTH_PATHS.has(pathname);
}

export function isVpsPortalHost(hostname: string | null | undefined): boolean {
  return normalizePortalHostname(hostname) === VPS_PORTAL_HOST;
}

export function resolveAuthPortalBranding(hostname: string | null | undefined): AuthPortalBranding {
  const normalizedHost = normalizePortalHostname(hostname);

  if (normalizedHost === VPS_PORTAL_HOST) {
    return vpsAuthPortalBranding;
  }

  return defaultAuthPortalBranding;
}
