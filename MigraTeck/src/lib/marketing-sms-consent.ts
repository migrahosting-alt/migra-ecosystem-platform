import { Prisma } from "@prisma/client";
import { normalizeUsPhoneNumber } from "@/lib/migramarket-messaging";
import { prisma } from "@/lib/prisma";

const MARKETING_ORG_SLUG = "migrahosting-admin";

type CaptureMarketingSmsConsentInput = {
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  sourceChannel: string;
  consentLabel: string;
  consentSource: string;
  ip: string | null;
  userAgent: string | null;
  notes?: string | null;
};

function mergeTags(existing: Prisma.JsonValue | null, next: string[]) {
  const current = Array.isArray(existing)
    ? existing.filter((item): item is string => typeof item === "string")
    : [];

  return JSON.parse(JSON.stringify(Array.from(new Set([...current, ...next])))) as Prisma.InputJsonValue;
}

export async function captureMarketingSmsConsent(input: CaptureMarketingSmsConsentInput) {
  if (!input.phone) {
    return { captured: false as const, reason: "phone_missing" };
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizeUsPhoneNumber(input.phone);
  } catch {
    return { captured: false as const, reason: "phone_invalid" };
  }

  const org = await prisma.organization.findUnique({
    where: { slug: MARKETING_ORG_SLUG },
    select: { id: true },
  });

  if (!org) {
    return { captured: false as const, reason: "org_missing" };
  }

  const normalizedEmail = input.email?.trim().toLowerCase() || null;
  const existing = await prisma.migraMarketLeadRecord.findFirst({
    where: {
      orgId: org.id,
      OR: [
        { phone: normalizedPhone },
        ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  const metadata = {
    ...(existing?.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {}),
    capturedBy: "shared_website_form",
    ip: input.ip,
    userAgent: input.userAgent,
    consentSource: input.consentSource,
  } as Prisma.InputJsonValue;

  const data = {
    fullName: input.fullName,
    email: normalizedEmail,
    phone: normalizedPhone,
    company: input.company,
    sourceChannel: input.sourceChannel,
    status: "new",
    notes: input.notes ?? null,
    smsConsentStatus: "subscribed",
    smsConsentAt: new Date(),
    smsConsentSource: input.consentSource,
    smsConsentEvidence: input.consentLabel,
    smsOptedOutAt: null,
    messagingTags: mergeTags(existing?.messagingTags || null, ["marketing-subscribers", input.sourceChannel]),
    metadata,
  } satisfies Partial<Prisma.MigraMarketLeadRecordUncheckedCreateInput>;

  if (existing) {
    const updated = await prisma.migraMarketLeadRecord.update({
      where: { id: existing.id },
      data: {
        ...data,
        smsConsentAt: existing.smsConsentAt || new Date(),
      },
    });

    return { captured: true as const, leadId: updated.id, created: false as const };
  }

  const created = await prisma.migraMarketLeadRecord.create({
    data: {
      orgId: org.id,
      ...data,
    },
  });

  return { captured: true as const, leadId: created.id, created: true as const };
}
