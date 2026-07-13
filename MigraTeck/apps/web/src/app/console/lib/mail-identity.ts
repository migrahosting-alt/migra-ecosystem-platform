import crypto from "node:crypto";
import { panelQuery } from "./db";

/**
 * Staff identity + signed-token minting for the Mail module.
 *
 * The console owns staff identity (mail_staff_user in the migrapanel DB, plus
 * the env bootstrap admin). For every request to the MigraMail backend it mints
 * a short-lived HMAC token carrying {email, role, department} — MigraMail
 * verifies the signature and enforces mailbox permissions on top of it. The
 * token never carries a mailbox credential.
 */

export type StaffRole =
  | "super_admin"
  | "admin"
  | "support"
  | "billing"
  | "sales"
  | "readonly";

export const STAFF_ROLES: StaffRole[] = [
  "super_admin",
  "admin",
  "support",
  "billing",
  "sales",
  "readonly",
];

export interface StaffIdentity {
  email: string;
  role: StaffRole;
  department: string | null;
  name: string | null;
}

const isEnvAdmin = (email: string): boolean => {
  const allowed = (process.env.CONSOLE_ADMIN_EMAIL || "").trim().toLowerCase();
  return Boolean(allowed) && email.trim().toLowerCase() === allowed;
};

const coerceRole = (role: string): StaffRole =>
  (STAFF_ROLES as string[]).includes(role) ? (role as StaffRole) : "readonly";

/**
 * Resolves the acting staff identity for a logged-in email. Returns null when
 * the email is neither the env admin nor an active staff user — so removed or
 * suspended access takes effect on the very next request.
 */
export async function resolveStaffIdentity(email: string): Promise<StaffIdentity | null> {
  const lower = email.trim().toLowerCase();
  if (isEnvAdmin(lower)) {
    return { email: lower, role: "super_admin", department: null, name: "Super Admin" };
  }
  const rows = await panelQuery<{
    email: string;
    role: string;
    department: string | null;
    name: string | null;
    status: string;
  }>(
    "SELECT email, role, department, name, status FROM mail_staff_user WHERE lower(email) = lower($1) LIMIT 1",
    [lower],
  );
  const r = rows[0];
  if (!r || r.status !== "active") return null;
  return {
    email: r.email.toLowerCase(),
    role: coerceRole(r.role),
    department: r.department,
    name: r.name,
  };
}

/** Verifies a staff member's password (scrypt:<saltHex>:<hashHex>). */
export async function verifyStaffPassword(email: string, password: string): Promise<boolean> {
  const lower = email.trim().toLowerCase();
  if (isEnvAdmin(lower)) return false; // env admin uses the env hash, handled elsewhere
  const rows = await panelQuery<{ password_hash: string | null; status: string }>(
    "SELECT password_hash, status FROM mail_staff_user WHERE lower(email) = lower($1) LIMIT 1",
    [lower],
  );
  const r = rows[0];
  if (!r || r.status !== "active" || !r.password_hash) return false;
  const parts = r.password_hash.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  try {
    const salt = Buffer.from(parts[1]!, "hex");
    const expected = Buffer.from(parts[2]!, "hex");
    const derived = crypto.scryptSync(password, salt, 64);
    return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export const migramailBase = (): string =>
  (process.env.MIGRAMAIL_PANEL_API_BASE || "").replace(/\/$/, "");

/** Mints a short-lived HMAC panel-identity token for the MigraMail backend. */
export function mintPanelToken(identity: StaffIdentity): string {
  const secret = process.env.MIGRAMAIL_PANEL_SECRET;
  if (!secret) throw new Error("MIGRAMAIL_PANEL_SECRET not configured");
  const now = Date.now();
  const payload = {
    email: identity.email,
    role: identity.role,
    department: identity.department,
    name: identity.name,
    iat: now,
    exp: now + 90_000, // 90s — minted per request
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export const isMailModuleConfigured = (): boolean =>
  Boolean(process.env.MIGRAMAIL_PANEL_API_BASE && process.env.MIGRAMAIL_PANEL_SECRET);
