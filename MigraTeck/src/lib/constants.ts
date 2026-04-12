import { ProductKey } from "@prisma/client";

export const APP_NAME = "MigraTeck";
export const ACTIVE_ORG_COOKIE = "migrateck-active-org";

type LaunchUrlEnvKey =
  | "MIGRATECK_LAUNCH_URL"
  | "MIGRAHOSTING_LAUNCH_URL"
  | "MIGRAPANEL_LAUNCH_URL"
  | "MIGRAVOICE_LAUNCH_URL"
  | "MIGRAMAIL_LAUNCH_URL"
  | "MIGRAINTAKE_LAUNCH_URL"
  | "MIGRAMARKET_LAUNCH_URL"
  | "MIGRAPILOT_LAUNCH_URL"
  | "MIGRAINVOICE_LAUNCH_URL"
  | "MIGRADRIVE_LAUNCH_URL";

export type PricingTier = {
  name: string;
  monthlyPrice: number; // USD cents
  interval: "month" | "year";
  features: string[];
  planCode?: string;
  storageQuotaGb?: number;
  highlighted?: boolean;
  stripePriceId?: string;
  contactSales?: boolean;
};

export type ProductCatalogEntry = {
  key: ProductKey;
  code: string;
  name: string;
  description: string;
  launchUrlEnv: LaunchUrlEnvKey;
  clientOnly: boolean;
  purchasable?: boolean;
  pricing?: PricingTier[];
};

export const PRODUCT_CATALOG: ProductCatalogEntry[] = [
  {
    key: ProductKey.MIGRATECK,
    code: "MT",
    name: "MigraTeck",
    description: "Core ecosystem workspace for identity, governance, tenant access, and shared platform operations.",
    launchUrlEnv: "MIGRATECK_LAUNCH_URL",
    clientOnly: false,
  },
  {
    key: ProductKey.MIGRAHOSTING,
    code: "MH",
    name: "MigraHosting",
    description: "Dedicated VPS infrastructure, domain provisioning, and infrastructure operations for client workloads. No shared-hosting or shared-VPS storefront offers are exposed here.",
    launchUrlEnv: "MIGRAHOSTING_LAUNCH_URL",
    clientOnly: true,
    // MigraHosting storefront pricing is intentionally hidden until the dedicated VPS catalog is wired.
  },
  {
    key: ProductKey.MIGRAPANEL,
    code: "MP",
    name: "MigraPanel",
    description: "Client operations control plane with billing, infrastructure, and provisioning workflows.",
    launchUrlEnv: "MIGRAPANEL_LAUNCH_URL",
    clientOnly: true,
  },
  {
    key: ProductKey.MIGRAVOICE,
    code: "MV",
    name: "MigraVoice",
    description: "Carrier-ready cloud PBX with AI voicemail, IVR, recording, softphone access, and tenant-level voice analytics.",
    launchUrlEnv: "MIGRAVOICE_LAUNCH_URL",
    clientOnly: false,
    purchasable: true,
    // Canonical MigraVoice packaging follows the enterprise public site and voice-backend catalog.
    pricing: [
      { name: "Starter", monthlyPrice: 2499, interval: "month", features: ["Up to 5 users", "Up to 2 numbers", "AI voicemail", "Web and mobile softphone", "Smart call routing", "Business SMS (100/mo)"], stripePriceId: "price_1TKsXUIrfeNRpsizk482SH5r" },
      { name: "Business", monthlyPrice: 7999, interval: "month", features: ["Up to 25 users", "Up to 10 numbers", "Multi-level IVR", "Call recording and AI summaries", "Skills-based queues", "CRM integrations"], highlighted: true, stripePriceId: "price_1TKsXUIrfeNRpsizzWIXRbzI" },
      { name: "Professional", monthlyPrice: 17999, interval: "month", features: ["Up to 75 users", "Up to 30 numbers", "AI transcription and sentiment", "Live monitoring", "Autodialer and power dialing", "SIP trunking and E911"], stripePriceId: "price_1TKsXVIrfeNRpsizcPhMnvSJ" },
      { name: "Enterprise", monthlyPrice: 34999, interval: "month", features: ["Up to 200 users", "Up to 100 numbers", "Dedicated SIP trunks", "Custom integrations", "99.99% SLA", "24/7 priority support"], stripePriceId: "price_1TKsXVIrfeNRpsizmZYDOHxR" },
    ],
  },
  {
    key: ProductKey.MIGRAMAIL,
    code: "MM",
    name: "MigraMail",
    description: "Mailbox, routing, and deliverability operations inside the MigraTeck ecosystem authority layer.",
    launchUrlEnv: "MIGRAMAIL_LAUNCH_URL",
    clientOnly: false,
    purchasable: true,
    // Priced below Google Workspace and Microsoft 365 while bundling multiple mailboxes
    pricing: [
      { name: "Starter", monthlyPrice: 700, interval: "month", features: ["5 Mailboxes", "10 GB Storage", "Custom Domain", "Spam Protection", "Less than Google Workspace Starter"], stripePriceId: "price_1THYIwIrfeNRpsizUgcqTKOH" },
      { name: "Business", monthlyPrice: 1500, interval: "month", features: ["25 Mailboxes", "50 GB Storage", "DKIM/DMARC", "Priority Delivery", "Aliases", "Lower than Microsoft 365 per-seat cost"], highlighted: true, stripePriceId: "price_1THYIxIrfeNRpsizmEgJLKUf" },
      { name: "Enterprise", monthlyPrice: 2900, interval: "month", features: ["Unlimited Mailboxes", "500 GB Storage", "Dedicated IP", "Audit Trail", "SLA", "Built for teams without per-user billing pain"], stripePriceId: "price_1THYIxIrfeNRpsizVeVDIMdr" },
    ],
  },
  {
    key: ProductKey.MIGRAINTAKE,
    code: "MI",
    name: "MigraIntake",
    description: "Marketing intake, onboarding capture, and operational handoff workflows tied to organization entitlement and audit controls.",
    launchUrlEnv: "MIGRAINTAKE_LAUNCH_URL",
    clientOnly: false,
  },
  {
    key: ProductKey.MIGRAMARKET,
    code: "MK",
    name: "MigraMarket",
    description: "Marketing control surface for campaigns, automation, publishing, and growth operations.",
    launchUrlEnv: "MIGRAMARKET_LAUNCH_URL",
    clientOnly: false,
    purchasable: true,
    // Pricing aligned to MigraMarket package templates and kept below common local-agency retainers
    pricing: [
      { name: "Local Visibility", monthlyPrice: 650, interval: "month", features: ["Google Posts", "Review Growth", "Local SEO", "Monthly Reporting", "$500 setup"], stripePriceId: "price_1TKsXVIrfeNRpsizyENuqcM7" },
      { name: "Social + Email", monthlyPrice: 900, interval: "month", features: ["Social Calendar", "Social Publishing", "Email Campaigns", "Audience Segmentation", "$650 setup"], highlighted: true, stripePriceId: "price_1TKsXWIrfeNRpsizjs4LwZk8" },
      { name: "Full Growth Engine", monthlyPrice: 2200, interval: "month", features: ["Google + SEO", "Content + Email", "Paid Ads", "Lead Ops", "$1,200 setup"], stripePriceId: "price_1TKsXWIrfeNRpsizrwJxGKmz" },
    ],
  },
  {
    key: ProductKey.MIGRAPILOT,
    code: "MPILOT",
    name: "MigraPilot",
    description: "Command and automation platform for agents, runners, extension tooling, and workflow execution.",
    launchUrlEnv: "MIGRAPILOT_LAUNCH_URL",
    clientOnly: false,
    purchasable: true,
    // Pricing benchmarked below Zapier Professional ($19.99) and Zapier Team ($69)
    pricing: [
      { name: "Starter", monthlyPrice: 1500, interval: "month", features: ["100 Runs/month", "1 Runner", "Basic Agents", "Community Support", "Below Zapier Professional ($19.99)"], stripePriceId: "price_1TKsXWIrfeNRpsizGxQcjqZW" },
      { name: "Business", monthlyPrice: 4900, interval: "month", features: ["2,000 Runs/month", "5 Runners", "Custom Agents", "Priority Support", "API Access", "Lower than Zapier Team ($69)"], highlighted: true, stripePriceId: "price_1TKsXXIrfeNRpsizBIela1FT" },
      { name: "Enterprise", monthlyPrice: 14900, interval: "month", features: ["Unlimited Runs", "Dedicated Runners", "AI Escalation", "SSO", "SLA", "Enterprise automation without enterprise bloat"], stripePriceId: "price_1TKsXXIrfeNRpsiz0UJK93uN" },
    ],
  },
  {
    key: ProductKey.MIGRADRIVE,
    code: "MDR",
    name: "MigraDrive",
    description: "File, object, backup, and document storage services with S3-compatible API and team collaboration.",
    launchUrlEnv: "MIGRADRIVE_LAUNCH_URL",
    clientOnly: false,
    purchasable: true,
    // Pricing benchmarked below DigitalOcean Spaces ($5/250GB), Dropbox Essentials ($16.58/mo)
    pricing: [
      { name: "Starter", planCode: "starter", storageQuotaGb: 100, monthlyPrice: 499, interval: "month", features: ["100 GB Storage", "File Sharing", "Basic Backup", "Standard Support", "Below DigitalOcean Spaces baseline"], stripePriceId: "price_1TKsXXIrfeNRpsizMarzVWpx" },
      { name: "Business", planCode: "business", storageQuotaGb: 1000, monthlyPrice: 1299, interval: "month", features: ["1 TB Storage", "S3-Compatible API", "Team Collaboration", "Priority Support", "File Versioning", "Under Dropbox Essentials"], highlighted: true, stripePriceId: "price_1TKsXYIrfeNRpsizU8JyfNZQ" },
      { name: "Enterprise", planCode: "enterprise", storageQuotaGb: 5000, monthlyPrice: 2999, interval: "month", features: ["Unlimited Storage", "Object Storage", "Dedicated Infrastructure", "Audit Trail", "SLA", "Built for teams that outgrow consumer storage"], stripePriceId: "price_1TKsXYIrfeNRpsiziOJz2r9E" },
    ],
  },
  {
    key: ProductKey.MIGRAINVOICE,
    code: "MINV",
    name: "MigraInvoice",
    description: "Professional invoicing, quoting, and payment processing platform with multi-language and multi-currency support.",
    launchUrlEnv: "MIGRAINVOICE_LAUNCH_URL",
    clientOnly: false,
    purchasable: true,
    // Priced below FreshBooks ($19/$33/$60) and HoneyBook ($19/$39/$79)
    pricing: [
      { name: "Starter", monthlyPrice: 1500, interval: "month", features: ["Unlimited Invoices & Quotes", "Up to 5 clients", "Online Payments", "Expense Tracking", "More affordable than FreshBooks ($19/mo)"], stripePriceId: "price_1TKsXYIrfeNRpsizSO8gwd8w" },
      { name: "Professional", monthlyPrice: 3900, interval: "month", features: ["Everything in Starter", "Unlimited Clients", "Custom Branding", "Multi-Currency", "Recurring Billing", "Less than HoneyBook at $39/mo"], highlighted: true, stripePriceId: "price_1TKsXZIrfeNRpsiz6qbcNGKu" },
      { name: "Advanced", monthlyPrice: 7900, interval: "month", features: ["Everything in Professional", "10 Team Members", "API Access", "Desktop App", "Priority Support", "Half the price of QuickBooks ($90/mo)"], stripePriceId: "price_1TKsXZIrfeNRpsizN1Vx0uLf" },
      { name: "Enterprise", monthlyPrice: 0, interval: "month", features: ["Unlimited Team Members", "Dedicated Account Manager", "Custom SLA", "White-Label Option", "Volume Discounts"], contactSales: true },
    ],
  },
] as const;

const productCatalogMap = new Map(PRODUCT_CATALOG.map((product) => [product.key, product]));

export const CLIENT_ONLY_PRODUCT_KEYS = new Set(
  PRODUCT_CATALOG.filter((product) => product.clientOnly).map((product) => product.key),
);

export function getProductConfig(product: ProductKey): ProductCatalogEntry | undefined {
  return productCatalogMap.get(product);
}

export function isClientOnlyProduct(product: ProductKey): boolean {
  return CLIENT_ONLY_PRODUCT_KEYS.has(product);
}

export function resolveProductLaunchUrl(product: ProductKey): string | undefined {
  const config = getProductConfig(product);
  if (!config) {
    return undefined;
  }

  return process.env[config.launchUrlEnv];
}

export const PUBLIC_NAV_ITEMS = [
  { href: "/platform", label: "Platform" },
  { href: "/services", label: "Services" },
  { href: "/products", label: "Products" },
  { href: "/pricing", label: "Pricing" },
  { href: "/developers", label: "Developers" },
  { href: "/company", label: "Company" },
];

export type AppNavSection = "command" | "workspace" | "governance";

export type AppNavItem = {
  href: string;
  label: string;
  section: AppNavSection;
};

export const APP_NAV_ITEMS = [
  { href: "/app", label: "Command", section: "command" },
  { href: "/app/products", label: "Products", section: "command" },
  { href: "/app/launch", label: "Launch", section: "command" },
  { href: "/app/orgs", label: "Organizations", section: "workspace" },
  { href: "/app/billing", label: "Billing", section: "workspace" },
  { href: "/app/downloads", label: "Downloads", section: "workspace" },
  { href: "/app/drive", label: "Drive", section: "workspace" },
  { href: "/app/builder", label: "Builder", section: "workspace" },
  { href: "/app/migramarket", label: "MigraMarket", section: "workspace" },
  { href: "/app/audit", label: "Audit", section: "governance" },
] satisfies AppNavItem[];
