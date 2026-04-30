/**
 * Builds a mailto: href for service inquiries.
 *
 * Centralised here so:
 *  - every inquiry lands on services@migrateck.com (single destination)
 *  - every email body carries a Source: line (attribution — tells you which
 *    page generated the lead without needing analytics click-tracking)
 *  - subject lines are consistent and easy to filter server-side
 */

const INQUIRY_EMAIL = "services@migrateck.com";

export interface InquiryParams {
  /** Short label that appears in the email subject, e.g. "Starter Launch" */
  plan: string;
  /** Source page/context, e.g. "Pricing", "Services", "Platform", "Product — MigraHosting" */
  source: string;
  /** Optional starter body lines appended after the source attribution block */
  bodyLines?: string[];
}

export function buildInquiryHref({ plan, source, bodyLines = [] }: InquiryParams): string {
  const subject = `Inquiry — ${plan}`;

  const body = [
    `Hi,`,
    ``,
    `I'm interested in: ${plan}`,
    ``,
    `---`,
    `Source: ${source}`,
    `---`,
    ``,
    ...bodyLines,
  ].join("\n");

  return `mailto:${INQUIRY_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Pre-built inquiry hrefs for each named plan on /pricing */
export const pricingInquiries = {
  starterLaunch: buildInquiryHref({
    plan: "Starter Launch ($599)",
    source: "Pricing",
    bodyLines: ["Business name:", "Website goal:", "Desired timeline:"],
  }),
  businessLaunch: buildInquiryHref({
    plan: "Business Launch ($899)",
    source: "Pricing",
    bodyLines: ["Business name:", "Website goal:", "Desired timeline:"],
  }),
  scaleLaunch: buildInquiryHref({
    plan: "Scale Launch ($1,499)",
    source: "Pricing",
    bodyLines: ["Business name:", "Website goal:", "Desired timeline:"],
  }),
  aiContentEngine: buildInquiryHref({
    plan: "AI Content Engine ($350/mo)",
    source: "Pricing",
    bodyLines: ["Business name:", "Current content needs:", "Monthly publishing goal:"],
  }),
  contentOpsPlus: buildInquiryHref({
    plan: "Content Ops Plus ($700/mo)",
    source: "Pricing",
    bodyLines: ["Business name:", "Current content needs:", "Monthly publishing goal:"],
  }),
  customScope: buildInquiryHref({
    plan: "Custom Commercial Scope",
    source: "Pricing",
    bodyLines: ["Business name:", "Project type:", "Budget range:", "Timeline:"],
  }),
  generalPricing: buildInquiryHref({
    plan: "General Project",
    source: "Pricing",
    bodyLines: ["Business name:", "Project type:", "Budget range:", "Timeline:"],
  }),
};

export const serviceInquiries = {
  websiteLaunch: buildInquiryHref({
    plan: "48-Hour Website Launch",
    source: "Services",
    bodyLines: ["Business name:", "Current website situation:", "Desired timeline:"],
  }),
  aiContentGenerator: buildInquiryHref({
    plan: "AI Content Generator",
    source: "Services",
    bodyLines: ["Business name:", "Publishing goals:", "Current content situation:"],
  }),
  general: buildInquiryHref({
    plan: "General Inquiry",
    source: "Services",
    bodyLines: ["Business name:", "Service interested in:", "Project context:", "Timeline:"],
  }),
};

export const platformInquiry = buildInquiryHref({
  plan: "Platform / Custom Scope",
  source: "Platform",
  bodyLines: ["Business name:", "Platform needs:", "Current stack:", "Timeline:"],
});

export const homeInquiry = buildInquiryHref({
  plan: "General Inquiry",
  source: "Home",
  bodyLines: ["Business name:", "What you are looking for:"],
});
