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
  shortDescription: string;
  longDescription: string;
  category: ProductCategory;
  status: "official";
  featured?: boolean;
  capabilities: string[];
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
    shortDescription:
      "Unified enterprise platform for identity, governance, product access, and ecosystem orchestration.",
    longDescription:
      "MigraTeck is the parent platform and control surface that centralizes identity, access governance, product routing, developer systems, and software distribution across the ecosystem.",
    category: "platform-core",
    status: "official",
    featured: true,
    capabilities: [
      "Unified control plane",
      "Identity and access foundation",
      "Governance and platform routing",
      "Developer and distribution entry",
    ],
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
    shortDescription:
      "Managed hosting and infrastructure delivery platform for modern business and application workloads.",
    longDescription:
      "MigraHosting provides managed hosting environments, deployment-ready infrastructure, and service delivery systems integrated into the MigraTeck platform.",
    category: "infrastructure-delivery",
    status: "official",
    featured: true,
    capabilities: [
      "Managed hosting environments",
      "Infrastructure delivery",
      "Business workload deployment",
      "Platform-integrated operations",
    ],
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
    shortDescription:
      "Operational intake and structured workflow capture system for organizations and service pipelines.",
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
    shortDescription:
      "Business mail, routing, and deliverability platform integrated with the MigraTeck ecosystem.",
    longDescription:
      "MigraMail provides organization-grade mailbox services, routing systems, deliverability operations, and communication infrastructure aligned with the MigraTeck authority layer.",
    category: "communications",
    status: "official",
    featured: true,
    capabilities: [
      "Business mailbox services",
      "Mail routing systems",
      "Deliverability operations",
      "Platform-aligned communication infrastructure",
    ],
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
    shortDescription:
      "Administrative and operational control panel for platform resources, product access, and service workflows.",
    longDescription:
      "MigraPanel acts as an operational management surface for provisioning, product administration, governance controls, and cross-system platform actions.",
    category: "platform-core",
    status: "official",
    featured: true,
    capabilities: [
      "Operational management surface",
      "Provisioning controls",
      "Governance actions",
      "Cross-system product administration",
    ],
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
    shortDescription:
      "Automation and command platform for agents, tasks, execution workflows, and operational tooling.",
    longDescription:
      "MigraPilot provides workflow automation, execution control, task orchestration, and agent-capable tooling for product and operations workflows.",
    category: "platform-core",
    status: "official",
    capabilities: [
      "Workflow automation",
      "Execution control",
      "Task orchestration",
      "Agent-capable operational tooling",
    ],
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
    shortDescription:
      "Voice and communications platform for calling, routing, telephony workflows, and business interaction systems.",
    longDescription:
      "MigraVoice delivers voice infrastructure, call handling systems, communication workflows, and business-facing telephony services within the MigraTeck ecosystem.",
    category: "communications",
    status: "official",
    featured: true,
    capabilities: [
      "Voice infrastructure",
      "Call handling systems",
      "Telephony workflows",
      "Business communication services",
    ],
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
    shortDescription:
      "Secure file, object, and document storage platform with managed access and ecosystem integration.",
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
    shortDescription:
      "Professional invoicing, quoting, and payment workflow platform for business operations.",
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
