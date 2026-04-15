/**
 * Entitlement keys — all possible feature flags and limits across the ecosystem.
 * Apps check these, never raw Stripe subscription names.
 */
export type EntitlementKey =
  // Builder
  | "builder.sites.max"
  | "builder.custom_domains.enabled"
  | "builder.ai_generations.monthly"
  | "builder.storage_mb"
  | "builder.team_seats.max"
  | "builder.priority_support"
  // Hosting
  | "hosting.vps.max"
  | "hosting.bandwidth.monthly_gb"
  | "hosting.storage_gb"
  | "hosting.backups.enabled"
  | "hosting.custom_domains.max"
  | "hosting.ssl.auto"
  | "hosting.priority_support"
  // Intake
  | "intake.forms.max"
  | "intake.submissions.monthly"
  | "intake.automation.enabled"
  | "intake.storage_mb"
  | "intake.api_access"
  | "intake.priority_support"
  // Invoice
  | "invoice.clients.max"
  | "invoice.invoices.monthly"
  | "invoice.multi_currency"
  | "invoice.payment_processing"
  | "invoice.automation"
  | "invoice.recurring"
  | "invoice.reporting"
  | "invoice.team_seats.max"
  | "invoice.priority_support"
  // Voice
  | "voice.lines.max"
  | "voice.minutes.monthly"
  | "voice.ivr.enabled"
  | "voice.recording.enabled"
  | "voice.analytics.enabled"
  | "voice.sip_trunk"
  | "voice.priority_support"
  // Email
  | "email.mailboxes.max"
  | "email.storage_gb"
  | "email.custom_domains.max"
  | "email.sends.daily"
  | "email.routing.advanced"
  | "email.priority_support"
  // Marketing
  | "marketing.campaigns.max"
  | "marketing.contacts.max"
  | "marketing.social.enabled"
  | "marketing.automation.enabled"
  | "marketing.email.sends_monthly"
  | "marketing.priority_support"
  // Pilot
  | "pilot.runners.max"
  | "pilot.runs.monthly"
  | "pilot.automation.enabled"
  | "pilot.retention_days"
  | "pilot.parallel_runs"
  | "pilot.priority_support"
  // Drive
  | "drive.storage_gb"
  | "drive.transfer_gb.monthly"
  | "drive.versioning.enabled"
  | "drive.api_access"
  | "drive.team_sharing"
  | "drive.priority_support";

/**
 * Normalized org entitlements map.
 * Values: number (limit, -1 = unlimited), boolean (feature flag), string (tier name).
 */
export type OrgEntitlements = Partial<Record<EntitlementKey, string | number | boolean>>;
