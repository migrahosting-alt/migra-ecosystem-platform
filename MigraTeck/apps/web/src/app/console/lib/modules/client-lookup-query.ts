/**
 * Deterministic client-by-email resolution.
 *
 * Pure query construction, no imports, so the precedence rule is unit-testable without a
 * database. `clients.ts` opens a pool at import time and cannot be loaded in a test.
 *
 * THE PROBLEM THIS FIXES
 * The original lookup was `SELECT ... UNION SELECT ... LIMIT 1` with no ORDER BY. An
 * address that is one tenant's billing_email and a different tenant's mailbox address
 * resolved to whichever row the planner happened to emit first — a different customer on
 * different days, from the same input. A bare outer ORDER BY would not have fixed it
 * either: with nothing to order BY, the tie is still arbitrary. Precedence has to be
 * materialized as data before it can be ordered on.
 */

/**
 * Source precedence. Lower wins.
 *
 * 1 BILLING_EMAIL — the address on the tenant's own account record. This IS the customer's
 *   identity, so a match here is the customer, not a reference to them.
 * 2 MAILBOX — an address hosted FOR a tenant. A secondary, derived identifier: a tenant can
 *   hold many, and a mailbox may outlive the relationship that created it.
 *
 * Anything added later (legacy or compatibility sources) takes a HIGHER number, so new
 * sources can never silently outrank the account record.
 */
export const CLIENT_EMAIL_SOURCE = {
  BILLING_EMAIL: 1,
  MAILBOX: 2,
} as const;

export type ClientEmailSource = (typeof CLIENT_EMAIL_SOURCE)[keyof typeof CLIENT_EMAIL_SOURCE];

/**
 * Build the resolution query, or null when the input cannot identify anyone.
 *
 * Ordering is three-part and total:
 *   1. source_rank — account record before hosted mailbox
 *   2. status_rank — active/current before inactive, within a source
 *   3. id          — a stable tiebreak so two equally-ranked rows still order the same way
 *                    on every execution, forever
 *
 * Without (3) the query would still be non-deterministic in the exact case that motivated
 * the fix, so it is not decoration.
 *
 * `UNION ALL` rather than `UNION`: the branches now carry different rank columns, so
 * deduplication would no longer collapse a tenant matching both branches — and it must not,
 * because the ORDER BY is what decides between them.
 *
 * Status semantics follow the canonical convention already used in clients.ts:
 * `COALESCE(status, 'active')` and `COALESCE(is_active, TRUE)`.
 */
export const buildClientByEmailQuery = (
  email: string,
): { sql: string; params: string[] } | null => {
  const e = (email ?? "").trim().toLowerCase();
  // An address with no local part or no domain cannot identify a customer. Rejecting here
  // keeps a malformed value from reaching the database at all.
  const at = e.indexOf("@");
  if (at <= 0 || at === e.length - 1) return null;

  const sql = `SELECT id
       FROM (
         SELECT t.id AS id,
                ${CLIENT_EMAIL_SOURCE.BILLING_EMAIL} AS source_rank,
                CASE WHEN COALESCE(t.is_active, TRUE)
                       AND COALESCE(t.status, 'active') = 'active'
                     THEN 0 ELSE 1 END AS status_rank
           FROM tenants t
          WHERE LOWER(COALESCE(t.billing_email, '')) = $1
         UNION ALL
         SELECT m.tenantid AS id,
                ${CLIENT_EMAIL_SOURCE.MAILBOX} AS source_rank,
                CASE WHEN COALESCE(m.status, 'active') = 'active'
                     THEN 0 ELSE 1 END AS status_rank
           FROM mailboxes m
          WHERE LOWER(m.address) = $1
            AND m.tenantid IS NOT NULL
       ) matches
      ORDER BY source_rank ASC, status_rank ASC, id ASC
      LIMIT 1`;

  return { sql, params: [e] };
};
