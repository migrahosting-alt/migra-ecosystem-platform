/**
 * Pale Control Center RBAC.
 *
 * The MigraPanel console is single-admin + env-gated (see lib/auth.ts): a signed
 * session cookie carries an email. This layer maps that email to a Pale staff
 * role and gates the Pale module. It is structured for multi-staff from day one,
 * but works today with the single console admin (mapped to `owner`).
 *
 * Role source (env on app-core, optional):
 *   PALE_STAFF_ROLES="alice@x.com=trust_safety_manager;bob@x.com=auditor"
 * The primary CONSOLE_ADMIN_EMAIL always resolves to `owner` (full read).
 *
 * Phase 1 is READ-ONLY. No role grants mutation here — mutation wiring (Phase 2+)
 * will additionally require pale-api RBAC + confirmation + audit logging.
 */

export const PALE_ROLES = [
  "owner",
  "admin",
  "trust_safety_manager",
  "moderator",
  "support_agent",
  "auditor",
] as const;

export type PaleRole = (typeof PALE_ROLES)[number];

/** Roles allowed to view the read-only Phase-1 Control Center. */
export const PALE_READ_ROLES: ReadonlyArray<PaleRole> = [
  "owner",
  "admin",
  "trust_safety_manager",
  "auditor",
];

/** Roles allowed to see full (unmasked) phone numbers. None in Phase 1. */
export const PALE_UNMASK_ROLES: ReadonlyArray<PaleRole> = [];

const parseStaffRoles = (): Record<string, PaleRole> => {
  const raw = process.env.PALE_STAFF_ROLES ?? "";
  const map: Record<string, PaleRole> = {};
  for (const pair of raw.split(";")) {
    const [email, role] = pair.split("=").map((s) => s?.trim().toLowerCase());
    if (email && role && (PALE_ROLES as readonly string[]).includes(role)) {
      map[email] = role as PaleRole;
    }
  }
  return map;
};

/**
 * Resolve the Pale role for a console session email, or null if the account has
 * no Pale access. The primary CONSOLE_ADMIN_EMAIL is always `owner`.
 */
export const getPaleRole = (session: { email: string } | null): PaleRole | null => {
  if (!session?.email) return null;
  const email = session.email.trim().toLowerCase();
  const owner = (process.env.CONSOLE_ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (owner && email === owner) return "owner";
  return parseStaffRoles()[email] ?? null;
};

export const hasPaleReadAccess = (role: PaleRole | null): role is PaleRole =>
  role != null && PALE_READ_ROLES.includes(role);

export const canUnmaskPhone = (role: PaleRole | null): boolean =>
  role != null && PALE_UNMASK_ROLES.includes(role);

/** Mask a phone number to country prefix + last 2 digits. */
export const maskPhone = (phone: string | null | undefined): string => {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 5) return "•••";
  const head = digits.slice(0, Math.min(3, digits.length - 2));
  const last2 = digits.slice(-2);
  return `+${head} ••• ••${last2}`;
};

const PALE_ROLE_LABEL: Record<PaleRole, string> = {
  owner: "Owner",
  admin: "Admin",
  trust_safety_manager: "Trust & Safety Manager",
  moderator: "Moderator",
  support_agent: "Support Agent",
  auditor: "Read-only Auditor",
};

export const paleRoleLabel = (role: PaleRole): string => PALE_ROLE_LABEL[role];
