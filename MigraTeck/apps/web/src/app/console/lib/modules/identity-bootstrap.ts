import { randomUUID } from "node:crypto";

import { panelExec, panelQuery, isPanelDbConfigured } from "../db";

/**
 * Environment-administrator identity bootstrap.
 *
 * WHY THIS IS NOT DONE AT REQUEST TIME
 * ------------------------------------
 * The console administrator authenticates from CONSOLE_ADMIN_EMAIL, but that
 * address has no row in `users`. Support writes reference `users.id`, so without
 * an identity the administrator cannot act at all — and the previous code "solved"
 * that by silently falling through to a different employee's account, which is the
 * audit-integrity defect this whole effort exists to close.
 *
 * An earlier iteration provisioned the identity lazily, on the administrator's
 * first support mutation. That worked, but it meant claiming or replying to a
 * conversation could create a user row as a side effect — surprising, and the
 * wrong place for an identity decision.
 *
 * So identity creation happens HERE: once, at server startup, before any support
 * action can run. The runtime resolver only ever *resolves*; it never creates.
 *
 * Guarantees:
 *   - idempotent (safe to run on every boot)
 *   - keyed on the exact configured CONSOLE_ADMIN_EMAIL
 *   - CANNOT create an identity from request input — it takes no arguments and
 *     reads only the environment
 *   - audited
 */

export type BootstrapResult =
  | { status: "created"; email: string; id: string }
  | { status: "exists"; email: string; id: string }
  | { status: "skipped"; reason: "not_configured" | "db_unavailable" };

export const bootstrapEnvironmentAdminIdentity = async (): Promise<BootstrapResult> => {
  const email = (process.env.CONSOLE_ADMIN_EMAIL ?? "").trim();
  if (!email) return { status: "skipped", reason: "not_configured" };
  if (!isPanelDbConfigured()) return { status: "skipped", reason: "db_unavailable" };

  const existing = await panelQuery<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email],
  );
  if (existing[0]) {
    return { status: "exists", email, id: existing[0].id };
  }

  const id = randomUUID();
  const displayName = (process.env.CONSOLE_ADMIN_NAME ?? "").trim() || email;

  // Guarded insert: a concurrent boot cannot create a duplicate.
  await panelExec(
    `INSERT INTO users (id, email, role, display_name, is_active)
     SELECT $1, $2, 'admin', $3, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = LOWER($2))`,
    [id, email, displayName],
  );

  const created = await panelQuery<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email],
  );
  const resolvedId = created[0]?.id ?? id;

  // System-level event: there is no tenant. auditLog() requires one, so write the
  // audit row directly with a NULL tenant rather than inventing a tenant id.
  await panelExec(
    `INSERT INTO audit_logs (id, tenantid, actoruserid, action, targettype, targetid, metajson, createdat)
     VALUES ($1, NULL, $2, 'identity.environment_admin.provisioned', 'user', $2, $3::jsonb, NOW())`,
    [randomUUID(), resolvedId, JSON.stringify({ email, role: "admin", source: "CONSOLE_ADMIN_EMAIL" })],
  );

  return { status: "created", email, id: resolvedId };
};
