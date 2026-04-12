import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { assertRateLimit } from "@/lib/security/rate-limit";

const submitSchema = z.object({
  orgSlug: z.string().trim().min(2).max(120),
  formSlug: z.string().trim().min(2).max(120),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  company: z.string().trim().max(160).nullable().optional(),
  campaign: z.string().trim().max(160).nullable().optional(),
  landingPage: z.string().trim().max(240).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  smsConsent: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const limiter = await assertRateLimit({
    key: `migramarket-intake:${ip}`,
    action: "migramarket:intake:submit",
    maxAttempts: 40,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const organization = await prisma.organization.findUnique({
    where: { slug: parsed.data.orgSlug },
    select: { id: true, name: true },
  });

  if (!organization) {
    return NextResponse.json({ error: "Organization not found." }, { status: 404 });
  }

  const form = await prisma.migraMarketLeadCaptureForm.findFirst({
    where: {
      orgId: organization.id,
      slug: parsed.data.formSlug,
      active: true,
    },
  });

  if (!form) {
    return NextResponse.json({ error: "Lead form not found." }, { status: 404 });
  }

  const lead = await prisma.migraMarketLeadRecord.create({
    data: {
      orgId: organization.id,
      formId: form.id,
      fullName: parsed.data.fullName,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      company: parsed.data.company ?? null,
      sourceChannel: form.sourceChannel,
      campaign: parsed.data.campaign ?? null,
      landingPage: parsed.data.landingPage ?? null,
      status: "new",
      notes: parsed.data.notes ?? null,
      smsConsentStatus: form.smsConsentEnabled && parsed.data.smsConsent && parsed.data.phone ? "subscribed" : "unknown",
      smsConsentAt: form.smsConsentEnabled && parsed.data.smsConsent && parsed.data.phone ? new Date() : null,
      smsConsentSource: form.smsConsentEnabled && parsed.data.smsConsent && parsed.data.phone ? `form:${form.slug}` : null,
      smsConsentEvidence: form.smsConsentEnabled && parsed.data.smsConsent && parsed.data.phone
        ? form.smsConsentLabel || "Public form consent captured."
        : null,
      metadata: {
        capturedBy: "public_intake",
        ip,
        userAgent,
        smsConsent: Boolean(parsed.data.smsConsent),
      } as Prisma.InputJsonValue,
    },
  });

  await writeAuditLog({
    orgId: organization.id,
    action: "MIGRAMARKET_PUBLIC_LEAD_SUBMITTED",
    resourceType: "migramarket_lead",
    resourceId: lead.id,
    ip,
    userAgent,
    riskTier: 1,
    metadata: {
      formSlug: form.slug,
      sourceChannel: form.sourceChannel,
      email: lead.email,
    },
  });

  return NextResponse.json({
    ok: true,
    thankYouMessage: form.thankYouMessage || "Thanks, your request has been received.",
  }, { status: 201 });
}
