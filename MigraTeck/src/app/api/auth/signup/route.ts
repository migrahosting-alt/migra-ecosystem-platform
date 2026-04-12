import { OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ensureStarterMigraDriveForOrg } from "@/lib/auth/migradrive-registration";
import { writeAuditLog } from "@/lib/audit";
import { authAllowRegistration, env } from "@/lib/env";
import { captureMarketingSmsConsent } from "@/lib/marketing-sms-consent";
import { sendMail } from "@/lib/mail";
import { slugifyOrganizationName } from "@/lib/org";
import { normalizeUsPhoneNumber } from "@/lib/phone";
import { getPlatformConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { hashPassword, validatePasswordComplexity } from "@/lib/security/password";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { generateToken, hashToken } from "@/lib/tokens";

const signupSchema = z.object({
  name: z.string().min(2).max(80),
  email: z.string().email(),
  password: z.string().min(10).max(256),
  organizationName: z.string().min(2).max(120),
  phone: z.string().trim().max(40).nullable().optional(),
  smsMarketingConsent: z.boolean().optional().default(false),
}).superRefine((value, context) => {
  if (value.smsMarketingConsent && !value.phone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phone"],
      message: "Phone number is required when SMS consent is enabled.",
    });
  }
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }
  const body = await request.json().catch(() => null);

  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid signup payload." }, { status: 400 });
  }

  const complexityError = validatePasswordComplexity(parsed.data.password);
  if (complexityError) {
    return NextResponse.json({ error: complexityError }, { status: 400 });
  }

  let normalizedPhone: string | null = null;
  if (parsed.data.phone) {
    try {
      normalizedPhone = normalizeUsPhoneNumber(parsed.data.phone);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid phone number." }, { status: 400 });
    }
  }

  const limiter = await assertRateLimit({
    key: `${parsed.data.email.toLowerCase()}:${ip}`,
    action: "auth:signup",
    maxAttempts: 5,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Too many signup attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const platformConfig = await getPlatformConfig();
  if (platformConfig.maintenanceMode) {
    await writeAuditLog({
      action: "AUTH_SIGNUP_DISABLED",
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        reason: "maintenance_mode",
        email: parsed.data.email.toLowerCase(),
      },
    });

    return NextResponse.json(
      { error: "Provisioning is temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }

  if (platformConfig.freezeProvisioning) {
    await writeAuditLog({
      action: "AUTH_SIGNUP_DISABLED",
      ip,
      userAgent,
      riskTier: 1,
      metadata: {
        reason: "freeze_provisioning",
        email: parsed.data.email.toLowerCase(),
      },
    });

    return NextResponse.json(
      { error: "Organization onboarding is currently unavailable. Request access from platform operations." },
      { status: 423 },
    );
  }

  if (!platformConfig.allowPublicSignup) {
    await writeAuditLog({
      action: "AUTH_SIGNUP_DISABLED",
      ip,
      userAgent,
      metadata: {
        reason: "allowPublicSignup_false",
        email: parsed.data.email.toLowerCase(),
      },
    });

    return NextResponse.json(
      { error: "Public signup is currently disabled. Request access from platform operations." },
      { status: 403 },
    );
  }

  if (!authAllowRegistration) {
    return NextResponse.json(
      { error: "Registration is disabled." },
      { status: 403 },
    );
  }

  if (!platformConfig.allowOrgCreate) {
    await writeAuditLog({
      action: "AUTH_SIGNUP_DISABLED",
      ip,
      userAgent,
      metadata: {
        reason: "allowOrgCreate_false",
        email: parsed.data.email.toLowerCase(),
      },
    });

    return NextResponse.json(
      { error: "Organization onboarding is currently unavailable. Request access from platform operations." },
      { status: 403 },
    );
  }

  const existing = await prisma.user.findFirst({
    where: {
      OR: [
        { email: parsed.data.email.toLowerCase() },
        ...(normalizedPhone ? [{ phoneE164: normalizedPhone }] : []),
      ],
    },
    select: { id: true },
  });

  if (existing) {
    await writeAuditLog({
      action: "AUTH_SIGNUP_DUPLICATE_ATTEMPT",
      userId: existing.id,
      ip,
      userAgent,
    });

    return NextResponse.json({
      message: "If this email is eligible, account setup instructions will be sent.",
    });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const baseSlug = slugifyOrganizationName(parsed.data.organizationName);
  let candidateSlug = baseSlug;
  let suffix = 1;

  while (true) {
    const exists = await prisma.organization.findUnique({ where: { slug: candidateSlug }, select: { id: true } });
    if (!exists) {
      break;
    }

    suffix += 1;
    candidateSlug = `${baseSlug}-${suffix}`;
  }

  const user = await prisma.$transaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email.toLowerCase(),
        phoneE164: normalizedPhone,
        passwordHash,
      },
    });

    const org = await tx.organization.create({
      data: {
        name: parsed.data.organizationName,
        slug: candidateSlug,
        createdById: createdUser.id,
      },
    });

    await tx.membership.create({
      data: {
        userId: createdUser.id,
        orgId: org.id,
        role: OrgRole.OWNER,
      },
    });

    await tx.user.update({
      where: { id: createdUser.id },
      data: { defaultOrgId: org.id },
    });

    return { ...createdUser, orgId: org.id };
  });

  const driveBootstrap = await ensureStarterMigraDriveForOrg({
    orgId: user.orgId,
    orgSlug: candidateSlug,
  });

  const token = generateToken();
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.emailVerificationToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt,
    },
  });

  const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
  const verifyUrl = `${baseUrl}/verify-email?token=${token}`;

  await sendMail({
    to: parsed.data.email.toLowerCase(),
    subject: "Verify your MigraTeck account",
    text: `Verify your account: ${verifyUrl}`,
    html: `<p>Welcome to MigraTeck.</p><p><a href="${verifyUrl}">Verify your email</a></p>`,
  });

  await writeAuditLog({
    userId: user.id,
    orgId: user.orgId,
    action: "AUTH_SIGNUP",
    ip,
    userAgent,
    metadata: {
      phone: parsed.data.phone || null,
      authPhone: normalizedPhone,
      smsMarketingConsent: parsed.data.smsMarketingConsent,
    },
  });

  if (parsed.data.smsMarketingConsent && parsed.data.phone) {
    await captureMarketingSmsConsent({
      fullName: parsed.data.name,
      email: parsed.data.email.toLowerCase(),
      phone: parsed.data.phone,
      company: parsed.data.organizationName,
      sourceChannel: "signup",
      consentLabel:
        "I agree to receive SMS and MMS marketing messages, updates, and offers from MigraHosting. Consent is not a condition of purchase. Message frequency may vary. Message and data rates may apply. Reply STOP to opt out and HELP for help. Questions: admin@migrahosting.com.",
      consentSource: "website:signup",
      ip,
      userAgent,
      notes: "Signup form SMS opt-in",
    });
  }

  return NextResponse.json({
    ok: true,
    message: "If this email is eligible, account setup instructions will be sent.",
    data: {
      user: {
        id: user.id,
        email: parsed.data.email.toLowerCase(),
        fullName: parsed.data.name,
      },
      organization: {
        id: user.orgId,
        slug: candidateSlug,
        name: parsed.data.organizationName,
      },
      tenant: {
        tenantId: driveBootstrap.tenant.id,
        status: driveBootstrap.tenant.status,
        planCode: driveBootstrap.tenant.planCode,
        storageQuotaGb: driveBootstrap.tenant.storageQuotaGb,
      },
      verificationRequired: true,
    },
  });
}
