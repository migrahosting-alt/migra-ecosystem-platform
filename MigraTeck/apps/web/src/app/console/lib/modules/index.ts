/**
 * Barrel re-export for the console's domain modules.
 *
 * Prefer importing from this index over the individual files — it keeps the
 * import surface consistent and makes future reshuffles painless:
 *
 *   import { logClientEvent, enqueueProvisioningTask, ... } from "@/console/lib/modules";
 *
 * Server actions are NOT re-exported here. Next.js requires server actions to
 * be imported directly from the file that contains the "use server" directive,
 * so always import those straight from "./client-actions".
 *
 * Types are re-exported with explicit `export type` so they don't pollute the
 * runtime namespace.
 */

// Reads + writes against tables this console owns
export {
  logClientEvent,
  loadClientTimeline,
  describeAction,
  loadAllRecentEvents,
  loadDistinctActions,
} from "./audit";
export type { ClientEvent, ClientEventInput, RecentEventsQuery } from "./audit";

export {
  loadClientNotes,
  createClientNote,
  deleteClientNote,
  togglePinNote,
} from "./notes";
export type { ClientNote } from "./notes";

export {
  loadClientContacts,
  createClientContact,
  updateClientContact,
  deleteClientContact,
  CONTACT_ROLES,
} from "./contacts";
export type { ClientContact, ContactRole } from "./contacts";

// Reads against the existing migrapanel tables
export {
  loadAllClients,
  loadClientDetail,
  loadDistinctClientStatuses,
} from "./clients";
export type {
  ClientListItem,
  ClientDetail,
  ClientsQuery,
} from "./clients";

export { loadTenantHeader, loadTenantName } from "./tenants";
export type { TenantHeader } from "./tenants";

export { loadFailedTasksForTenant } from "./failed-tasks";
export type { FailedTask } from "./failed-tasks";

// Status constants + predicates
export {
  TENANT_STATUS,
  SUBSCRIPTION_STATUS,
  ORDER_STATUS,
  TENANT_ACTIVE_STATUSES,
  SUBSCRIPTION_BILLABLE_STATUSES,
  SUBSCRIPTION_MUTABLE_STATUSES,
  isActiveTenant,
  isSuspendedTenant,
  isChurnedTenant,
} from "./status";
export type { TenantStatus, SubscriptionStatus, OrderStatus } from "./status";

// Cross-module helpers
export { enqueueProvisioningTask } from "./provisioning";
export type { EnqueueProvisioningTask } from "./provisioning";

export { withAuditedAction } from "./action-runner";
export type {
  AuditedActionInput,
  AuditedActionResult,
} from "./action-runner";

export { notifyLifecycle } from "./notifications";
export { createPaymentLink } from "./stripe-links";
export type { StripeLinkInput, StripeLinkResult } from "./stripe-links";
