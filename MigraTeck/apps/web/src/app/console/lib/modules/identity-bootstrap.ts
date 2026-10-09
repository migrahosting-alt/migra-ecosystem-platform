import { panelQuery, panelExec, isPanelDbConfigured } from "../db";
import { SUPPORT_OPERATOR_ROLES } from "./support-eligibility";

/**
 * CONSOLE ADMIN IDENTITY BOOTSTRAP
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The console admin authenticates from the environment (CONSOLE_ADMIN_EMAIL +
 * password hash), not from a database row. That was fine for logging in, and
 * quietly wrong for everything that has to say WHO did something: support
 * replies, internal notes and conversation assignments are stored against a
 * `users` row, and the environment admin had none.
 *
 * The old resolver papered over that by returning the nearest eligible admin
 * instead. This provisions the identity properly so it can resolve as ITSELF,
 * which is what lets loadSupportActor be exact and fail closed.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It never writes a password hash. `users` is the portal's authentication
 * table, and a row with no hash cannot authenticate — provisioning an identity
 * for attribution must not quietly mint a login. Console access still comes
 * from the environment credential and nowhere else.
 *
 * It fails closed on ambiguity. If the configured email already matches more
 * than one row (case variants, a soft-deleted duplicate), it provisions nothing
 * and reports the ambiguity: guessing which row is "the" admin would reintroduce
 * exactly the class of bug this replaces.
 *
 * It is idempotent. `users.email` is uniquely indexed, and the insert is guarded
 * by NOT EXISTS, so repeated startups converge instead of erroring or
 * duplicating.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type BootstrapResult =
  | { ok: true; state: "existing" | "provisioned" | "repaired"; id: string; email: string }
  | { ok: false; state: "not-configured" | "not-available" | "ambiguous" | "error"; reason: string };

const ELIGIBLE_ROLES: readonly string[] = SUPPORT_OPERATOR_ROLES;

export const bootstrapConsoleAdminIdentity = async (): Promise<BootstrapResult> => {
  const email = String(process.env.CONSOLE_ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email) {
    return { ok: false, state: "not-configured", reason: "CONSOLE_ADMIN_EMAIL is not set" };
  }
  if (!isPanelDbConfigured()) {
    // Not an error worth crashing startup over. Attribution simply stays
    // unresolved, and the resolver refuses rather than substituting anyone.
    return { ok: false, state: "not-available", reason: "panel database is not configured" };
  }

  try {
    const existing = await panelQuery<{ id: string; role: string | null; is_active: boolean | null }>(
      `SELECT id, role, is_active FROM users WHERE LOWER(email) = $1`,
      [email],
    );

    if (existing.length > 1) {
      return {
        ok: false,
        state: "ambiguous",
        reason: `${existing.length} users rows match ${email}; refusing to choose one`,
      };
    }

    if (existing.length === 1) {
      const row = existing[0]!;
      const eligible = ELIGIBLE_ROLES.includes(String(row.role || ""));
      const active = row.is_active !== false;
      if (eligible && active) return { ok: true, state: "existing", id: row.id, email };

      // The row exists but cannot be resolved as a support actor. Make it
      // eligible rather than leaving the console unable to attribute its own
      // administrator — but only along these two axes, and never its password.
      await panelExec(
        `UPDATE users
            SET role = CASE WHEN role IN (${SUPPORT_OPERATOR_ROLES.map((r) => `'${r}'`).join(",")}) THEN role ELSE 'admin' END,
                is_active = TRUE
          WHERE id = $1`,
        [row.id],
      );
      return { ok: true, state: "repaired", id: row.id, email };
    }

    const id = crypto.randomUUID();
    const displayName = "Console Administrator";
    await panelExec(
      `INSERT INTO users (id, email, role, is_active, display_name, email_verified)
       SELECT $1, $2, 'admin', TRUE, $3, TRUE
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE LOWER(email) = $4)`,
      [id, email, displayName, email],
    );

    // Re-read rather than trusting the insert: another instance starting at the
    // same moment may legitimately have won the race.
    const after = await panelQuery<{ id: string }>(
      `SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email],
    );
    const settled = after[0]?.id;
    if (!settled) {
      return { ok: false, state: "error", reason: "identity was not present after provisioning" };
    }
    return { ok: true, state: settled === id ? "provisioned" : "existing", id: settled, email };
  } catch (error) {
    return {
      ok: false,
      state: "error",
      reason: error instanceof Error ? error.message : "unknown error",
    };
  }
};
