/**
 * Canonical status vocabulary for the Command Center.
 *
 * Used everywhere a status is read or written, so the rest of the app doesn't
 * have to remember which spelling the DB uses ('trialing' vs 'trial', 'paused'
 * vs 'suspended', etc).
 *
 * Imported as bare values where possible, e.g.:
 *   if (sub.status === SUBSCRIPTION_STATUS.active) ...
 */

export const TENANT_STATUS = {
  active: "active",
  suspended: "suspended",
  paused: "paused",         // legacy / synonym of suspended in some DBs
  churned: "churned",
  trial: "trial",
} as const;

export type TenantStatus = (typeof TENANT_STATUS)[keyof typeof TENANT_STATUS];

export const SUBSCRIPTION_STATUS = {
  active: "active",
  trialing: "trialing",
  paused: "paused",
  cancelled: "cancelled",
  pastDue: "past_due",
} as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUS)[keyof typeof SUBSCRIPTION_STATUS];

export const ORDER_STATUS = {
  pending: "pending",
  paid: "paid",
  refunded: "refunded",
  voided: "voided",
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

/** Tenant statuses that count as "in good standing". */
export const TENANT_ACTIVE_STATUSES: ReadonlyArray<string> = [
  TENANT_STATUS.active,
  TENANT_STATUS.trial,
];

/** Subscription statuses that should bill on the next cycle. */
export const SUBSCRIPTION_BILLABLE_STATUSES: ReadonlyArray<string> = [
  SUBSCRIPTION_STATUS.active,
  SUBSCRIPTION_STATUS.trialing,
];

/** Subscription statuses that can have addons attached. */
export const SUBSCRIPTION_MUTABLE_STATUSES: ReadonlyArray<string> = [
  SUBSCRIPTION_STATUS.active,
  SUBSCRIPTION_STATUS.trialing,
  SUBSCRIPTION_STATUS.paused,
];

export const isActiveTenant = (status: string | null | undefined) =>
  !!status && (TENANT_ACTIVE_STATUSES as string[]).includes(status);

export const isSuspendedTenant = (status: string | null | undefined) =>
  status === TENANT_STATUS.suspended || status === TENANT_STATUS.paused;

export const isChurnedTenant = (status: string | null | undefined) =>
  status === TENANT_STATUS.churned;
