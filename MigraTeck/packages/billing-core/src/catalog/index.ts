import type { ProductFamily, PlanCode, BillingComponentType, BillingInterval } from "../types";

export interface CatalogEntitlements {
  [key: string]: string | number | boolean;
}

export interface CatalogPrice {
  /** Stripe metadata lookup key: e.g. "builder_pro_base_month" */
  lookupKey: string;
  componentType: BillingComponentType;
  billingInterval: BillingInterval;
  /** Amount in cents (flat/seat) or null for metered */
  unitAmount: number | null;
  /** For metered usage prices */
  meterName?: string;
  /** For seat prices */
  usageDimension?: string;
  /** Stripe metadata attached to the Price object */
  metadata: Record<string, string>;
}

export interface CatalogPlan {
  planCode: PlanCode;
  name: string;
  description: string;
  prices: CatalogPrice[];
  entitlements: CatalogEntitlements;
  trialDays?: number;
}

export interface CatalogProduct {
  productFamily: ProductFamily;
  name: string;
  description: string;
  plans: CatalogPlan[];
}

/**
 * Canonical product catalog for the MigraTeck ecosystem.
 * Stripe Products/Prices are created from this catalog with consistent metadata.
 * Apps never hardcode Stripe price IDs — they reference lookup keys from here.
 */
export const PRODUCT_CATALOG: CatalogProduct[] = [
  // ── MigraBuilder ────────────────────────────────────────────────
  {
    productFamily: "builder",
    name: "MigraBuilder",
    description: "Website builder with AI, custom domains, and team collaboration.",
    plans: [
      {
        planCode: "free",
        name: "Free",
        description: "Single site, basic builder features.",
        prices: [],
        entitlements: {
          "builder.sites.max": 1,
          "builder.custom_domains.enabled": false,
          "builder.ai_generations.monthly": 50,
          "builder.storage_mb": 500,
          "builder.team_seats.max": 1,
        },
      },
      {
        planCode: "starter",
        name: "Starter",
        description: "Up to 3 sites with custom domains.",
        prices: [
          {
            lookupKey: "builder_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 1499,
            metadata: { product_family: "builder", plan_code: "starter", billing_component: "base", entitlement_profile: "builder_starter" },
          },
          {
            lookupKey: "builder_starter_base_year",
            componentType: "base",
            billingInterval: "year",
            unitAmount: 14388,
            metadata: { product_family: "builder", plan_code: "starter", billing_component: "base", entitlement_profile: "builder_starter" },
          },
        ],
        entitlements: {
          "builder.sites.max": 3,
          "builder.custom_domains.enabled": true,
          "builder.ai_generations.monthly": 500,
          "builder.storage_mb": 5000,
          "builder.team_seats.max": 2,
        },
        trialDays: 14,
      },
      {
        planCode: "pro",
        name: "Pro",
        description: "10 sites, full AI, team collaboration.",
        prices: [
          {
            lookupKey: "builder_pro_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 2999,
            metadata: { product_family: "builder", plan_code: "pro", billing_component: "base", entitlement_profile: "builder_pro" },
          },
          {
            lookupKey: "builder_pro_base_year",
            componentType: "base",
            billingInterval: "year",
            unitAmount: 28788,
            metadata: { product_family: "builder", plan_code: "pro", billing_component: "base", entitlement_profile: "builder_pro" },
          },
          {
            lookupKey: "builder_pro_seat_month",
            componentType: "seat",
            billingInterval: "month",
            unitAmount: 1500,
            usageDimension: "users",
            metadata: { product_family: "builder", plan_code: "pro", billing_component: "seat", usage_dimension: "users" },
          },
        ],
        entitlements: {
          "builder.sites.max": 10,
          "builder.custom_domains.enabled": true,
          "builder.ai_generations.monthly": 5000,
          "builder.storage_mb": 25000,
          "builder.team_seats.max": 10,
        },
        trialDays: 14,
      },
      {
        planCode: "business",
        name: "Business",
        description: "Unlimited sites, priority support, advanced analytics.",
        prices: [
          {
            lookupKey: "builder_business_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 7999,
            metadata: { product_family: "builder", plan_code: "business", billing_component: "base", entitlement_profile: "builder_business" },
          },
          {
            lookupKey: "builder_business_base_year",
            componentType: "base",
            billingInterval: "year",
            unitAmount: 76788,
            metadata: { product_family: "builder", plan_code: "business", billing_component: "base", entitlement_profile: "builder_business" },
          },
          {
            lookupKey: "builder_business_seat_month",
            componentType: "seat",
            billingInterval: "month",
            unitAmount: 1500,
            usageDimension: "users",
            metadata: { product_family: "builder", plan_code: "business", billing_component: "seat", usage_dimension: "users" },
          },
          {
            lookupKey: "builder_business_ai_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "ai_generations",
            metadata: { product_family: "builder", plan_code: "business", billing_component: "usage", usage_dimension: "ai_generations" },
          },
        ],
        entitlements: {
          "builder.sites.max": -1,
          "builder.custom_domains.enabled": true,
          "builder.ai_generations.monthly": 25000,
          "builder.storage_mb": 100000,
          "builder.team_seats.max": 50,
          "builder.priority_support": true,
        },
      },
    ],
  },

  // ── MigraHosting ────────────────────────────────────────────────
  {
    productFamily: "hosting",
    name: "MigraHosting",
    description: "Managed hosting environments, pod-backed service delivery, domain provisioning.",
    plans: [
      {
        planCode: "starter",
        name: "Starter",
        description: "Entry-level managed hosting.",
        prices: [
          {
            lookupKey: "hosting_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 499,
            metadata: { product_family: "hosting", plan_code: "starter", billing_component: "base", entitlement_profile: "hosting_starter" },
          },
        ],
        entitlements: {
          "hosting.vps.max": 1,
          "hosting.bandwidth.monthly_gb": 500,
          "hosting.storage_gb": 20,
          "hosting.backups.enabled": true,
          "hosting.custom_domains.max": 2,
        },
      },
      {
        planCode: "pro",
        name: "Premium",
        description: "Mid-tier managed hosting with more resources.",
        prices: [
          {
            lookupKey: "hosting_premium_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 599,
            metadata: { product_family: "hosting", plan_code: "pro", billing_component: "base", entitlement_profile: "hosting_premium" },
          },
        ],
        entitlements: {
          "hosting.vps.max": 2,
          "hosting.bandwidth.monthly_gb": 1000,
          "hosting.storage_gb": 50,
          "hosting.backups.enabled": true,
          "hosting.custom_domains.max": 5,
          "hosting.ssl.auto": true,
        },
      },
      {
        planCode: "business",
        name: "Business",
        description: "Business hosting with high resources and priority support.",
        prices: [
          {
            lookupKey: "hosting_business_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 799,
            metadata: { product_family: "hosting", plan_code: "business", billing_component: "base", entitlement_profile: "hosting_business" },
          },
          {
            lookupKey: "hosting_business_bandwidth_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "bandwidth_gb",
            metadata: { product_family: "hosting", plan_code: "business", billing_component: "usage", usage_dimension: "bandwidth_gb" },
          },
        ],
        entitlements: {
          "hosting.vps.max": 3,
          "hosting.bandwidth.monthly_gb": 2000,
          "hosting.storage_gb": 100,
          "hosting.backups.enabled": true,
          "hosting.custom_domains.max": -1,
          "hosting.ssl.auto": true,
          "hosting.priority_support": true,
        },
      },
    ],
  },

  // ── MigraIntake ─────────────────────────────────────────────────
  {
    productFamily: "intake",
    name: "MigraIntake",
    description: "Forms, intake management, and submission automation.",
    plans: [
      {
        planCode: "starter",
        name: "Starter",
        description: "Basic intake forms.",
        prices: [
          {
            lookupKey: "intake_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 999,
            metadata: { product_family: "intake", plan_code: "starter", billing_component: "base", entitlement_profile: "intake_starter" },
          },
        ],
        entitlements: {
          "intake.forms.max": 5,
          "intake.submissions.monthly": 500,
          "intake.automation.enabled": false,
          "intake.storage_mb": 1000,
        },
      },
      {
        planCode: "pro",
        name: "Growth",
        description: "Advanced intake with automation.",
        prices: [
          {
            lookupKey: "intake_growth_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 2499,
            metadata: { product_family: "intake", plan_code: "pro", billing_component: "base", entitlement_profile: "intake_growth" },
          },
        ],
        entitlements: {
          "intake.forms.max": 100,
          "intake.submissions.monthly": 50000,
          "intake.automation.enabled": true,
          "intake.storage_mb": 10000,
          "intake.api_access": true,
        },
      },
      {
        planCode: "business",
        name: "Business",
        description: "Enterprise intake with unlimited forms.",
        prices: [
          {
            lookupKey: "intake_business_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 4999,
            metadata: { product_family: "intake", plan_code: "business", billing_component: "base", entitlement_profile: "intake_business" },
          },
          {
            lookupKey: "intake_business_seat_month",
            componentType: "seat",
            billingInterval: "month",
            unitAmount: 1000,
            usageDimension: "users",
            metadata: { product_family: "intake", plan_code: "business", billing_component: "seat", usage_dimension: "users" },
          },
        ],
        entitlements: {
          "intake.forms.max": -1,
          "intake.submissions.monthly": -1,
          "intake.automation.enabled": true,
          "intake.storage_mb": 50000,
          "intake.api_access": true,
          "intake.priority_support": true,
        },
      },
    ],
  },

  // ── MigraInvoice ────────────────────────────────────────────────
  {
    productFamily: "invoice",
    name: "MigraInvoice",
    description: "Professional invoicing, quoting, and payment processing.",
    plans: [
      {
        planCode: "starter",
        name: "Starter",
        description: "Basic invoicing for small businesses.",
        prices: [
          {
            lookupKey: "invoice_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 1500,
            metadata: { product_family: "invoice", plan_code: "starter", billing_component: "base", entitlement_profile: "invoice_starter" },
          },
        ],
        entitlements: {
          "invoice.clients.max": 25,
          "invoice.invoices.monthly": 50,
          "invoice.multi_currency": false,
          "invoice.payment_processing": true,
        },
      },
      {
        planCode: "pro",
        name: "Professional",
        description: "Full invoicing suite with multi-currency and automation.",
        prices: [
          {
            lookupKey: "invoice_professional_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 3900,
            metadata: { product_family: "invoice", plan_code: "pro", billing_component: "base", entitlement_profile: "invoice_professional" },
          },
        ],
        entitlements: {
          "invoice.clients.max": -1,
          "invoice.invoices.monthly": -1,
          "invoice.multi_currency": true,
          "invoice.payment_processing": true,
          "invoice.automation": true,
          "invoice.recurring": true,
        },
      },
      {
        planCode: "business",
        name: "Advanced",
        description: "Advanced invoicing with team and reporting features.",
        prices: [
          {
            lookupKey: "invoice_advanced_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 7900,
            metadata: { product_family: "invoice", plan_code: "business", billing_component: "base", entitlement_profile: "invoice_advanced" },
          },
          {
            lookupKey: "invoice_advanced_seat_month",
            componentType: "seat",
            billingInterval: "month",
            unitAmount: 1200,
            usageDimension: "users",
            metadata: { product_family: "invoice", plan_code: "business", billing_component: "seat", usage_dimension: "users" },
          },
        ],
        entitlements: {
          "invoice.clients.max": -1,
          "invoice.invoices.monthly": -1,
          "invoice.multi_currency": true,
          "invoice.payment_processing": true,
          "invoice.automation": true,
          "invoice.recurring": true,
          "invoice.reporting": true,
          "invoice.team_seats.max": 25,
          "invoice.priority_support": true,
        },
      },
    ],
  },

  // ── MigraVoice ──────────────────────────────────────────────────
  {
    productFamily: "voice",
    name: "MigraVoice",
    description: "Carrier-ready communications stack with voice, IVR, and analytics.",
    plans: [
      {
        planCode: "starter",
        name: "Starter",
        description: "Basic VoIP with a single line.",
        prices: [
          {
            lookupKey: "voice_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 1500,
            metadata: { product_family: "voice", plan_code: "starter", billing_component: "base", entitlement_profile: "voice_starter" },
          },
        ],
        entitlements: {
          "voice.lines.max": 1,
          "voice.minutes.monthly": 500,
          "voice.ivr.enabled": false,
          "voice.recording.enabled": false,
        },
      },
      {
        planCode: "business",
        name: "Business",
        description: "Business VoIP with IVR and call recording.",
        prices: [
          {
            lookupKey: "voice_business_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 3900,
            metadata: { product_family: "voice", plan_code: "business", billing_component: "base", entitlement_profile: "voice_business" },
          },
          {
            lookupKey: "voice_business_seat_month",
            componentType: "seat",
            billingInterval: "month",
            unitAmount: 1500,
            usageDimension: "users",
            metadata: { product_family: "voice", plan_code: "business", billing_component: "seat", usage_dimension: "users" },
          },
        ],
        entitlements: {
          "voice.lines.max": 5,
          "voice.minutes.monthly": 5000,
          "voice.ivr.enabled": true,
          "voice.recording.enabled": true,
          "voice.analytics.enabled": true,
        },
      },
      {
        planCode: "enterprise",
        name: "Enterprise",
        description: "Enterprise voice with unlimited lines and SIP trunk.",
        prices: [
          {
            lookupKey: "voice_enterprise_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 9900,
            metadata: { product_family: "voice", plan_code: "enterprise", billing_component: "base", entitlement_profile: "voice_enterprise" },
          },
          {
            lookupKey: "voice_enterprise_minute_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "voice_minutes",
            metadata: { product_family: "voice", plan_code: "enterprise", billing_component: "usage", usage_dimension: "voice_minutes" },
          },
        ],
        entitlements: {
          "voice.lines.max": -1,
          "voice.minutes.monthly": -1,
          "voice.ivr.enabled": true,
          "voice.recording.enabled": true,
          "voice.analytics.enabled": true,
          "voice.sip_trunk": true,
          "voice.priority_support": true,
        },
      },
    ],
  },

  // ── MigraMail ───────────────────────────────────────────────────
  {
    productFamily: "email",
    name: "MigraMail",
    description: "Mailbox, routing, and deliverability operations.",
    plans: [
      {
        planCode: "starter",
        name: "Starter",
        description: "Basic email hosting.",
        prices: [
          {
            lookupKey: "email_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 700,
            metadata: { product_family: "email", plan_code: "starter", billing_component: "base", entitlement_profile: "email_starter" },
          },
        ],
        entitlements: {
          "email.mailboxes.max": 5,
          "email.storage_gb": 10,
          "email.custom_domains.max": 1,
          "email.sends.daily": 500,
        },
      },
      {
        planCode: "business",
        name: "Business",
        description: "Business email with advanced routing.",
        prices: [
          {
            lookupKey: "email_business_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 1500,
            metadata: { product_family: "email", plan_code: "business", billing_component: "base", entitlement_profile: "email_business" },
          },
        ],
        entitlements: {
          "email.mailboxes.max": 25,
          "email.storage_gb": 50,
          "email.custom_domains.max": 5,
          "email.sends.daily": 5000,
          "email.routing.advanced": true,
        },
      },
      {
        planCode: "enterprise",
        name: "Enterprise",
        description: "Enterprise email with unlimited mailboxes.",
        prices: [
          {
            lookupKey: "email_enterprise_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 2900,
            metadata: { product_family: "email", plan_code: "enterprise", billing_component: "base", entitlement_profile: "email_enterprise" },
          },
          {
            lookupKey: "email_enterprise_send_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "email_sends",
            metadata: { product_family: "email", plan_code: "enterprise", billing_component: "usage", usage_dimension: "email_sends" },
          },
        ],
        entitlements: {
          "email.mailboxes.max": -1,
          "email.storage_gb": 200,
          "email.custom_domains.max": -1,
          "email.sends.daily": -1,
          "email.routing.advanced": true,
          "email.priority_support": true,
        },
      },
    ],
  },

  // ── MigraMarket ─────────────────────────────────────────────────
  {
    productFamily: "marketing",
    name: "MigraMarket",
    description: "Marketing campaigns, automation, social publishing, and growth operations.",
    plans: [
      {
        planCode: "starter",
        name: "Local Visibility",
        description: "Local marketing essentials.",
        prices: [
          {
            lookupKey: "marketing_local_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 650,
            metadata: { product_family: "marketing", plan_code: "starter", billing_component: "base", entitlement_profile: "marketing_local" },
          },
        ],
        entitlements: {
          "marketing.campaigns.max": 5,
          "marketing.contacts.max": 500,
          "marketing.social.enabled": false,
          "marketing.automation.enabled": false,
        },
      },
      {
        planCode: "pro",
        name: "Social + Email",
        description: "Social publishing and email campaigns.",
        prices: [
          {
            lookupKey: "marketing_social_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 900,
            metadata: { product_family: "marketing", plan_code: "pro", billing_component: "base", entitlement_profile: "marketing_social" },
          },
        ],
        entitlements: {
          "marketing.campaigns.max": 25,
          "marketing.contacts.max": 5000,
          "marketing.social.enabled": true,
          "marketing.automation.enabled": false,
          "marketing.email.sends_monthly": 10000,
        },
      },
      {
        planCode: "business",
        name: "Full Growth Engine",
        description: "Full marketing automation and growth stack.",
        prices: [
          {
            lookupKey: "marketing_growth_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 2200,
            metadata: { product_family: "marketing", plan_code: "business", billing_component: "base", entitlement_profile: "marketing_growth" },
          },
          {
            lookupKey: "marketing_growth_contact_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "marketing_contacts",
            metadata: { product_family: "marketing", plan_code: "business", billing_component: "usage", usage_dimension: "marketing_contacts" },
          },
        ],
        entitlements: {
          "marketing.campaigns.max": -1,
          "marketing.contacts.max": -1,
          "marketing.social.enabled": true,
          "marketing.automation.enabled": true,
          "marketing.email.sends_monthly": -1,
          "marketing.priority_support": true,
        },
      },
    ],
  },

  // ── MigraPilot ──────────────────────────────────────────────────
  {
    productFamily: "pilot",
    name: "MigraPilot",
    description: "Command and automation platform for agents, runners, and workflow execution.",
    plans: [
      {
        planCode: "starter",
        name: "Starter",
        description: "Basic automation and runner support.",
        prices: [
          {
            lookupKey: "pilot_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 1500,
            metadata: { product_family: "pilot", plan_code: "starter", billing_component: "base", entitlement_profile: "pilot_starter" },
          },
        ],
        entitlements: {
          "pilot.runners.max": 2,
          "pilot.runs.monthly": 500,
          "pilot.automation.enabled": true,
          "pilot.retention_days": 7,
        },
      },
      {
        planCode: "business",
        name: "Business",
        description: "Business automation with advanced workflows.",
        prices: [
          {
            lookupKey: "pilot_business_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 4900,
            metadata: { product_family: "pilot", plan_code: "business", billing_component: "base", entitlement_profile: "pilot_business" },
          },
          {
            lookupKey: "pilot_business_seat_month",
            componentType: "seat",
            billingInterval: "month",
            unitAmount: 1500,
            usageDimension: "users",
            metadata: { product_family: "pilot", plan_code: "business", billing_component: "seat", usage_dimension: "users" },
          },
        ],
        entitlements: {
          "pilot.runners.max": 10,
          "pilot.runs.monthly": 5000,
          "pilot.automation.enabled": true,
          "pilot.retention_days": 30,
          "pilot.parallel_runs": 5,
        },
      },
      {
        planCode: "enterprise",
        name: "Enterprise",
        description: "Enterprise automation with unlimited runners.",
        prices: [
          {
            lookupKey: "pilot_enterprise_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 14900,
            metadata: { product_family: "pilot", plan_code: "enterprise", billing_component: "base", entitlement_profile: "pilot_enterprise" },
          },
          {
            lookupKey: "pilot_enterprise_run_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "pilot_runs",
            metadata: { product_family: "pilot", plan_code: "enterprise", billing_component: "usage", usage_dimension: "pilot_runs" },
          },
        ],
        entitlements: {
          "pilot.runners.max": -1,
          "pilot.runs.monthly": -1,
          "pilot.automation.enabled": true,
          "pilot.retention_days": 90,
          "pilot.parallel_runs": -1,
          "pilot.priority_support": true,
        },
      },
    ],
  },

  // ── MigraDrive ──────────────────────────────────────────────────
  {
    productFamily: "drive",
    name: "MigraDrive",
    description: "File, object, backup, and document storage with S3-compatible API.",
    plans: [
      {
        planCode: "starter",
        name: "Starter",
        description: "Basic cloud storage.",
        prices: [
          {
            lookupKey: "drive_starter_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 499,
            metadata: { product_family: "drive", plan_code: "starter", billing_component: "base", entitlement_profile: "drive_starter" },
          },
        ],
        entitlements: {
          "drive.storage_gb": 50,
          "drive.transfer_gb.monthly": 100,
          "drive.versioning.enabled": false,
          "drive.api_access": false,
        },
      },
      {
        planCode: "business",
        name: "Business",
        description: "Business storage with API and versioning.",
        prices: [
          {
            lookupKey: "drive_business_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 1299,
            metadata: { product_family: "drive", plan_code: "business", billing_component: "base", entitlement_profile: "drive_business" },
          },
          {
            lookupKey: "drive_business_storage_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "storage_gb",
            metadata: { product_family: "drive", plan_code: "business", billing_component: "usage", usage_dimension: "storage_gb" },
          },
        ],
        entitlements: {
          "drive.storage_gb": 500,
          "drive.transfer_gb.monthly": 1000,
          "drive.versioning.enabled": true,
          "drive.api_access": true,
          "drive.team_sharing": true,
        },
      },
      {
        planCode: "enterprise",
        name: "Enterprise",
        description: "Enterprise storage with unlimited capacity.",
        prices: [
          {
            lookupKey: "drive_enterprise_base_month",
            componentType: "base",
            billingInterval: "month",
            unitAmount: 2999,
            metadata: { product_family: "drive", plan_code: "enterprise", billing_component: "base", entitlement_profile: "drive_enterprise" },
          },
          {
            lookupKey: "drive_enterprise_storage_usage",
            componentType: "usage",
            billingInterval: "month",
            unitAmount: null,
            meterName: "storage_gb",
            metadata: { product_family: "drive", plan_code: "enterprise", billing_component: "usage", usage_dimension: "storage_gb" },
          },
        ],
        entitlements: {
          "drive.storage_gb": -1,
          "drive.transfer_gb.monthly": -1,
          "drive.versioning.enabled": true,
          "drive.api_access": true,
          "drive.team_sharing": true,
          "drive.priority_support": true,
        },
      },
    ],
  },
];

/**
 * Look up a plan from the catalog by product family and plan code.
 */
export function findCatalogPlan(productFamily: ProductFamily, planCode: PlanCode): CatalogPlan | undefined {
  const product = PRODUCT_CATALOG.find((p) => p.productFamily === productFamily);
  return product?.plans.find((p) => p.planCode === planCode);
}

/**
 * Look up a price by its lookup key across all catalog plans.
 */
export function findCatalogPrice(lookupKey: string): { product: CatalogProduct; plan: CatalogPlan; price: CatalogPrice } | undefined {
  for (const product of PRODUCT_CATALOG) {
    for (const plan of product.plans) {
      const price = plan.prices.find((p) => p.lookupKey === lookupKey);
      if (price) {
        return { product, plan, price };
      }
    }
  }
  return undefined;
}
