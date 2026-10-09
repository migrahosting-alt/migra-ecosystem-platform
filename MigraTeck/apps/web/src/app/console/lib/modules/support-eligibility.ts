/**
 * WHO MAY ACT IN SUPPORT — one definition, consumed everywhere.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 *
 * The role list was written out by hand in six places across four files, and
 * they had already drifted: five required `is_active`, and the query behind the
 * "Support agents" panel did not. So an identity could be barred from acting
 * while still being listed and counted as an available agent — the UI offering
 * someone the write path would refuse.
 *
 * That is the same shape as the target-audit defect: two copies of one rule,
 * disagreeing. The fix is the same too — one definition, no second opinion.
 *
 * THE INVARIANT
 *
 *   the set of identities the UI presents as agents
 *     ==
 *   the set of identities the write path will accept
 *
 * A test asserts that equality directly rather than trusting the two call sites
 * to stay in step.
 *
 * DELIBERATELY NOT HISTORICAL
 *
 * This predicate answers "may this identity act RIGHT NOW", never "who wrote
 * this". Historical attribution is resolved by plain `LEFT JOIN users` on the
 * stored id with no eligibility filter, so a deactivated operator keeps their
 * name on the messages and assignments they made. Deactivating an identity must
 * not rewrite history — it must only stop it acting.
 *
 * A NOTE ON ROLE NAMES
 *
 * Eligibility is a hard-coded set of role names, which is why the `owner` role
 * resolves to nothing today. Widening it by role name is how authority creeps:
 * a role called `owner` sounds like it should qualify, and that reasoning would
 * grant support-write access to every future role whose name reads senior. The
 * long-term direction is an explicit capability, granted per identity. Until
 * that exists, adding a role here is a deliberate authorization decision, not a
 * convenience.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Roles permitted to act as a support operator. Adding one grants authority. */
export const SUPPORT_OPERATOR_ROLES = [
  "admin",
  "support",
  "agent",
  "super_admin",
  "ops",
] as const;

export type SupportOperatorRole = (typeof SUPPORT_OPERATOR_ROLES)[number];

const ROLE_LIST = SUPPORT_OPERATOR_ROLES.map((r) => `'${r}'`).join(",");

/**
 * SQL predicate for "may act in support right now".
 *
 * `alias` is the table alias in the caller's query ("u" for `FROM users u`, or
 * "" when the query selects from `users` unaliased). The role names are module
 * constants, never caller input, so the interpolation carries no parameter.
 */
export const supportOperatorSql = (alias = ""): string => {
  const col = (c: string) => (alias ? `${alias}.${c}` : c);
  return `${col("role")} IN (${ROLE_LIST}) AND COALESCE(${col("is_active")}, TRUE) = TRUE`;
};

/** The same rule in TypeScript, for rows already loaded. */
export const isSupportOperator = (row: {
  role?: string | null;
  is_active?: boolean | null;
}): boolean =>
  SUPPORT_OPERATOR_ROLES.includes(String(row?.role ?? "") as SupportOperatorRole) &&
  row?.is_active !== false;
