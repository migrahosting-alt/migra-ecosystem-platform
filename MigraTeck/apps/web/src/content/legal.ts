export type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

export type LegalDocument = {
  slug: string;
  title: string;
  shortTitle: string;
  category: "core" | "product";
  summary: string;
  description: string;
  lastUpdated: string;
  version: string;
  appliesTo: string[];
  relatedLinks: Array<{
    href: string;
    label: string;
  }>;
  sections: LegalSection[];
};

const lastUpdated = "April 12, 2026";
const version = "v1.0";

export const legalAliases: Record<string, string> = {
  migraemail: "migramail",
};

export const legalDocuments: LegalDocument[] = [
  {
    slug: "terms",
    title: "MigraTeck Terms of Service",
    shortTitle: "Terms",
    category: "core",
    summary:
      "The master agreement governing access to all MigraTeck services, accounts, organizations, and product surfaces.",
    description:
      "Global terms covering account obligations, service access, billing references, suspension, intellectual property, and product addenda.",
    lastUpdated,
    version,
    appliesTo: [
      "All MigraTeck services and websites",
      "All users and organizations using MigraTeck accounts",
      "All product-specific services unless superseded by an addendum",
    ],
    relatedLinks: [
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/payment", label: "Payment Policy" },
      { href: "/legal/acceptable-use", label: "Acceptable Use Policy" },
    ],
    sections: [
      {
        title: "1. Definitions",
        paragraphs: [
          "\"MigraTeck\" means the MigraTeck legal entity and its operated services.",
          "\"Services\" means all websites, applications, APIs, hosted systems, and managed offerings operated by MigraTeck.",
          "\"User\" means the individual who creates or uses an account. \"Organization\" means a business, team, or entity represented in the services.",
        ],
      },
      {
        title: "2. Accounts and eligibility",
        paragraphs: [
          "Users are responsible for maintaining accurate account information and safeguarding access credentials.",
          "You may not share access in a way that bypasses seat, role, or organization controls.",
        ],
        bullets: [
          "Use the services only if you can form a binding agreement.",
          "Maintain accurate registration, billing, and contact information.",
          "Promptly notify MigraTeck of suspected unauthorized access.",
        ],
      },
      {
        title: "3. Service access and restrictions",
        paragraphs: [
          "MigraTeck grants a limited, revocable, non-exclusive right to use the services in accordance with this Agreement.",
        ],
        bullets: [
          "Do not reverse engineer or interfere with the services except as allowed by law.",
          "Do not bypass rate limits, access controls, or technical restrictions.",
          "API use remains subject to published scope, quota, and security requirements.",
        ],
      },
      {
        title: "4. Billing and subscriptions",
        paragraphs: [
          "Paid services are governed by the MigraTeck Payment Policy and any product-specific billing addendum.",
          "Subscription, usage, and provisioning charges may vary by service plan and product type.",
        ],
      },
      {
        title: "5. Suspension and termination",
        bullets: [
          "MigraTeck may suspend or terminate access for non-payment, abuse, unlawful activity, or material breach.",
          "We may take immediate protective action when an account presents operational or security risk.",
          "Termination does not erase accrued fees or obligations that survive by their nature.",
        ],
      },
      {
        title: "6. Data, privacy, and content",
        paragraphs: [
          "Privacy practices are described in the MigraTeck Privacy Policy.",
          "Users retain ownership of their content, but grant MigraTeck the rights reasonably necessary to host, process, secure, back up, and transmit that content to operate the services.",
        ],
      },
      {
        title: "7. Intellectual property and liability",
        bullets: [
          "MigraTeck and its licensors retain all rights in the services, software, branding, and documentation.",
          "Except where prohibited by law, MigraTeck is not liable for indirect, incidental, special, consequential, or punitive damages.",
          "Any direct liability will be limited to the amounts paid for the affected service during the 12 months preceding the claim.",
        ],
      },
      {
        title: "8. Product addenda, updates, and governing law",
        paragraphs: [
          "Certain MigraTeck services may be subject to additional product-specific terms, which form part of this Agreement.",
          "MigraTeck may update the services or these policies from time to time. Continued use after an effective date constitutes acceptance of the updated terms.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "MigraTeck Privacy Policy",
    shortTitle: "Privacy",
    category: "core",
    summary:
      "The shared privacy policy for identity, product usage, communications, and operational data across the MigraTeck ecosystem.",
    description:
      "How MigraTeck collects, uses, stores, shares, and protects personal and service data across products.",
    lastUpdated,
    version,
    appliesTo: [
      "Identity and account data",
      "Usage and device telemetry",
      "Support, billing, and operational communications",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/security", label: "Security Policy" },
      { href: "/legal/migramail", label: "MigraMail Addendum" },
    ],
    sections: [
      {
        title: "1. Data we collect",
        bullets: [
          "Identity data such as name, email address, organization membership, and authentication metadata.",
          "Usage data such as page activity, product events, API requests, and administrative actions.",
          "Device and network data such as browser, operating system, IP address, and security logs.",
          "Commercial data such as subscriptions, invoices, payment status, and transaction history.",
        ],
      },
      {
        title: "2. How we use data",
        bullets: [
          "Operate, secure, and improve the services.",
          "Authenticate users, manage sessions, and enforce organization access.",
          "Process billing, customer support, service communications, and legal notices.",
          "Detect fraud, abuse, misuse, and other security events.",
        ],
      },
      {
        title: "3. Sharing and disclosure",
        paragraphs: [
          "MigraTeck may share data with subprocessors, infrastructure vendors, payment providers, and other service providers acting on our behalf.",
          "We may also disclose data when required for legal compliance, fraud prevention, security response, or protection of rights and safety.",
        ],
      },
      {
        title: "4. Retention and deletion",
        paragraphs: [
          "We retain data only as long as necessary for service delivery, security, billing, audit, contractual obligations, and compliance requirements.",
          "Retention periods may differ by data category, especially for billing records, audit trails, and security events.",
        ],
      },
      {
        title: "5. User rights",
        bullets: [
          "Request access to certain personal data held by MigraTeck.",
          "Request correction or deletion where legally available.",
          "Request information about how your data is processed or shared.",
        ],
      },
      {
        title: "6. Security and transfers",
        paragraphs: [
          "MigraTeck uses technical and organizational safeguards to protect data in transit and at rest, though no system is perfectly secure.",
          "Certain services may involve cross-border processing depending on infrastructure region, vendor location, and organization configuration.",
        ],
      },
      {
        title: "7. Product-specific disclosures",
        paragraphs: [
          "Certain services may collect or process additional data specific to their functionality, as described in product-specific disclosures and addenda.",
        ],
      },
    ],
  },
  {
    slug: "payment",
    title: "MigraTeck Payment Policy",
    shortTitle: "Payment",
    category: "core",
    summary:
      "Shared billing terms for subscriptions, usage-based charges, provisioning fees, taxes, cancellations, and payment enforcement.",
    description:
      "Central payment rules that apply across paid MigraTeck services, with product-specific billing addenda where required.",
    lastUpdated,
    version,
    appliesTo: [
      "Subscriptions",
      "Usage-based services",
      "One-time fees and provisioning charges",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/migrahosting", label: "MigraHosting Addendum" },
      { href: "/legal/migrabuilder", label: "MigraBuilder Addendum" },
    ],
    sections: [
      {
        title: "1. Billing models",
        bullets: [
          "MigraTeck may charge recurring subscription fees, metered usage fees, one-time setup fees, or a combination of these models.",
          "Plan details, resource limits, and pricing are defined in the relevant product offer or order flow.",
        ],
      },
      {
        title: "2. Payment authorization and renewal",
        paragraphs: [
          "By purchasing a paid service, you authorize MigraTeck and its payment providers to charge the selected payment method for all applicable fees and taxes.",
          "Subscriptions renew automatically at the end of each billing cycle unless cancelled before the renewal date.",
        ],
      },
      {
        title: "3. Refunds and cancellation",
        bullets: [
          "Unless a product-specific policy states otherwise, fees are non-refundable once a billing cycle or provisioned service begins.",
          "Cancelling a subscription stops future renewals but does not retroactively reverse already incurred charges.",
          "Access may continue through the end of the paid period unless the product terms state a different cancellation effect.",
        ],
      },
      {
        title: "4. Failed payments and chargebacks",
        bullets: [
          "MigraTeck may retry failed charges and provide a limited grace period where appropriate.",
          "Accounts with unresolved payment failures may be restricted, suspended, or downgraded.",
          "Chargebacks or payment disputes may result in temporary or permanent account restrictions while the matter is investigated.",
        ],
      },
      {
        title: "5. Taxes and product addenda",
        paragraphs: [
          "Prices may exclude applicable taxes, duties, or similar government charges unless expressly stated otherwise.",
          "Certain services may include additional billing terms specific to that product.",
        ],
      },
    ],
  },
  {
    slug: "acceptable-use",
    title: "MigraTeck Acceptable Use Policy",
    shortTitle: "Acceptable Use",
    category: "core",
    summary:
      "The operational and conduct rules that protect MigraTeck infrastructure, customers, communications systems, and hosted services.",
    description:
      "Rules against unlawful use, abuse, spam, infrastructure misuse, harmful content, and platform interference.",
    lastUpdated,
    version,
    appliesTo: [
      "All users, organizations, APIs, and hosted workloads",
      "Communications, hosting, and distribution systems",
      "Any content or traffic transmitted through MigraTeck services",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/migrahosting", label: "MigraHosting Addendum" },
      { href: "/legal/migramail", label: "MigraMail Addendum" },
    ],
    sections: [
      {
        title: "1. Prohibited activity",
        bullets: [
          "Illegal activity, fraud, deceptive practices, or unlawful content distribution.",
          "Harassment, threats, abuse, or attempts to harm other users, customers, or third parties.",
          "Use of the services to violate privacy, intellectual property rights, or regulatory obligations.",
        ],
      },
      {
        title: "2. Infrastructure misuse",
        bullets: [
          "Attempting unauthorized access, probing, scanning, or bypassing access controls.",
          "Launching denial-of-service attacks, malware delivery, credential stuffing, or exploit activity.",
          "Using platform resources in a way that materially degrades service reliability for others.",
        ],
      },
      {
        title: "3. Communications abuse",
        bullets: [
          "Spam, phishing, unwanted bulk messaging, or sender identity manipulation.",
          "Voice, telephony, or messaging activity that violates consent, notice, or anti-abuse rules.",
        ],
      },
      {
        title: "4. Hosted content restrictions",
        paragraphs: [
          "Customers remain responsible for the content, software, and traffic they host or transmit through MigraTeck services.",
        ],
        bullets: [
          "Do not host malware, botnet infrastructure, credential theft tooling, or prohibited exploit content.",
          "Do not use hosting services for unlawful marketplaces, abusive campaigns, or illegal distribution.",
        ],
      },
      {
        title: "5. Enforcement",
        paragraphs: [
          "MigraTeck may investigate suspected violations and take protective action, including warnings, suspension, throttling, removal, or termination.",
        ],
      },
    ],
  },
  {
    slug: "security",
    title: "MigraTeck Security Policy",
    shortTitle: "Security",
    category: "core",
    summary:
      "A public statement of MigraTeck security practices, account protections, operational controls, and disclosure expectations.",
    description:
      "High-level security commitments across encryption, access control, monitoring, account protection, and incident handling.",
    lastUpdated,
    version,
    appliesTo: [
      "Identity and session systems",
      "Product and infrastructure surfaces",
      "Operational and security event handling",
    ],
    relatedLinks: [
      { href: "/security", label: "Security overview" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/.well-known/security.txt", label: "security.txt" },
    ],
    sections: [
      {
        title: "1. Security program",
        bullets: [
          "Encryption in transit for public services and administrative endpoints.",
          "Role-based access controls for internal systems and operational workflows.",
          "Audit logging for identity, security, and privileged product actions.",
          "Continuous dependency and configuration review as part of delivery workflows.",
        ],
      },
      {
        title: "2. Account protections",
        bullets: [
          "Centralized authentication through MigraAuth.",
          "Server-managed sessions with revocation support.",
          "Email verification, password reset, MFA, and passkey capabilities handled centrally.",
        ],
      },
      {
        title: "3. Shared responsibility",
        paragraphs: [
          "MigraTeck secures the shared platform, identity systems, and managed controls.",
          "Customers remain responsible for their own account hygiene, authorized user management, and any workloads, content, integrations, or systems they operate through the services.",
        ],
      },
      {
        title: "4. Security reporting",
        paragraphs: [
          "If you believe you have found a vulnerability, report it to security@migrateck.com. We may request supporting details to validate, triage, and resolve the issue.",
        ],
      },
    ],
  },
  {
    slug: "migrahosting",
    title: "MigraHosting Service Terms",
    shortTitle: "MigraHosting",
    category: "product",
    summary:
      "Product-specific billing and service terms for infrastructure provisioning, hosting workloads, backups, overages, and customer security responsibilities.",
    description:
      "Addendum covering MigraHosting billing triggers, infrastructure limits, customer obligations, and prohibited hosting activity.",
    lastUpdated,
    version,
    appliesTo: [
      "MigraHosting subscriptions and provisioned services",
      "Compute, storage, backups, network, and related infrastructure resources",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/payment", label: "Payment Policy" },
      { href: "/legal/acceptable-use", label: "Acceptable Use Policy" },
    ],
    sections: [
      {
        title: "1. Billing addendum",
        bullets: [
          "Billing may begin when a server, instance, storage volume, or related resource is provisioned or reserved.",
          "Resource overages, backups, storage expansion, bandwidth, domain renewal, and ancillary infrastructure services may incur separate charges.",
          "Suspended or reserved infrastructure may continue to generate charges where underlying capacity remains allocated.",
        ],
      },
      {
        title: "2. Service terms",
        bullets: [
          "Availability targets, if offered, apply only where expressly stated in a service plan or order.",
          "Customer workloads may be subject to technical, regional, capacity, or provider limitations outside MigraTeck's direct control.",
          "MigraTeck may perform maintenance, emergency changes, or service protection measures to preserve platform integrity.",
        ],
      },
      {
        title: "3. Customer responsibilities",
        bullets: [
          "Customers are responsible for application security, credential management, patching of self-managed software, and lawful content hosted on their infrastructure.",
          "Customers must maintain appropriate backups for workloads unless a managed backup service is explicitly included.",
        ],
      },
      {
        title: "4. Prohibited hosting activity",
        bullets: [
          "Malware distribution, botnet control, credential theft, exploit delivery, unlawful content hosting, and abusive scanning are prohibited.",
          "MigraHosting may suspend or isolate workloads that present operational, abuse, or legal risk.",
        ],
      },
    ],
  },
  {
    slug: "migrabuilder",
    title: "MigraBuilder Service Terms",
    shortTitle: "MigraBuilder",
    category: "product",
    summary:
      "Product-specific subscription, publishing, and content responsibility terms for sites and pages built with MigraBuilder.",
    description:
      "Addendum covering plan limits, publishing rules, bandwidth constraints, and customer content responsibilities.",
    lastUpdated,
    version,
    appliesTo: [
      "MigraBuilder design, publishing, and hosted site plans",
      "Organization-owned pages, content, and deployment outputs",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/payment", label: "Payment Policy" },
      { href: "/legal/privacy", label: "Privacy Policy" },
    ],
    sections: [
      {
        title: "1. Plans and limits",
        bullets: [
          "MigraBuilder plans may include limits on pages, projects, collaborators, bandwidth, storage, or publishing environments.",
          "Exceeding plan limits may require an upgrade, additional charges, or temporary restriction until the account is brought within plan scope.",
        ],
      },
      {
        title: "2. Publishing rules",
        bullets: [
          "Customers are responsible for validating the legality and accuracy of content they publish.",
          "MigraTeck may restrict deployment or delivery where content creates abuse, infringement, or security risk.",
        ],
      },
      {
        title: "3. Content responsibility",
        paragraphs: [
          "Customers retain ownership of their site content, but remain solely responsible for obtaining rights, permissions, and lawful authority for all published materials.",
        ],
      },
    ],
  },
  {
    slug: "migravoice",
    title: "MigraVoice Service Terms",
    shortTitle: "MigraVoice",
    category: "product",
    summary:
      "Product-specific compliance and operational terms for call handling, audio workflows, routing, recording, and consent obligations.",
    description:
      "Addendum covering recording notice, consent requirements, telecom compliance, and service limitations for voice workflows.",
    lastUpdated,
    version,
    appliesTo: [
      "MigraVoice calling, routing, and audio workflows",
      "Call recording, transcription, and telephony operations",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/acceptable-use", label: "Acceptable Use Policy" },
    ],
    sections: [
      {
        title: "1. Consent and recordings",
        bullets: [
          "Customers are responsible for complying with all laws related to call recording, monitoring, notice, consent, retention, and disclosure.",
          "If a workflow records or transcribes communications, the customer must ensure lawful notice and consent before activation where required.",
        ],
      },
      {
        title: "2. Service limitations",
        bullets: [
          "Telephony routes, carrier availability, regional support, and emergency service capability may vary by location and provider.",
          "MigraVoice is not a guaranteed substitute for regulated emergency or life-critical communications systems unless expressly contracted otherwise.",
        ],
      },
      {
        title: "3. Customer responsibility",
        bullets: [
          "Customers remain responsible for the scripts, prompts, routing logic, and communications content used in their voice workflows.",
          "Abusive robocalling, deceptive caller identification, unlawful lead generation, or prohibited telecom activity is forbidden.",
        ],
      },
    ],
  },
  {
    slug: "migramail",
    title: "MigraMail Service Terms",
    shortTitle: "MigraMail",
    category: "product",
    summary:
      "Product-specific usage and enforcement terms for sending reputation, anti-spam controls, deliverability, and mailbox operations.",
    description:
      "Addendum covering sender conduct, mailing limits, reputation protection, and enforcement for MigraMail services.",
    lastUpdated,
    version,
    appliesTo: [
      "MigraMail mailboxes, routing, and outbound sending systems",
      "Deliverability, sender reputation, and abuse prevention controls",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/acceptable-use", label: "Acceptable Use Policy" },
    ],
    sections: [
      {
        title: "1. Anti-spam and sender conduct",
        bullets: [
          "You may not use MigraMail for spam, phishing, deceptive headers, sender spoofing, or abusive bulk campaigns.",
          "Customers must maintain lawful consent and list hygiene for marketing or automated messages where required.",
        ],
      },
      {
        title: "2. Limits and reputation controls",
        bullets: [
          "MigraTeck may enforce sending limits, reputation thresholds, warm-up requirements, or verification steps to protect network health.",
          "Accounts that create blacklisting, complaint spikes, or abnormal abuse patterns may be throttled, suspended, or terminated.",
        ],
      },
      {
        title: "3. Customer responsibility",
        paragraphs: [
          "Customers are responsible for recipient targeting, message content, compliance with anti-spam laws, and the consequences of their sending behavior.",
        ],
      },
    ],
  },
  {
    slug: "migracredit",
    title: "MigraCredit Compliance Addendum",
    shortTitle: "MigraCredit",
    category: "product",
    summary:
      "Product-specific compliance disclaimers for credit, financing, or eligibility-related information surfaced through MigraCredit.",
    description:
      "Addendum clarifying informational-only positioning and excluding legal, tax, lending, or financial guarantees.",
    lastUpdated,
    version,
    appliesTo: [
      "MigraCredit informational and workflow surfaces",
      "Eligibility, compliance, or application-related guidance",
    ],
    relatedLinks: [
      { href: "/legal/terms", label: "Terms of Service" },
      { href: "/legal/privacy", label: "Privacy Policy" },
      { href: "/legal/payment", label: "Payment Policy" },
    ],
    sections: [
      {
        title: "1. Informational use only",
        paragraphs: [
          "MigraCredit may present workflow tools, eligibility information, or operational guidance, but does not provide legal, tax, accounting, or financial advice unless explicitly stated in a separate written agreement.",
        ],
      },
      {
        title: "2. No guarantee language",
        bullets: [
          "MigraTeck does not guarantee approval, funding, credit outcomes, regulatory status, or business eligibility.",
          "Any third-party lender, provider, or compliance process operates under its own terms and decision criteria.",
        ],
      },
      {
        title: "3. Customer responsibility",
        bullets: [
          "Customers remain responsible for validating all submitted information, legal obligations, and commercial decisions.",
          "MigraTeck may rely on customer-provided information and is not responsible for decisions based on inaccurate or incomplete submissions.",
        ],
      },
    ],
  },
];

export const legalDocumentsBySlug = new Map(
  legalDocuments.map((document) => [document.slug, document]),
);

export const canonicalLegalDocuments = legalDocuments.filter(
  (document) => legalAliases[document.slug] === undefined,
);

export const coreLegalDocuments = canonicalLegalDocuments.filter(
  (document) => document.category === "core",
);

export const productLegalDocuments = canonicalLegalDocuments.filter(
  (document) => document.category === "product",
);

export function resolveLegalSlug(slug: string): string {
  return legalAliases[slug] ?? slug;
}

export function getLegalDocument(slug: string): LegalDocument | null {
  return legalDocumentsBySlug.get(resolveLegalSlug(slug)) ?? null;
}

const productLegalSlugs = new Set([
  "migrahosting",
  "migravoice",
  "migramail",
]);

export function getProductLegalHref(productSlug: string): string | null {
  return productLegalSlugs.has(productSlug) ? `/legal/${productSlug}` : null;
}
