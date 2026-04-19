/**
 * Canonical MigraTeck ecosystem product registry.
 * Use this file as the single source of truth for product names, logos,
 * descriptions, slugs, taxonomy, and platform linkage across migrateck.com.
 * All product UI should derive from this registry first.
 */

export type ProductKey =
  | "migrateck"
  | "migrahosting"
  | "migraintake"
  | "migramail"
  | "migramarketing"
  | "migrapanel"
  | "migrapilot"
  | "migravoice"
  | "migradrive"
  | "migrainvoice";

export type ProductCategory =
  | "platform-core"
  | "infrastructure-delivery"
  | "communications"
  | "operations-workflow"
  | "growth-marketing";

export type ProductLinkSet = {
  officialWebsite?: string;
  docsUrl?: string;
  apiUrl?: string;
  downloadsUrl?: string;
};

export type ProductRecord = {
  key: ProductKey;
  name: string;
  slug: string;
  logo: string;
  tagline: string;
  shortDescription: string;
  longDescription: string;
  category: ProductCategory;
  status: "official";
  featured?: boolean;
  capabilities: string[];
  relatedProducts: string[];
  links: ProductLinkSet;
};

export const officialProductUrls = {
  migrateck: "https://migrateck.com/",
  migrahosting: "https://www.migrahosting.com/",
  migramail: "https://migramail.com/",
  migramarketing: "https://migramarket.com/",
  migradrive: "https://migradrive.com/",
  migravoice: "https://migravoice.com/",
  migrapanel: "https://migrapanel.com/",
  migraintake: "https://intake.migrahosting.com/",
  migrainvoice: "https://migrainvoice.migrateck.com/",
  migrapilot: "https://pilot.migrateck.com/",
} as const;

export const productCategories: Record<
  ProductCategory,
  {
    title: string;
    description: string;
    order: number;
  }
> = {
  "platform-core": {
    title: "Platform Core",
    description:
      "Control surfaces, platform administration, and execution systems that anchor the MigraTeck ecosystem.",
    order: 1,
  },
  "infrastructure-delivery": {
    title: "Infrastructure & Delivery",
    description:
      "Managed infrastructure, storage, and delivery systems for business and application workloads.",
    order: 2,
  },
  communications: {
    title: "Communications",
    description:
      "Messaging, mailbox, voice, and communication systems integrated into the unified platform.",
    order: 3,
  },
  "operations-workflow": {
    title: "Operations & Workflow",
    description:
      "Structured intake, invoicing, operational routing, and workflow management systems for scalable execution.",
    order: 4,
  },
  "growth-marketing": {
    title: "Growth & Marketing",
    description:
      "Campaign, publishing, and growth systems aligned with the broader MigraTeck platform.",
    order: 5,
  },
};

export const products: ProductRecord[] = [
  {
    key: "migrateck",
    name: "MigraTeck",
    slug: "migrateck",
    logo: "/brands/products/migrateck.png",
    tagline: "Shared platform for identity, governance, and distribution",
    shortDescription:
      "The shared platform layer and flagship control surface behind the MigraTeck ecosystem.",
    longDescription:
      "MigraTeck centralizes identity, governance, product routing, developer entry, and software distribution across the ecosystem. It is both the company platform and the layer that makes the rest of the products feel connected instead of separate.",
    category: "platform-core",
    status: "official",
    featured: true,
    capabilities: [
      "Unified control plane",
      "Identity and access foundation",
      "Governance and platform routing",
      "Developer and distribution entry",
    ],
    relatedProducts: ["migrapanel", "migrapilot"],
    links: {
      officialWebsite: officialProductUrls.migrateck,
      docsUrl: "/developers",
      apiUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
  {
    key: "migrahosting",
    name: "MigraHosting",
    slug: "migrahosting",
    logo: "/brands/products/migrahosting.png",
    tagline: "Managed hosting and infrastructure delivery",
    shortDescription:
      "Managed hosting and infrastructure delivery for modern business and application workloads.",
    longDescription:
      "MigraHosting provides managed hosting environments, deployment-ready infrastructure, and service delivery systems integrated into the broader MigraTeck platform.",
    category: "infrastructure-delivery",
    status: "official",
    featured: true,
    capabilities: [
      "Managed hosting environments",
      "Infrastructure delivery",
      "Business workload deployment",
      "Platform-integrated operations",
    ],
    relatedProducts: ["migradrive", "migrateck"],
    links: {
      officialWebsite: officialProductUrls.migrahosting,
      docsUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
  {
    key: "migraintake",
    name: "MigraIntake",
    slug: "migraintake",
    logo: "/brands/products/migraintake.png",
    tagline: "Structured intake and onboarding workflows",
    shortDescription:
      "Structured intake and workflow capture for onboarding, submissions, and operational routing.",
    longDescription:
      "MigraIntake standardizes data collection, request intake, onboarding workflows, and operational handoff into consistent enterprise-ready intake flows.",
    category: "operations-workflow",
    status: "official",
    capabilities: [
      "Structured intake flows",
      "Request capture",
      "Onboarding workflows",
      "Operational handoff standardization",
    ],
    relatedProducts: ["migrainvoice", "migravoice"],
    links: {
      officialWebsite: officialProductUrls.migraintake,
      docsUrl: "/developers",
      apiUrl: "/developers",
    },
  },
  {
    key: "migramail",
    name: "MigraMail",
    slug: "migramail",
    logo: "/brands/products/migramail.png",
    tagline: "Business mail, routing, and deliverability",
    shortDescription:
      "Business mail, routing, and deliverability services aligned with the MigraTeck platform.",
    longDescription:
      "MigraMail provides organization-grade mailbox services, routing systems, deliverability operations, and communications infrastructure aligned with the MigraTeck authority layer.",
    category: "communications",
    status: "official",
    featured: true,
    capabilities: [
      "Business mailbox services",
      "Mail routing systems",
      "Deliverability operations",
      "Platform-aligned communication infrastructure",
    ],
    relatedProducts: ["migravoice", "migramarketing"],
    links: {
      officialWebsite: officialProductUrls.migramail,
      docsUrl: "/developers",
      apiUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
  {
    key: "migramarketing",
    name: "MigraMarketing",
    slug: "migramarketing",
    logo: "/brands/products/migramarketing.png",
    tagline: "Campaign execution and publishing workflows",
    shortDescription:
      "Marketing operations platform for campaign execution, publishing, and growth workflows.",
    longDescription:
      "MigraMarketing supports campaign operations, content publishing, growth execution, and structured marketing workflows within the MigraTeck ecosystem.",
    category: "growth-marketing",
    status: "official",
    capabilities: [
      "Campaign execution",
      "Publishing workflows",
      "Growth operations",
      "Structured marketing systems",
    ],
    relatedProducts: ["migramail", "migraintake"],
    links: {
      officialWebsite: officialProductUrls.migramarketing,
      docsUrl: "/developers",
      apiUrl: "/developers",
    },
  },
  {
    key: "migrapanel",
    name: "MigraPanel",
    slug: "migrapanel",
    logo: "/brands/products/migrapanel.png",
    tagline: "Operational control surface for platform resources",
    shortDescription:
      "Administrative and operational control panel for platform resources, product access, and service workflows.",
    longDescription:
      "MigraPanel is the operational management surface for provisioning, product administration, governance controls, and cross-system platform actions.",
    category: "platform-core",
    status: "official",
    featured: true,
    capabilities: [
      "Operational management surface",
      "Provisioning controls",
      "Governance actions",
      "Cross-system product administration",
    ],
    relatedProducts: ["migrateck", "migrapilot"],
    links: {
      officialWebsite: officialProductUrls.migrapanel,
      docsUrl: "/developers",
      apiUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
  {
    key: "migrapilot",
    name: "MigraPilot",
    slug: "migrapilot",
    logo: "/brands/products/migrapilot.png",
    tagline: "Workflow automation and execution control",
    shortDescription:
      "Automation and command platform for workflows, tasks, execution control, and agent-capable operations.",
    longDescription:
      "MigraPilot provides workflow automation, execution control, task orchestration, and agent-capable tooling for product and operations workflows across the ecosystem.",
    category: "platform-core",
    status: "official",
    capabilities: [
      "Workflow automation",
      "Execution control",
      "Task orchestration",
      "Agent-capable operational tooling",
    ],
    relatedProducts: ["migrateck", "migrapanel"],
    links: {
      officialWebsite: officialProductUrls.migrapilot,
      docsUrl: "/developers",
      apiUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
  {
    key: "migravoice",
    name: "MigraVoice",
    slug: "migravoice",
    logo: "/brands/products/migravoice.png",
    tagline: "Voice infrastructure and telephony workflows",
    shortDescription:
      "Voice and communications platform for calling, routing, telephony workflows, and business interaction systems.",
    longDescription:
      "MigraVoice delivers voice infrastructure, call handling systems, communication workflows, and business-facing telephony services inside the MigraTeck ecosystem.",
    category: "communications",
    status: "official",
    featured: true,
    capabilities: [
      "Voice infrastructure",
      "Call handling systems",
      "Telephony workflows",
      "Business communication services",
    ],
    relatedProducts: ["migramail", "migraintake"],
    links: {
      officialWebsite: officialProductUrls.migravoice,
      docsUrl: "/developers",
      apiUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
  {
    key: "migradrive",
    name: "MigraDrive",
    slug: "migradrive",
    logo: "/brands/products/migradrive.png",
    tagline: "Secure storage, file access, and controlled distribution",
    shortDescription:
      "Secure storage, file access, and document distribution integrated with the MigraTeck platform.",
    longDescription:
      "MigraDrive provides storage, file management, access control, and document-oriented platform services connected to the MigraTeck control surface.",
    category: "infrastructure-delivery",
    status: "official",
    featured: true,
    capabilities: [
      "File and object storage",
      "Document-oriented services",
      "Managed access controls",
      "Ecosystem-integrated storage layer",
    ],
    relatedProducts: ["migrahosting", "migrateck"],
    links: {
      officialWebsite: officialProductUrls.migradrive,
      docsUrl: "/developers",
      apiUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
  {
    key: "migrainvoice",
    name: "MigraInvoice",
    slug: "migrainvoice",
    logo: "/brands/products/migrainvoice.png",
    tagline: "Invoicing, quotes, and payment workflows",
    shortDescription:
      "Professional invoicing, quoting, and payment workflow coordination for business operations.",
    longDescription:
      "MigraInvoice provides structured invoicing, quote generation, payment workflow support, and business document operations as part of the broader MigraTeck ecosystem.",
    category: "operations-workflow",
    status: "official",
    capabilities: [
      "Invoicing workflows",
      "Quote generation",
      "Payment support",
      "Business document operations",
    ],
    relatedProducts: ["migraintake", "migrateck"],
    links: {
      officialWebsite: officialProductUrls.migrainvoice,
      docsUrl: "/developers",
      downloadsUrl: "/downloads",
    },
  },
];

export const productsByKey: Record<ProductKey, ProductRecord> = products.reduce(
  (acc, product) => {
    acc[product.key] = product;
    return acc;
  },
  {} as Record<ProductKey, ProductRecord>,
);

export const featuredProducts = products.filter((product) => product.featured);

export const productsGroupedByCategory = Object.entries(productCategories)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([categoryKey, meta]) => ({
    category: categoryKey as ProductCategory,
    title: meta.title,
    description: meta.description,
    products: products.filter((product) => product.category === categoryKey),
  }));

export const productCardUiCopy = {
  eyebrow: "Official platform product",
  primaryCta: "View product",
  secondaryCta: "Explore platform access",
  linkLabels: {
    officialWebsite: "Official page",
    docsUrl: "Docs",
    apiUrl: "API",
    downloadsUrl: "Downloads",
  },
} as const;

export function getProductBySlug(slug: string): ProductRecord | undefined {
  return products.find((product) => product.slug === slug);
}
