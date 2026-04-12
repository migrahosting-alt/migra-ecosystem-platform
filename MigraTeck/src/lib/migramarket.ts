import { Prisma } from "@prisma/client";
import { ensureMigraMarketCampaignGovernance } from "@/lib/migramarket-campaign-governance";
import { prisma } from "@/lib/prisma";

const DEFAULT_CHECKLIST = [
  {
    key: "intake-collected",
    title: "Collect business intake",
    description: "Capture services, locations, target markets, offers, and primary goals.",
    sortOrder: 10,
  },
  {
    key: "access-collected",
    title: "Collect account access",
    description: "Request Google Business Profile, website, social, and analytics access.",
    sortOrder: 20,
  },
  {
    key: "tracking-configured",
    title: "Configure tracking",
    description: "Confirm call, form, and campaign attribution are measurable.",
    sortOrder: 30,
  },
  {
    key: "first-calendar-approved",
    title: "Approve first campaign calendar",
    description: "Lock the first social, email, and local visibility deliverables.",
    sortOrder: 40,
  },
  {
    key: "baseline-report-ready",
    title: "Publish baseline report",
    description: "Create the starting KPI snapshot for monthly comparisons.",
    sortOrder: 50,
  },
] as const;

const DEFAULT_PACKAGE_TEMPLATES = [
  {
    code: "GOOGLE_PRESENCE",
    name: "Google Presence Setup",
    description: "One-time setup for Google Business Profile, local visibility baseline, and tracking foundations.",
    monthlyPrice: null,
    setupPrice: 950,
    serviceBundle: ["google_business_profile", "citation_baseline", "tracking_setup"],
    defaultTasks: [
      { title: "Optimize Google Business Profile", category: "google", priority: "high" },
      { title: "Establish citation baseline", category: "seo", priority: "normal" },
      { title: "Configure call and form tracking", category: "analytics", priority: "high" },
    ],
  },
  {
    code: "LOCAL_VISIBILITY",
    name: "Local Visibility Retainer",
    description: "Monthly local SEO, review growth, profile posting, and performance reporting.",
    monthlyPrice: 650,
    setupPrice: 500,
    serviceBundle: ["google_posts", "review_growth", "local_seo", "monthly_reporting"],
    defaultTasks: [
      { title: "Prepare monthly Google post set", category: "google", priority: "normal" },
      { title: "Run review generation follow-up", category: "reputation", priority: "high" },
      { title: "Update local SEO targets", category: "seo", priority: "normal" },
    ],
  },
  {
    code: "SOCIAL_EMAIL",
    name: "Social + Email Retainer",
    description: "Recurring social publishing and email campaigns for retention and nurture.",
    monthlyPrice: 900,
    setupPrice: 650,
    serviceBundle: ["social_calendar", "social_publishing", "email_campaigns", "audience_segmentation"],
    defaultTasks: [
      { title: "Draft monthly social calendar", category: "social", priority: "high" },
      { title: "Prepare email campaign", category: "email", priority: "normal" },
      { title: "Review audience segmentation", category: "email", priority: "normal" },
    ],
  },
  {
    code: "FULL_GROWTH_ENGINE",
    name: "Full Growth Engine",
    description: "Full-service growth operations combining Google, content, email, paid acquisition, and reporting.",
    monthlyPrice: 2200,
    setupPrice: 1200,
    serviceBundle: ["google", "seo", "social", "email", "paid_ads", "reporting", "lead_ops"],
    defaultTasks: [
      { title: "Run monthly growth strategy review", category: "strategy", priority: "high" },
      { title: "Optimize paid acquisition campaigns", category: "ads", priority: "high" },
      { title: "Publish executive KPI report", category: "reporting", priority: "normal" },
    ],
  },
] as const;

type DefaultTask = {
  title: string;
  category: string;
  priority: string;
};

type PackageTemplateSerializable = {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string;
  monthlyPrice: number | null;
  setupPrice: number | null;
  serviceBundle: Prisma.JsonValue | null;
  defaultTasks: Prisma.JsonValue | null;
  createdAt: Date;
  updatedAt: Date;
};

function parseDefaultTasks(value: Prisma.JsonValue | null | undefined): DefaultTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        title: String(record.title || "").trim(),
        category: String(record.category || "fulfillment").trim(),
        priority: String(record.priority || "normal").trim(),
      };
    })
    .filter((item) => item.title);
}

export function normalizeStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

export function listToJson(values: string[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(values)) as Prisma.InputJsonValue;
}

export async function ensureMigraMarketPackageTemplates() {
  await Promise.all(
    DEFAULT_PACKAGE_TEMPLATES.map((template) =>
      prisma.migraMarketPackageTemplate.upsert({
        where: { code: template.code },
        update: {
          name: template.name,
          description: template.description,
          monthlyPrice: template.monthlyPrice,
          setupPrice: template.setupPrice,
          serviceBundle: JSON.parse(JSON.stringify(template.serviceBundle)) as Prisma.InputJsonValue,
          defaultTasks: JSON.parse(JSON.stringify(template.defaultTasks)) as Prisma.InputJsonValue,
        },
        create: {
          code: template.code,
          name: template.name,
          description: template.description,
          monthlyPrice: template.monthlyPrice,
          setupPrice: template.setupPrice,
          serviceBundle: JSON.parse(JSON.stringify(template.serviceBundle)) as Prisma.InputJsonValue,
          defaultTasks: JSON.parse(JSON.stringify(template.defaultTasks)) as Prisma.InputJsonValue,
        },
      }),
    ),
  );
}

async function ensureDefaultLeadForms(orgId: string) {
  await Promise.all([
    prisma.migraMarketLeadCaptureForm.upsert({
      where: {
        orgId_slug: {
          orgId,
          slug: "primary-intake",
        },
      },
      update: {},
      create: {
        orgId,
        name: "Primary Intake",
        slug: "primary-intake",
        sourceChannel: "website",
        thankYouMessage: "Thanks, your request has been received.",
        active: true,
      },
    }),
    prisma.migraMarketLeadCaptureForm.upsert({
      where: {
        orgId_slug: {
          orgId,
          slug: "migravoice-signup",
        },
      },
      update: {
        sourceChannel: "migravoice",
        smsConsentEnabled: true,
        smsConsentLabel:
          "I agree to receive optional SMS and MMS marketing messages, updates, and offers from MigraVoice. Message frequency may vary. Message and data rates may apply. Reply STOP to opt out and HELP for help. Consent is not a condition of purchase.",
      },
      create: {
        orgId,
        name: "MigraVoice Signup",
        slug: "migravoice-signup",
        sourceChannel: "migravoice",
        thankYouMessage: "Thanks, your request has been received.",
        smsConsentEnabled: true,
        smsConsentLabel:
          "I agree to receive optional SMS and MMS marketing messages, updates, and offers from MigraVoice. Message frequency may vary. Message and data rates may apply. Reply STOP to opt out and HELP for help. Consent is not a condition of purchase.",
        active: true,
      },
    }),
  ]);
}

export async function applyPackageTemplateToOrg(orgId: string, templateId: string) {
  await ensureMigraMarketPackageTemplates();

  const template = await prisma.migraMarketPackageTemplate.findUnique({
    where: { id: templateId },
  });

  if (!template) {
    return null;
  }

  await prisma.migraMarketAccount.upsert({
    where: { orgId },
    update: {
      packageTemplateId: template.id,
      packageName: template.name,
    },
    create: {
      orgId,
      packageTemplateId: template.id,
      packageName: template.name,
    },
  });

  const existingTasks = await prisma.migraMarketTask.findMany({
    where: { orgId },
    select: { title: true },
  });
  const existingTitles = new Set(existingTasks.map((task) => task.title));
  const tasksToCreate = parseDefaultTasks(template.defaultTasks).filter((task) => !existingTitles.has(task.title));

  if (tasksToCreate.length > 0) {
    await prisma.migraMarketTask.createMany({
      data: tasksToCreate.map((task) => ({
        orgId,
        title: task.title,
        category: task.category,
        priority: task.priority,
      })),
    });
  }

  return template;
}

export async function ensureMigraMarketWorkspace(orgId: string) {
  await ensureMigraMarketPackageTemplates();
  await ensureMigraMarketCampaignGovernance(orgId);

  const account = await prisma.migraMarketAccount.upsert({
    where: { orgId },
    update: {},
    create: { orgId },
  });

  await Promise.all(
    DEFAULT_CHECKLIST.map((item) =>
      prisma.migraMarketChecklistItem.upsert({
        where: {
          orgId_key: {
            orgId,
            key: item.key,
          },
        },
        update: {},
        create: {
          orgId,
          key: item.key,
          title: item.title,
          description: item.description,
          sortOrder: item.sortOrder,
        },
      }),
    ),
  );

  await ensureDefaultLeadForms(orgId);

  const taskCount = await prisma.migraMarketTask.count({ where: { orgId } });
  if (taskCount === 0) {
    await prisma.migraMarketTask.createMany({
      data: [
        {
          orgId,
          title: "Run MigraMarket kickoff audit",
          category: "onboarding",
          priority: "high",
        },
        {
          orgId,
          title: "Prepare first 30-day growth plan",
          category: "strategy",
          priority: "high",
        },
      ],
    });
  }

  const templateCount = await prisma.migraMarketContentTemplate.count({ where: { orgId } });
  if (templateCount === 0) {
    const seededTemplates = await Promise.all([
      prisma.migraMarketContentTemplate.create({
        data: {
          orgId,
          name: "Founder Reel Hook",
          platform: "instagram",
          format: "reel",
          cadence: "weekly",
          publishMode: "api",
          titleTemplate: "Founder reel: [offer or lesson]",
          captionTemplate:
            "Here is the real story behind [offer]. We built this for [audience]. Reply [keyword] if you want the same result.",
          aiPromptTemplate:
            "Create a photorealistic short-form marketing visual of a diverse founder-led team in action. Include Black, white, Asian, Latino, and women-led representation across the weekly set. Keep it realistic, premium, and business-focused. Do not add a TikTok watermark or baked-in logo.",
          cta: "Reply or click to book",
          hashtags: listToJson(["founderstory", "smallbusiness", "growth"]),
          diversityChecklist: listToJson([
            "Rotate Black, white, Asian, and Latino representation across the sequence",
            "Include women-led and mixed-team scenes",
            "Avoid repetitive stock-photo poses",
          ]),
        },
      }),
      prisma.migraMarketContentTemplate.create({
        data: {
          orgId,
          name: "Offer Carousel",
          platform: "facebook",
          format: "carousel",
          cadence: "weekly",
          publishMode: "api",
          titleTemplate: "Offer carousel: [offer name]",
          captionTemplate:
            "Swipe through to see what is included in [offer]. Built for [audience]. Powered by MigraTeck.",
          aiPromptTemplate:
            "Design a premium photorealistic marketing carousel for a service offer. Show diverse professionals and business owners with balanced Black, white, Asian, Latino, and women-led representation. Clean, high-trust commercial style.",
          cta: "Tap to learn more",
          hashtags: listToJson(["offer", "businessgrowth", "migrateck"]),
          diversityChecklist: listToJson([
            "Use inclusive casting across slides",
            "Mix age ranges and team roles",
          ]),
        },
      }),
      prisma.migraMarketContentTemplate.create({
        data: {
          orgId,
          name: "Authority Post",
          platform: "linkedin",
          format: "post",
          cadence: "weekly",
          publishMode: "api",
          titleTemplate: "Authority post: [topic]",
          captionTemplate:
            "If you are building [business type], here is what actually moves growth right now: [3 points]. Powered by MigraTeck.",
          aiPromptTemplate:
            "Create a photorealistic executive-quality social image for LinkedIn showing a diverse leadership team in a modern business environment. Balanced racial representation and visible women leadership. No exaggerated AI artifacts.",
          cta: "Comment for the checklist",
          hashtags: listToJson(["leadership", "growthops", "digitalinfrastructure"]),
          diversityChecklist: listToJson([
            "Show leadership diversity",
            "Avoid single-demographic boardroom scenes",
          ]),
        },
      }),
      prisma.migraMarketContentTemplate.create({
        data: {
          orgId,
          name: "Short-Form Promo",
          platform: "youtube",
          format: "short",
          cadence: "weekly",
          publishMode: "api",
          titleTemplate: "YouTube Short: [hook]",
          captionTemplate:
            "[hook]. This is how MigraTeck helps businesses launch faster and grow smarter. Powered by MigraTeck.",
          aiPromptTemplate:
            "Create a realistic high-energy promo concept for a vertical short video with diverse entrepreneurs, creators, and operators. Balanced Black, white, Asian, Latino, and women-led representation.",
          cta: "Watch and subscribe",
          hashtags: listToJson(["shorts", "businesstech", "poweredbymigrateck"]),
          diversityChecklist: listToJson([
            "Vary creator and founder representation",
            "Keep scenes realistic and modern",
          ]),
        },
      }),
    ]);

    const slotCount = await prisma.migraMarketContentCalendarSlot.count({ where: { orgId } });
    if (slotCount === 0) {
      await prisma.migraMarketContentCalendarSlot.createMany({
        data: [
          {
            orgId,
            templateId: seededTemplates[0].id,
            title: "Monday founder reel",
            platform: "instagram",
            format: "reel",
            publishMode: "api",
            weekday: 1,
            slotTime: "09:30",
            status: "planned",
            theme: "Founder story",
            cta: "Reply for details",
            assetChecklist: listToJson(["Vertical video", "Caption", "Thumbnail hook"]),
          },
          {
            orgId,
            templateId: seededTemplates[2].id,
            title: "Tuesday authority post",
            platform: "linkedin",
            format: "post",
            publishMode: "api",
            weekday: 2,
            slotTime: "11:00",
            status: "planned",
            theme: "Expert insight",
            cta: "Comment for the checklist",
            assetChecklist: listToJson(["Square image", "Caption", "CTA comment prompt"]),
          },
          {
            orgId,
            templateId: seededTemplates[1].id,
            title: "Wednesday offer carousel",
            platform: "facebook",
            format: "carousel",
            publishMode: "api",
            weekday: 3,
            slotTime: "13:00",
            status: "planned",
            theme: "Product offer",
            cta: "Tap to learn more",
            assetChecklist: listToJson(["Carousel slides", "Caption", "Landing link"]),
          },
          {
            orgId,
            templateId: seededTemplates[3].id,
            title: "Thursday promo short",
            platform: "youtube",
            format: "short",
            publishMode: "api",
            weekday: 4,
            slotTime: "12:00",
            status: "planned",
            theme: "Promo video",
            cta: "Watch and subscribe",
            assetChecklist: listToJson(["Vertical video", "Title", "Description"]),
          },
          {
            orgId,
            templateId: seededTemplates[0].id,
            title: "Friday TikTok promo",
            platform: "tiktok",
            format: "video",
            publishMode: "api",
            weekday: 5,
            slotTime: "15:30",
            status: "planned",
            theme: "Short-form promo",
            cta: "Comment for pricing",
            assetChecklist: listToJson(["Vertical video", "Caption", "Trend-safe edit"]),
          },
        ],
      });
    }
  }

  return account;
}

export async function getMigraMarketWorkspace(orgId: string) {
  await ensureMigraMarketWorkspace(orgId);

  const [account, locations, checklist, tasks, reports, packageTemplates, leadForms, leads, messagingCampaigns, recentDeliveries, socialConnections, creativeBriefs, contentJobs, contentTemplates, calendarSlots] =
    await Promise.all([
    prisma.migraMarketAccount.findUnique({
      where: { orgId },
      include: {
        packageTemplate: true,
      },
    }),
    prisma.migraMarketLocation.findMany({
      where: { orgId },
      orderBy: [{ primary: "desc" }, { createdAt: "asc" }],
    }),
    prisma.migraMarketChecklistItem.findMany({
      where: { orgId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
    prisma.migraMarketTask.findMany({
      where: { orgId },
      orderBy: [{ priority: "asc" }, { dueAt: "asc" }, { createdAt: "asc" }],
    }),
    prisma.migraMarketReportSnapshot.findMany({
      where: { orgId },
      orderBy: [{ periodEnd: "desc" }, { createdAt: "desc" }],
      take: 6,
    }),
    prisma.migraMarketPackageTemplate.findMany({
      orderBy: [{ monthlyPrice: "asc" }, { setupPrice: "asc" }, { createdAt: "asc" }],
    }),
    prisma.migraMarketLeadCaptureForm.findMany({
      where: { orgId },
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
    }),
    prisma.migraMarketLeadRecord.findMany({
      where: { orgId },
      orderBy: [{ createdAt: "desc" }],
      take: 25,
      include: {
        form: true,
      },
    }),
    prisma.migraMarketMessagingCampaign.findMany({
      where: { orgId },
      orderBy: [{ createdAt: "desc" }],
      take: 12,
    }),
    prisma.migraMarketMessagingDelivery.findMany({
      where: { orgId },
      orderBy: [{ createdAt: "desc" }],
      take: 25,
      include: {
        campaign: true,
        lead: true,
      },
    }),
    prisma.migraMarketSocialConnection.findMany({
      where: { orgId },
      orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
    }),
    prisma.migraMarketCreativeBrief.findMany({
      where: { orgId },
      orderBy: [{ createdAt: "desc" }],
      take: 12,
    }),
    prisma.migraMarketContentJob.findMany({
      where: { orgId },
      orderBy: [{ scheduledAt: "asc" }, { createdAt: "desc" }],
      take: 20,
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
    }),
    prisma.migraMarketContentTemplate.findMany({
      where: { orgId },
      orderBy: [{ platform: "asc" }, { createdAt: "asc" }],
      take: 24,
    }),
    prisma.migraMarketContentCalendarSlot.findMany({
      where: { orgId },
      orderBy: [{ weekday: "asc" }, { slotTime: "asc" }, { createdAt: "asc" }],
      take: 28,
      include: {
        template: true,
        connection: true,
      },
    }),
  ]);

  return {
    account,
    locations,
    checklist,
    tasks,
    reports,
    packageTemplates,
    leadForms,
    leads,
    messagingCampaigns,
    recentDeliveries,
    socialConnections,
    creativeBriefs,
    contentJobs,
    contentTemplates,
    calendarSlots,
  };
}

export function serializePackageTemplate(template: PackageTemplateSerializable) {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    category: template.category,
    monthlyPrice: template.monthlyPrice,
    setupPrice: template.setupPrice,
    serviceBundle: normalizeStringList(template.serviceBundle),
    defaultTasks: parseDefaultTasks(template.defaultTasks),
    createdAt: template.createdAt.toISOString(),
    updatedAt: template.updatedAt.toISOString(),
  };
}
