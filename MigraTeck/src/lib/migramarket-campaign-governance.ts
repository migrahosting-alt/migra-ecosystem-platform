import { Prisma } from "@prisma/client";
import { env } from "@/lib/env";
import { listToJson, normalizeStringList } from "@/lib/migramarket";
import { prisma } from "@/lib/prisma";

const DEFAULT_PUBLIC_ORIGIN = env.NEXTAUTH_URL || "https://migrateck.com";
const QUALITY_THRESHOLD = 8.5;

type PlatformKey = "facebook" | "instagram" | "linkedin" | "x" | "youtube";

type LoadedJob = NonNullable<Awaited<ReturnType<typeof loadJobForValidation>>>;
type LoadedCampaign = NonNullable<LoadedJob["brief"]>;

type ValidationContext = {
  job: LoadedJob;
  campaign: LoadedCampaign;
  asset: Awaited<ReturnType<typeof selectBestAssetForCampaign>>;
  caption: Awaited<ReturnType<typeof selectBestCaptionForCampaign>>;
  resolvedAssetUrl: string | null;
  resolvedPreviewUrl: string | null;
  resolvedDestinationUrl: string | null;
  ogSnapshot: {
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    twitterTitle: string | null;
    twitterDescription: string | null;
    twitterImage: string | null;
  } | null;
};

type ValidationReport = {
  campaign_match: boolean;
  asset_approved: boolean;
  platform_valid: boolean;
  dimensions_valid: boolean;
  caption_match: boolean;
  cta_match: boolean;
  landing_page_match: boolean;
  og_match: boolean;
  asset_blacklisted: boolean;
  brand_logo_match: boolean;
  quality_score: number;
  design_quality_score: number;
  final_status: "approved_for_publish" | "blocked";
  reasons: string[];
};

type SeedCampaignRecord = {
  key: string;
  name: string;
  brand: string;
  category: string;
  objective: string;
  offer: string;
  headline: string;
  subheadline: string;
  price?: string;
  cta: string;
  landingPage: string;
  channels: string[];
  visualFamily: string;
  visualStyle: string;
  approvedTemplateKeys: string[];
  disallowedAssetTags: string[];
  promptNotes: string;
  status: string;
};

type SeedTemplateRecord = {
  key: string;
  name: string;
  platform: PlatformKey;
  format: string;
  titleTemplate: string;
  captionTemplate: string;
  cta: string;
  width: number;
  height: number;
  styleFamily: string;
};

type SeedAssetRecord = {
  key: string;
  campaignKey: string;
  brand: string;
  category: string;
  offer: string;
  styleFamily: string;
  platformTargets: string[];
  width: number;
  height: number;
  aspectRatio: string;
  fileUrl: string;
  previewUrl?: string;
  landingPageIntent: string;
  qualityScore: number;
  tags: string[];
  templateKey: string;
  status: string;
};

type SeedCaptionRecord = {
  key: string;
  campaignKey: string;
  platform: PlatformKey;
  tone: string;
  body: string;
  cta: string;
  destinationUrl: string;
  useLinkPreview: boolean;
};

export const PLATFORM_DIMENSIONS: Record<PlatformKey, Array<{ width: number; height: number }>> = {
  linkedin: [
    { width: 1200, height: 628 },
    { width: 1200, height: 1500 },
  ],
  x: [
    { width: 1200, height: 628 },
    { width: 1200, height: 1500 },
    { width: 1600, height: 900 },
  ],
  facebook: [
    { width: 1200, height: 628 },
    { width: 1200, height: 1500 },
    { width: 1080, height: 1350 },
  ],
  instagram: [
    { width: 1080, height: 1350 },
    { width: 1080, height: 1080 },
    { width: 1080, height: 1920 },
  ],
  youtube: [{ width: 1280, height: 720 }],
};

const PRIORITY_CAMPAIGNS: SeedCampaignRecord[] = [
  {
    key: "website_48h_launch",
    name: "Website Live in 48 Hours",
    brand: "MigraHosting",
    category: "web_design",
    objective: "launch",
    offer: "Website live in 48 hours",
    headline: "Your Website. Live in 48 Hours.",
    subheadline: "Custom design, domain, business email, and SEO-ready launch support.",
    price: "$199",
    cta: "Launch today",
    landingPage: "https://migrahosting.com/services",
    channels: ["facebook", "instagram", "linkedin", "x", "youtube"],
    visualFamily: "premium_dark_neon_business",
    visualStyle:
      "Luxury modern tech ad, dark premium background, elegant purple-pink brand gradients, strong white typography, high contrast, polished business aesthetic, subtle glassmorphism, premium website/service promotion, conversion-focused layout, realistic professional scene, clean CTA placement, no clutter, no cheap stock feel, ad-ready for social media.",
    approvedTemplateKeys: [
      "website_offer_feed_portrait_v1",
      "website_offer_landscape_v1",
      "website_offer_instagram_v1",
      "website_offer_story_v1",
      "website_offer_youtube_v1",
    ],
    disallowedAssetTags: [
      "hosting",
      "hosting_pricing",
      "nvme",
      "server",
      "server_plan",
      "pricing",
      "generic_preview",
      "shared_hosting",
    ],
    promptNotes:
      "Use established, fast, premium, trustworthy, conversion-focused tone. Never use hosting-plan pricing cards for this campaign.",
    status: "approved",
  },
  {
    key: "hosting_email_bundle",
    name: "Hosting + Email Bundle",
    brand: "MigraHosting",
    category: "bundle",
    objective: "lead_gen",
    offer: "Hosting + business email bundle",
    headline: "Hosting + Business Email In One Bundle.",
    subheadline: "Managed hosting, reliable inboxes, and MigraTeck setup support for growing businesses.",
    cta: "See bundle options",
    landingPage: "https://migrahosting.com/services",
    channels: ["facebook", "instagram", "linkedin", "x"],
    visualFamily: "premium_dark_neon_business",
    visualStyle:
      "Premium infrastructure ad, dark navy background, crisp white typography, product UI glow, polished bundle presentation, high-trust enterprise feel.",
    approvedTemplateKeys: ["hosting_bundle_landscape_v1"],
    disallowedAssetTags: ["web_design_only", "generic_preview"],
    promptNotes:
      "Only use bundle creative that explicitly mentions hosting and email together. Do not cross this into website-launch ads.",
    status: "approved",
  },
  {
    key: "migrateck_enterprise_infrastructure",
    name: "MigraTeck Enterprise Infrastructure",
    brand: "MigraTeck",
    category: "infrastructure",
    objective: "awareness",
    offer: "Enterprise business technology infrastructure",
    headline: "Enterprise Infrastructure Without Enterprise Friction.",
    subheadline: "Modern cloud, communications, and workflow systems designed for serious operators.",
    cta: "Explore the platform",
    landingPage: "https://migrateck.com/platform",
    channels: ["linkedin", "x", "youtube", "facebook"],
    visualFamily: "premium_dark_neon_business",
    visualStyle:
      "Executive tech campaign visual, premium futuristic atmosphere, dark glass surfaces, bold typography, enterprise-grade polish, ecosystem branding.",
    approvedTemplateKeys: ["infrastructure_enterprise_landscape_v1"],
    disallowedAssetTags: ["hosting_pricing", "generic_preview"],
    promptNotes:
      "Keep this enterprise and ecosystem-led. No small-plan price cards and no generic consumer hosting presentation.",
    status: "approved",
  },
];

const PRIORITY_TEMPLATES: SeedTemplateRecord[] = [
  {
    key: "website_offer_feed_portrait_v1",
    name: "Website Offer Feed Portrait",
    platform: "facebook",
    format: "post",
    titleTemplate: "Website live in 48 hours",
    captionTemplate: "Website outcome + speed + trust + CTA",
    cta: "Launch today",
    width: 1200,
    height: 1500,
    styleFamily: "premium_dark_neon_business",
  },
  {
    key: "website_offer_landscape_v1",
    name: "Website Offer Landscape",
    platform: "linkedin",
    format: "post",
    titleTemplate: "Your Website. Live in 48 Hours.",
    captionTemplate: "Premium website launch offer for entrepreneurs and local businesses.",
    cta: "Launch today",
    width: 1200,
    height: 628,
    styleFamily: "premium_dark_neon_business",
  },
  {
    key: "website_offer_instagram_v1",
    name: "Website Offer Instagram Feed",
    platform: "instagram",
    format: "post",
    titleTemplate: "Website in 48 hours",
    captionTemplate: "Fast premium website launch creative for Instagram feed.",
    cta: "Launch today",
    width: 1080,
    height: 1350,
    styleFamily: "premium_dark_neon_business",
  },
  {
    key: "website_offer_story_v1",
    name: "Website Offer Story",
    platform: "instagram",
    format: "story",
    titleTemplate: "Launch today",
    captionTemplate: "Vertical story-safe website launch creative.",
    cta: "Launch today",
    width: 1080,
    height: 1920,
    styleFamily: "premium_dark_neon_business",
  },
  {
    key: "website_offer_youtube_v1",
    name: "Website Offer YouTube",
    platform: "youtube",
    format: "video",
    titleTemplate: "Website live in 48 hours",
    captionTemplate: "Thumbnail-safe website launch creative for YouTube.",
    cta: "Launch today",
    width: 1280,
    height: 720,
    styleFamily: "premium_dark_neon_business",
  },
  {
    key: "hosting_bundle_landscape_v1",
    name: "Hosting Bundle Landscape",
    platform: "facebook",
    format: "post",
    titleTemplate: "Hosting + email bundle",
    captionTemplate: "Managed hosting and business email bundle creative.",
    cta: "See bundle options",
    width: 1200,
    height: 628,
    styleFamily: "premium_dark_neon_business",
  },
  {
    key: "infrastructure_enterprise_landscape_v1",
    name: "Infrastructure Enterprise Landscape",
    platform: "linkedin",
    format: "post",
    titleTemplate: "Enterprise infrastructure",
    captionTemplate: "Executive-grade infrastructure promotion creative.",
    cta: "Explore the platform",
    width: 1200,
    height: 628,
    styleFamily: "premium_dark_neon_business",
  },
];

const PRIORITY_ASSETS: SeedAssetRecord[] = [
  {
    key: "website_offer_feed_portrait_v1",
    campaignKey: "website_48h_launch",
    brand: "MigraHosting",
    category: "web_design",
    offer: "Website live in 48 hours",
    styleFamily: "premium_dark_neon_business",
    platformTargets: ["facebook", "linkedin", "x"],
    width: 1200,
    height: 1500,
    aspectRatio: "4:5",
    fileUrl: "/content/marketing/assets/website_48h_launch/portrait/website-offer-feed-portrait-v1.svg",
    previewUrl: "/content/marketing/assets/website_48h_launch/portrait/website-offer-feed-portrait-v1.svg",
    landingPageIntent: "https://migrahosting.com/services",
    qualityScore: 9.2,
    tags: ["web_design", "approved", "launch_48h", "premium_dark_neon_business", "feed_portrait"],
    templateKey: "website_offer_feed_portrait_v1",
    status: "approved",
  },
  {
    key: "website_offer_landscape_v1",
    campaignKey: "website_48h_launch",
    brand: "MigraHosting",
    category: "web_design",
    offer: "Website live in 48 hours",
    styleFamily: "premium_dark_neon_business",
    platformTargets: ["facebook", "linkedin", "x"],
    width: 1200,
    height: 628,
    aspectRatio: "1.91:1",
    fileUrl: "/content/marketing/assets/website_48h_launch/landscape/website-offer-landscape-v1.svg",
    previewUrl: "/content/marketing/assets/website_48h_launch/landscape/website-offer-landscape-v1.svg",
    landingPageIntent: "https://migrahosting.com/services",
    qualityScore: 9.3,
    tags: ["web_design", "approved", "launch_48h", "premium_dark_neon_business", "landscape"],
    templateKey: "website_offer_landscape_v1",
    status: "approved",
  },
  {
    key: "website_offer_landscape_x_png_v1",
    campaignKey: "website_48h_launch",
    brand: "MigraHosting",
    category: "web_design",
    offer: "Website live in 48 hours",
    styleFamily: "premium_dark_neon_business",
    platformTargets: ["x"],
    width: 1200,
    height: 628,
    aspectRatio: "1.91:1",
    fileUrl: "/content/marketing/assets/migrahosting_social_pack/landscape/mh-website-launch-landscape-v1.png",
    previewUrl: "/content/marketing/assets/migrahosting_social_pack/landscape/mh-website-launch-landscape-v1.png",
    landingPageIntent: "https://migrahosting.com/services",
    qualityScore: 9.6,
    tags: ["web_design", "approved", "launch_48h", "premium_dark_neon_business", "landscape", "x_native_png"],
    templateKey: "website_offer_landscape_v1",
    status: "approved",
  },
  {
    key: "website_offer_instagram_v1",
    campaignKey: "website_48h_launch",
    brand: "MigraHosting",
    category: "web_design",
    offer: "Website live in 48 hours",
    styleFamily: "premium_dark_neon_business",
    platformTargets: ["instagram"],
    width: 1080,
    height: 1350,
    aspectRatio: "4:5",
    fileUrl: "/content/marketing/assets/website_48h_launch/instagram/website-offer-instagram-v1.svg",
    previewUrl: "/content/marketing/assets/website_48h_launch/instagram/website-offer-instagram-v1.svg",
    landingPageIntent: "https://migrahosting.com/services",
    qualityScore: 9.4,
    tags: ["web_design", "approved", "launch_48h", "premium_dark_neon_business", "instagram_feed"],
    templateKey: "website_offer_instagram_v1",
    status: "approved",
  },
  {
    key: "website_offer_story_v1",
    campaignKey: "website_48h_launch",
    brand: "MigraHosting",
    category: "web_design",
    offer: "Website live in 48 hours",
    styleFamily: "premium_dark_neon_business",
    platformTargets: ["instagram"],
    width: 1080,
    height: 1920,
    aspectRatio: "9:16",
    fileUrl: "/content/marketing/assets/website_48h_launch/story/website-offer-story-v1.svg",
    previewUrl: "/content/marketing/assets/website_48h_launch/story/website-offer-story-v1.svg",
    landingPageIntent: "https://migrahosting.com/services",
    qualityScore: 9.1,
    tags: ["web_design", "approved", "launch_48h", "premium_dark_neon_business", "story"],
    templateKey: "website_offer_story_v1",
    status: "approved",
  },
  {
    key: "website_offer_youtube_v1",
    campaignKey: "website_48h_launch",
    brand: "MigraHosting",
    category: "web_design",
    offer: "Website live in 48 hours",
    styleFamily: "premium_dark_neon_business",
    platformTargets: ["youtube"],
    width: 1280,
    height: 720,
    aspectRatio: "16:9",
    fileUrl: "/content/marketing/assets/website_48h_launch/youtube/website-offer-youtube-v1.svg",
    previewUrl: "/content/marketing/assets/website_48h_launch/youtube/website-offer-youtube-v1.svg",
    landingPageIntent: "https://migrahosting.com/services",
    qualityScore: 9.0,
    tags: ["web_design", "approved", "launch_48h", "premium_dark_neon_business", "youtube_thumbnail"],
    templateKey: "website_offer_youtube_v1",
    status: "approved",
  },
];

const PRIORITY_CAPTIONS: SeedCaptionRecord[] = [
  {
    key: "website_48h_launch_facebook_1",
    campaignKey: "website_48h_launch",
    platform: "facebook",
    tone: "premium_business",
    body:
      "Need a real business website without weeks of drag? MigraHosting can launch a custom site in 48 hours with domain setup, business email, and SEO-ready structure included.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: true,
  },
  {
    key: "website_48h_launch_instagram_1",
    campaignKey: "website_48h_launch",
    platform: "instagram",
    tone: "premium_business",
    body:
      "Your business deserves more than a placeholder page. We can launch a premium website in 48 hours with the essentials already built in.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: false,
  },
  {
    key: "website_48h_launch_linkedin_1",
    campaignKey: "website_48h_launch",
    platform: "linkedin",
    tone: "premium_business",
    body:
      "For small businesses that need speed without looking cheap: MigraHosting can launch a custom website in 48 hours with domain setup, business email, and SEO-ready delivery.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: true,
  },
  {
    key: "website_48h_launch_linkedin_2",
    campaignKey: "website_48h_launch",
    platform: "linkedin",
    tone: "premium_business",
    body:
      "A business website should not take weeks to start earning trust. MigraHosting can launch a polished site in 48 hours with domain setup, business email, and SEO-ready delivery built in.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: true,
  },
  {
    key: "website_48h_launch_linkedin_3",
    campaignKey: "website_48h_launch",
    platform: "linkedin",
    tone: "premium_business",
    body:
      "When small businesses need a credible online presence fast, speed matters. MigraHosting delivers a custom website in 48 hours with the essentials already aligned for launch.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: true,
  },
  {
    key: "website_48h_launch_x_1",
    campaignKey: "website_48h_launch",
    platform: "x",
    tone: "premium_business",
    body:
      "Need a real business site fast? MigraHosting can launch your website in 48 hours with domain setup, business email, and SEO-ready structure included.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: false,
  },
  {
    key: "website_48h_launch_x_2",
    campaignKey: "website_48h_launch",
    platform: "x",
    tone: "premium_business",
    body:
      "Still sending buyers to a weak or missing site? MigraHosting can get your business online in 48 hours with domain, email, and a premium structure ready to convert.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: false,
  },
  {
    key: "website_48h_launch_x_3",
    campaignKey: "website_48h_launch",
    platform: "x",
    tone: "premium_business",
    body:
      "Your website should help close trust gaps, not create them. We launch premium business sites in 48 hours with the setup serious brands need from day one.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: false,
  },
  {
    key: "website_48h_launch_youtube_1",
    campaignKey: "website_48h_launch",
    platform: "youtube",
    tone: "premium_business",
    body:
      "Launch a premium business website in 48 hours with MigraHosting. Custom design, domain setup, business email, and SEO-ready delivery are all part of the offer.",
    cta: "Launch today",
    destinationUrl: "https://migrahosting.com/services",
    useLinkPreview: true,
  },
];

function toJsonValue(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}

function normalizeText(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function normalizeUrl(input: string | null | undefined): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  try {
    const parsed = new URL(raw);
    parsed.hash = "";
    if (parsed.pathname !== "/" && parsed.pathname.endsWith("/")) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }
    parsed.searchParams.sort();
    return parsed.toString();
  } catch {
    return raw;
  }
}

function normalizeUrlPath(input: string | null | undefined): string {
  const raw = normalizeUrl(input);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function urlsMatch(left: string | null | undefined, right: string | null | undefined): boolean {
  const a = normalizeUrl(left);
  const b = normalizeUrl(right);
  if (!a || !b) return false;
  return a === b || normalizeUrlPath(a) === normalizeUrlPath(b);
}

function resolveJobUsageTimestamp(job: { publishedAt: Date | null; scheduledAt: Date | null; createdAt: Date }) {
  return (job.publishedAt || job.scheduledAt || job.createdAt).getTime();
}

function chooseLeastRecentlyUsedCandidate<T extends { id: string; createdAt: Date }>(
  candidates: Array<{ record: T; score: number }>,
  usageTimestampsById: Map<string, number>,
  maxScoreGap = 2,
) {
  if (!candidates.length) {
    return null;
  }

  const bestScore = Math.max(...candidates.map((entry) => entry.score));
  const rotationPool = candidates.filter((entry) => bestScore - entry.score <= maxScoreGap);
  const ranked = rotationPool.sort((left, right) => {
    const leftUsage = usageTimestampsById.get(left.record.id) ?? Number.NEGATIVE_INFINITY;
    const rightUsage = usageTimestampsById.get(right.record.id) ?? Number.NEGATIVE_INFINITY;
    if (leftUsage !== rightUsage) {
      return leftUsage - rightUsage;
    }
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.record.createdAt.getTime() - right.record.createdAt.getTime();
  });
  return ranked[0]?.record || null;
}

function resolveAbsoluteUrl(value: string | null | undefined, landingPage?: string | null): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const base = landingPage ? normalizeUrl(landingPage) : DEFAULT_PUBLIC_ORIGIN;
  if (!base) return raw;
  try {
    return new URL(raw, base).toString();
  } catch {
    return raw;
  }
}

function parseMeta(html: string, attr: "property" | "name", keys: string[]): string | null {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(
      `<meta[^>]+${attr}=(["'])${escaped}\\1[^>]+content=(["'])(.*?)\\2[^>]*>|<meta[^>]+content=(["'])(.*?)\\4[^>]+${attr}=(["'])${escaped}\\6[^>]*>`,
      "i",
    );
    const match = html.match(pattern);
    const value = match?.[3] || match?.[5];
    if (value) return value.trim();
  }
  return null;
}

function isAllowedPlatform(platform: string): platform is PlatformKey {
  return platform === "facebook" || platform === "instagram" || platform === "linkedin" || platform === "x" || platform === "youtube";
}

function validateDimensions(platform: string, width: number, height: number) {
  if (!isAllowedPlatform(platform)) {
    return false;
  }
  return PLATFORM_DIMENSIONS[platform].some((size) => size.width === width && size.height === height);
}

function buildReasons(report: Omit<ValidationReport, "reasons">): string[] {
  const reasons: string[] = [];
  if (!report.campaign_match) reasons.push("campaign_missing_or_inactive");
  if (!report.asset_approved) reasons.push("asset_not_approved");
  if (!report.platform_valid) reasons.push("asset_platform_mismatch");
  if (!report.dimensions_valid) reasons.push("asset_dimensions_invalid");
  if (!report.caption_match) reasons.push("caption_mismatch");
  if (!report.cta_match) reasons.push("cta_mismatch");
  if (!report.landing_page_match) reasons.push("landing_page_mismatch");
  if (!report.og_match) reasons.push("og_preview_mismatch");
  if (report.asset_blacklisted) reasons.push("asset_blacklisted");
  if (!report.brand_logo_match) reasons.push("brand_or_logo_mismatch");
  if (report.design_quality_score < QUALITY_THRESHOLD) reasons.push("design_quality_below_threshold");
  return reasons;
}

async function loadJobForValidation(orgId: string, jobId: string) {
  return prisma.migraMarketContentJob.findFirst({
    where: { id: jobId, orgId },
    include: {
      brief: true,
      connection: true,
      captionVariant: true,
      selectedAsset: true,
      validations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });
}

async function fetchOgSnapshot(orgId: string, url: string) {
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(10000) });
  const html = await response.text();
  const snapshot = {
    ogTitle: parseMeta(html, "property", ["og:title"]),
    ogDescription: parseMeta(html, "property", ["og:description"]),
    ogImage: parseMeta(html, "property", ["og:image"]),
    twitterTitle: parseMeta(html, "name", ["twitter:title"]),
    twitterDescription: parseMeta(html, "name", ["twitter:description"]),
    twitterImage: parseMeta(html, "name", ["twitter:image"]),
  };

  await prisma.migraMarketOgSnapshot.create({
    data: {
      orgId,
      url,
      ...snapshot,
    },
  });

  return snapshot;
}

async function selectBestAssetForCampaign(
  orgId: string,
  platform: string,
  campaign: LoadedCampaign,
  explicitAssetId?: string | null,
) {
  const disallowedTags = new Set(normalizeStringList(campaign.disallowedAssetTags).map((tag) => normalizeText(tag)));
  const hardBlockedWebsiteTags = new Set(["hosting", "hosting_pricing", "nvme", "server", "server_plan", "pricing", "shared_hosting"]);
  const websiteCategory = normalizeText(campaign.category) === "web_design";

  const isCampaignApprovedAsset = (asset: {
    brand: string;
    category: string;
    styleFamily: string | null;
    status: string;
    qualityScore: number | null;
    campaignKeys: Prisma.JsonValue;
    platformTargets: Prisma.JsonValue;
    tags: Prisma.JsonValue;
    blacklistForCampaigns: Prisma.JsonValue | null;
  }) => {
    const tags = normalizeStringList(asset.tags).map((tag) => normalizeText(tag));
    const campaignKeys = normalizeStringList(asset.campaignKeys);
    const platformTargets = normalizeStringList(asset.platformTargets);
    const blacklistForCampaigns = normalizeStringList(asset.blacklistForCampaigns);
    const hasBlockedTag =
      tags.some((tag) => disallowedTags.has(tag)) || (websiteCategory && tags.some((tag) => hardBlockedWebsiteTags.has(tag)));
    const blacklistedForCampaign =
      blacklistForCampaigns.includes(campaign.campaignKey || "") || blacklistForCampaigns.includes(campaign.category);

    return (
      asset.status === "approved" &&
      normalizeText(asset.brand) === normalizeText(campaign.brand) &&
      normalizeText(asset.category) === normalizeText(campaign.category) &&
      campaignKeys.some((key) => key === (campaign.campaignKey || "") || key === campaign.id) &&
      platformTargets.includes(platform) &&
      !hasBlockedTag &&
      !blacklistedForCampaign &&
      (asset.qualityScore || 0) >= QUALITY_THRESHOLD &&
      (!campaign.visualFamily || (asset.styleFamily || "") === campaign.visualFamily)
    );
  };

  if (explicitAssetId) {
    const explicit = await prisma.migraMarketContentAsset.findFirst({
      where: { id: explicitAssetId, orgId },
    });
    if (explicit && isCampaignApprovedAsset(explicit)) return explicit;
  }

  const candidates = await prisma.migraMarketContentAsset.findMany({
    where: {
      orgId,
      status: "approved",
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const scored = candidates
    .filter((asset) => isCampaignApprovedAsset(asset))
    .map((asset) => {
      const campaignKeys = normalizeStringList(asset.campaignKeys);

      let score = 0;
      if (campaignKeys.includes(campaign.campaignKey || "") || campaignKeys.includes(campaign.id)) score += 50;
      if (urlsMatch(asset.landingPageIntent, campaign.landingPage)) score += 10;
      if ((asset.styleFamily || "") === (campaign.visualFamily || "")) score += 10;
      score += Math.max(0, Math.round((asset.qualityScore || 0) * 10));

      return { asset, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (!scored.length) {
    return null;
  }

  const usageRows = await prisma.migraMarketContentJob.findMany({
    where: {
      orgId,
      briefId: campaign.id,
      platform,
      selectedAssetId: { in: scored.map((entry) => entry.asset.id) },
    },
    select: {
      selectedAssetId: true,
      publishedAt: true,
      scheduledAt: true,
      createdAt: true,
    },
  });

  const usageTimestampsById = new Map<string, number>();
  for (const row of usageRows) {
    if (!row.selectedAssetId) continue;
    const timestamp = resolveJobUsageTimestamp(row);
    usageTimestampsById.set(row.selectedAssetId, Math.max(usageTimestampsById.get(row.selectedAssetId) ?? 0, timestamp));
  }

  return (
    chooseLeastRecentlyUsedCandidate(
      scored.map((entry) => ({ record: entry.asset, score: entry.score })),
      usageTimestampsById,
    ) || scored[0]?.asset || null
  );
}

async function selectBestCaptionForCampaign(
  orgId: string,
  platform: string,
  campaignId: string,
  explicitCaptionId?: string | null,
) {
  if (explicitCaptionId) {
    const explicit = await prisma.migraMarketContentCaption.findFirst({
      where: { id: explicitCaptionId, orgId },
    });
    if (explicit) return explicit;
  }

  const candidates = await prisma.migraMarketContentCaption.findMany({
    where: {
      orgId,
      briefId: campaignId,
      platform,
      status: "approved",
    },
    orderBy: [{ createdAt: "asc" }, { updatedAt: "asc" }],
  });

  if (!candidates.length) {
    return null;
  }

  const usageRows = await prisma.migraMarketContentJob.findMany({
    where: {
      orgId,
      briefId: campaignId,
      platform,
      captionId: { in: candidates.map((candidate) => candidate.id) },
    },
    select: {
      captionId: true,
      publishedAt: true,
      scheduledAt: true,
      createdAt: true,
    },
  });

  const usageTimestampsById = new Map<string, number>();
  for (const row of usageRows) {
    if (!row.captionId) continue;
    const timestamp = resolveJobUsageTimestamp(row);
    usageTimestampsById.set(row.captionId, Math.max(usageTimestampsById.get(row.captionId) ?? 0, timestamp));
  }

  return (
    chooseLeastRecentlyUsedCandidate(
      candidates.map((candidate) => ({ record: candidate, score: 0 })),
      usageTimestampsById,
      0,
    ) || candidates[0]
  );
}

function validateCampaignAlignment(context: ValidationContext): ValidationReport {
  const { job, campaign, asset, caption, resolvedAssetUrl, resolvedPreviewUrl, resolvedDestinationUrl, ogSnapshot } = context;
  const linkPreviewEnabled = job.platform === "x" ? false : job.useLinkPreview;
  const disallowedTags = new Set(normalizeStringList(campaign.disallowedAssetTags));
  const assetTags = normalizeStringList(asset?.tags);
  const assetPlatforms = normalizeStringList(asset?.platformTargets);
  const blacklistForCampaigns = normalizeStringList(asset?.blacklistForCampaigns);
  const captionBody = String(caption?.body || "").trim();
  const captionCta = String(caption?.cta || "").trim();
  const jobCaption = String(job.caption || "").trim();
  const reportBase = {
    campaign_match:
      Boolean(campaign.active) &&
      campaign.status === "approved" &&
      normalizeStringList(campaign.channels).includes(job.platform) &&
      Boolean(campaign.id === job.briefId),
    asset_approved: Boolean(asset && asset.status === "approved"),
    platform_valid: Boolean(asset && assetPlatforms.includes(job.platform)),
    dimensions_valid: Boolean(asset && validateDimensions(job.platform, asset.width, asset.height)),
    caption_match: jobCaption ? normalizeText(jobCaption) === normalizeText(captionBody) : Boolean(captionBody),
    cta_match: caption ? normalizeText(campaign.cta) === normalizeText(captionCta) : false,
    landing_page_match: urlsMatch(resolvedDestinationUrl, campaign.landingPage),
    og_match:
      !linkPreviewEnabled ||
      !campaign.requireOgMatch ||
      !resolvedDestinationUrl ||
      !ogSnapshot
        ? true
        : Boolean(
            (normalizeText(ogSnapshot.ogTitle).includes(normalizeText(campaign.headline || campaign.offer)) ||
              normalizeText(ogSnapshot.twitterTitle).includes(normalizeText(campaign.headline || campaign.offer))) &&
              (normalizeText(ogSnapshot.ogDescription).includes(normalizeText(campaign.subheadline || campaign.offer)) ||
                normalizeText(ogSnapshot.twitterDescription).includes(normalizeText(campaign.subheadline || campaign.offer))) &&
              (urlsMatch(ogSnapshot.ogImage, resolvedPreviewUrl || resolvedAssetUrl) ||
                urlsMatch(ogSnapshot.twitterImage, resolvedPreviewUrl || resolvedAssetUrl))
          ),
    asset_blacklisted:
      assetTags.some((tag) => disallowedTags.has(tag)) ||
      blacklistForCampaigns.includes(campaign.campaignKey || "") ||
      blacklistForCampaigns.includes(campaign.category),
    brand_logo_match: Boolean(asset && normalizeText(asset.brand) === normalizeText(campaign.brand)),
    quality_score: asset?.qualityScore || 0,
    design_quality_score: asset?.qualityScore || 0,
    final_status: "blocked" as const,
  };

  const report: ValidationReport = {
    ...reportBase,
    final_status:
      reportBase.campaign_match &&
      reportBase.asset_approved &&
      reportBase.platform_valid &&
      reportBase.dimensions_valid &&
      reportBase.caption_match &&
      reportBase.cta_match &&
      reportBase.landing_page_match &&
      reportBase.og_match &&
      !reportBase.asset_blacklisted &&
      reportBase.brand_logo_match &&
      reportBase.design_quality_score >= QUALITY_THRESHOLD
        ? "approved_for_publish"
        : "blocked",
    reasons: [],
  };

  report.reasons = buildReasons(report);
  return report;
}

export async function ensureMigraMarketCampaignGovernance(orgId: string) {
  const campaignMap = new Map<string, string>();

  for (const campaign of PRIORITY_CAMPAIGNS) {
    const saved = await prisma.migraMarketCreativeBrief.upsert({
      where: {
        orgId_campaignKey: {
          orgId,
          campaignKey: campaign.key,
        },
      },
      update: {
        name: campaign.name,
        brand: campaign.brand,
        category: campaign.category,
        objective: campaign.objective,
        offer: campaign.offer,
        headline: campaign.headline,
        subheadline: campaign.subheadline,
        price: campaign.price || null,
        cta: campaign.cta,
        landingPage: campaign.landingPage,
        channels: listToJson(campaign.channels),
        visualFamily: campaign.visualFamily,
        visualStyle: campaign.visualStyle,
        approvedTemplateKeys: listToJson(campaign.approvedTemplateKeys),
        disallowedAssetTags: listToJson(campaign.disallowedAssetTags),
        requireOgMatch: true,
        active: true,
        promptNotes: campaign.promptNotes,
        status: campaign.status,
      },
      create: {
        orgId,
        campaignKey: campaign.key,
        name: campaign.name,
        brand: campaign.brand,
        category: campaign.category,
        objective: campaign.objective,
        offer: campaign.offer,
        headline: campaign.headline,
        subheadline: campaign.subheadline,
        price: campaign.price || null,
        cta: campaign.cta,
        landingPage: campaign.landingPage,
        channels: listToJson(campaign.channels),
        visualFamily: campaign.visualFamily,
        visualStyle: campaign.visualStyle,
        approvedTemplateKeys: listToJson(campaign.approvedTemplateKeys),
        disallowedAssetTags: listToJson(campaign.disallowedAssetTags),
        requireOgMatch: true,
        active: true,
        promptNotes: campaign.promptNotes,
        status: campaign.status,
      },
    });

    campaignMap.set(campaign.key, saved.id);
  }

  for (const template of PRIORITY_TEMPLATES) {
    await prisma.migraMarketContentTemplate.upsert({
      where: {
        orgId_templateKey: {
          orgId,
          templateKey: template.key,
        },
      },
      update: {
        name: template.name,
        platform: template.platform,
        format: template.format,
        cadence: "weekly",
        publishMode: "api",
        titleTemplate: template.titleTemplate,
        captionTemplate: template.captionTemplate,
        aiPromptTemplate: null,
        cta: template.cta,
        width: template.width,
        height: template.height,
        styleFamily: template.styleFamily,
        logoRequired: true,
        ctaRequired: true,
        maxHeadlineChars: 38,
        maxSubheadlineChars: 70,
        maxBullets: 4,
        safeZones: toJsonValue({
          headline: "top_safe",
          cta: "bottom_safe",
          logo: "corner_safe",
        }),
        status: "approved",
      },
      create: {
        orgId,
        templateKey: template.key,
        name: template.name,
        platform: template.platform,
        format: template.format,
        cadence: "weekly",
        publishMode: "api",
        titleTemplate: template.titleTemplate,
        captionTemplate: template.captionTemplate,
        aiPromptTemplate: null,
        cta: template.cta,
        width: template.width,
        height: template.height,
        styleFamily: template.styleFamily,
        logoRequired: true,
        ctaRequired: true,
        maxHeadlineChars: 38,
        maxSubheadlineChars: 70,
        maxBullets: 4,
        safeZones: toJsonValue({
          headline: "top_safe",
          cta: "bottom_safe",
          logo: "corner_safe",
        }),
        hashtags: listToJson([]),
        diversityChecklist: listToJson([]),
        status: "approved",
      },
    });
  }

  for (const asset of PRIORITY_ASSETS) {
    await prisma.migraMarketContentAsset.upsert({
      where: {
        orgId_assetKey: {
          orgId,
          assetKey: asset.key,
        },
      },
      update: {
        brand: asset.brand,
        category: asset.category,
        offer: asset.offer,
        styleFamily: asset.styleFamily,
        platformTargets: listToJson(asset.platformTargets),
        width: asset.width,
        height: asset.height,
        aspectRatio: asset.aspectRatio,
        fileUrl: asset.fileUrl,
        previewUrl: asset.previewUrl || null,
        landingPageIntent: asset.landingPageIntent,
        status: asset.status,
        qualityScore: asset.qualityScore,
        tags: listToJson(asset.tags),
        campaignKeys: listToJson([asset.campaignKey]),
        templateKey: asset.templateKey,
        blacklistForCampaigns: listToJson([]),
      },
      create: {
        orgId,
        assetKey: asset.key,
        brand: asset.brand,
        category: asset.category,
        offer: asset.offer,
        styleFamily: asset.styleFamily,
        platformTargets: listToJson(asset.platformTargets),
        width: asset.width,
        height: asset.height,
        aspectRatio: asset.aspectRatio,
        fileUrl: asset.fileUrl,
        previewUrl: asset.previewUrl || null,
        landingPageIntent: asset.landingPageIntent,
        status: asset.status,
        qualityScore: asset.qualityScore,
        tags: listToJson(asset.tags),
        campaignKeys: listToJson([asset.campaignKey]),
        templateKey: asset.templateKey,
        blacklistForCampaigns: listToJson([]),
      },
    });
  }

  for (const caption of PRIORITY_CAPTIONS) {
    const briefId = campaignMap.get(caption.campaignKey);
    if (!briefId) continue;

    await prisma.migraMarketContentCaption.upsert({
      where: {
        orgId_captionKey: {
          orgId,
          captionKey: caption.key,
        },
      },
      update: {
        briefId,
        platform: caption.platform,
        tone: caption.tone,
        body: caption.body,
        cta: caption.cta,
        destinationUrl: caption.destinationUrl,
        useLinkPreview: caption.useLinkPreview,
        status: "approved",
      },
      create: {
        orgId,
        briefId,
        captionKey: caption.key,
        platform: caption.platform,
        tone: caption.tone,
        body: caption.body,
        cta: caption.cta,
        destinationUrl: caption.destinationUrl,
        useLinkPreview: caption.useLinkPreview,
        status: "approved",
      },
    });
  }
}

export async function validateSocialJobForOrg(orgId: string, jobId: string) {
  await ensureMigraMarketCampaignGovernance(orgId);

  const loadedJob = await loadJobForValidation(orgId, jobId);
  if (!loadedJob) {
    throw new Error("Content job not found.");
  }
  if (!loadedJob.brief) {
    throw new Error("Campaign is required before this content can be scheduled or published.");
  }

  const job: LoadedJob = loadedJob;
  const campaign: LoadedCampaign = loadedJob.brief;
  const asset = await selectBestAssetForCampaign(orgId, job.platform, campaign, job.selectedAssetId);
  const caption = await selectBestCaptionForCampaign(orgId, job.platform, campaign.id, job.captionId);
  const enforcedUseLinkPreview = job.platform === "x" ? false : caption?.useLinkPreview ?? job.useLinkPreview;
  const resolvedDestinationUrl = normalizeUrl(caption?.destinationUrl || job.destinationUrl || campaign.landingPage);
  const resolvedAssetUrl = resolveAbsoluteUrl(asset?.fileUrl, campaign.landingPage);
  const resolvedPreviewUrl = resolveAbsoluteUrl(asset?.previewUrl || asset?.fileUrl, campaign.landingPage);
  const ogSnapshot =
    enforcedUseLinkPreview && resolvedDestinationUrl && campaign.requireOgMatch
      ? await fetchOgSnapshot(orgId, resolvedDestinationUrl).catch(() => null)
      : null;

  const report = validateCampaignAlignment({
    job,
    campaign,
    asset,
    caption,
    resolvedAssetUrl,
    resolvedPreviewUrl,
    resolvedDestinationUrl,
    ogSnapshot,
  });

  const validation = await prisma.migraMarketPublishValidation.create({
    data: {
      orgId,
      jobId: job.id,
      briefId: campaign.id,
      assetId: asset?.id || null,
      captionId: caption?.id || null,
      platform: job.platform,
      campaignMatch: report.campaign_match,
      assetApproved: report.asset_approved,
      platformValid: report.platform_valid,
      dimensionsValid: report.dimensions_valid,
      captionMatch: report.caption_match,
      ctaMatch: report.cta_match,
      landingPageMatch: report.landing_page_match,
      ogMatch: report.og_match,
      assetBlacklisted: report.asset_blacklisted,
      brandLogoMatch: report.brand_logo_match,
      qualityScore: report.quality_score,
      designQualityScore: report.design_quality_score,
      finalStatus: report.final_status,
      rawReport: toJsonValue({
        reasons: report.reasons,
        destinationUrl: resolvedDestinationUrl,
        assetUrl: resolvedAssetUrl,
        previewUrl: resolvedPreviewUrl,
        ogSnapshot,
      }),
    },
  });

  const updatedJob = await prisma.migraMarketContentJob.update({
    where: { id: job.id },
    data: {
      captionId: caption?.id || null,
      selectedAssetId: asset?.id || null,
      destinationUrl: resolvedDestinationUrl,
      useLinkPreview: enforcedUseLinkPreview,
      caption: caption?.body || job.caption,
      assetUrls: resolvedAssetUrl ? listToJson([resolvedAssetUrl]) : job.assetUrls ?? Prisma.JsonNull,
      thumbnailUrl: resolvedPreviewUrl || job.thumbnailUrl,
      validationStatus: report.final_status,
    },
    include: {
      brief: true,
      connection: true,
      captionVariant: true,
      selectedAsset: true,
      validations: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  return {
    job: updatedJob,
    campaign,
    asset,
    caption,
    validation,
    report,
    ogSnapshot,
  };
}
