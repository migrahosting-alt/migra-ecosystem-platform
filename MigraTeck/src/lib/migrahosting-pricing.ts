export type MigraHostingVpsPlan = {
  slug: string;
  name: string;
  monthlyPriceCents: number;
  annualPriceCents: number;
  annualEquivalentMonthlyCents: number;
  vcpu: number;
  memoryGb: number;
  storageGb: number;
  supportLabel: string;
  badge?: string;
  highlighted?: boolean;
  highlights: string[];
};

export type MigraHostingBillingCycle = "monthly" | "yearly";

export const MIGRAHOSTING_VPS_PLANS: MigraHostingVpsPlan[] = [
  {
    slug: "vps-1",
    name: "VPS 1",
    monthlyPriceCents: 399,
    annualPriceCents: 3972,
    annualEquivalentMonthlyCents: 331,
    vcpu: 2,
    memoryGb: 4,
    storageGb: 80,
    supportLabel: "DDoS protection",
    highlights: ["2 vCPU cores", "4 GB RAM", "80 GB NVMe storage", "Full root access", "DDoS protection"],
  },
  {
    slug: "vps-2",
    name: "VPS 2",
    monthlyPriceCents: 699,
    annualPriceCents: 6960,
    annualEquivalentMonthlyCents: 580,
    vcpu: 4,
    memoryGb: 8,
    storageGb: 160,
    supportLabel: "Priority support",
    badge: "Most Popular",
    highlighted: true,
    highlights: ["4 vCPU cores", "8 GB RAM", "160 GB NVMe storage", "Full root access", "Priority support"],
  },
  {
    slug: "vps-3",
    name: "VPS 3",
    monthlyPriceCents: 1199,
    annualPriceCents: 11940,
    annualEquivalentMonthlyCents: 995,
    vcpu: 8,
    memoryGb: 16,
    storageGb: 320,
    supportLabel: "24/7 phone support",
    highlights: ["8 vCPU cores", "16 GB RAM", "320 GB NVMe storage", "Full root access", "24/7 phone support"],
  },
  {
    slug: "vps-4",
    name: "VPS 4",
    monthlyPriceCents: 1999,
    annualPriceCents: 19908,
    annualEquivalentMonthlyCents: 1659,
    vcpu: 12,
    memoryGb: 24,
    storageGb: 480,
    supportLabel: "Priority support",
    highlights: ["12 vCPU cores", "24 GB RAM", "480 GB NVMe storage", "Dedicated resources", "Priority support"],
  },
  {
    slug: "vps-5",
    name: "VPS 5",
    monthlyPriceCents: 2999,
    annualPriceCents: 29868,
    annualEquivalentMonthlyCents: 2489,
    vcpu: 16,
    memoryGb: 32,
    storageGb: 640,
    supportLabel: "Priority support",
    highlights: ["16 vCPU cores", "32 GB RAM", "640 GB NVMe storage", "Dedicated resources", "Priority support"],
  },
  {
    slug: "vps-6",
    name: "VPS 6",
    monthlyPriceCents: 3999,
    annualPriceCents: 39828,
    annualEquivalentMonthlyCents: 3319,
    vcpu: 24,
    memoryGb: 48,
    storageGb: 960,
    supportLabel: "Priority support",
    highlights: ["24 vCPU cores", "48 GB RAM", "960 GB NVMe storage", "Dedicated resources", "Priority support"],
  },
];

export const MIGRAHOSTING_PRICING_POSITIONING = {
  eyebrow: "Dedicated VPS",
  title: "Dedicated resources only.",
  description:
    "MigraHosting sells dedicated VPS capacity with full root access. We do not offer shared hosting, shared VPS pools, or a separate cloud-plan ladder right now.",
  footnote:
    "Cloud plans are intentionally omitted until they represent a distinct product from the dedicated VPS range.",
};

export function getMigraHostingVpsPlan(planSlug: string | null | undefined): MigraHostingVpsPlan | undefined {
  if (!planSlug) {
    return undefined;
  }

  return MIGRAHOSTING_VPS_PLANS.find((plan) => plan.slug === planSlug);
}

export function buildMigraHostingRequestAccessHref(
  planSlug?: string,
  billingCycle?: MigraHostingBillingCycle,
): string {
  const params = new URLSearchParams({ product: "migrahosting" });

  if (planSlug) {
    params.set("plan", planSlug);
  }

  if (billingCycle) {
    params.set("billing", billingCycle);
  }

  return `/request-access?${params.toString()}`;
}