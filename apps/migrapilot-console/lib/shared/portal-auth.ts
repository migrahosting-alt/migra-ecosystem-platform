export const PORTAL_SESSION_COOKIE = "mp_admin_session";

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export function portalAuthEnabled(): boolean {
  const raw = process.env.MIGRAPILOT_PORTAL_REQUIRE_AUTH;
  if (raw == null) return true;
  return isTruthy(raw);
}

export function portalAdminUsername(): string {
  const value = process.env.MIGRAPILOT_ADMIN_USERNAME;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MIGRAPILOT_ADMIN_USERNAME must be set in production");
    }
    return "admin";
  }
  return value;
}

export function portalAdminPassword(): string {
  const value = process.env.MIGRAPILOT_ADMIN_PASSWORD;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MIGRAPILOT_ADMIN_PASSWORD must be set in production");
    }
    return "change-me-now";
  }
  return value;
}

export function portalSessionToken(): string {
  const explicit = process.env.MIGRAPILOT_PORTAL_SESSION_TOKEN;
  if (explicit && explicit.trim()) return explicit.trim();
  return `${portalAdminUsername()}::${portalAdminPassword()}::session`;
}

export function portalSessionMaxAgeSeconds(): number {
  const raw = Number(process.env.MIGRAPILOT_PORTAL_SESSION_MAX_AGE_SECONDS ?? 60 * 60 * 12);
  if (!Number.isFinite(raw) || raw <= 0) return 60 * 60 * 12;
  return Math.floor(raw);
}

export function validatePortalCredentials(username: string, password: string): boolean {
  return username === portalAdminUsername() && password === portalAdminPassword();
}
