import { OrgRole } from "@prisma/client";
import type { SignupResponseData } from "@migrateck/api-contracts";
import { writeAuditLog } from "@migrateck/audit-core";
import { emitPlatformEvent, recordSecurityEvent } from "@migrateck/events";
import { ensureStarterMigraDriveForOrg } from "@/lib/auth/migradrive-registration";
import { authAllowRegistration, env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { slugifyOrganizationName } from "@/lib/org";
import { getPlatformConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/security/password";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { generateToken, hashToken } from "@/lib/tokens";
import { AuthCoreError } from "../errors";
import { validateEnterprisePassword } from "./password-policy";

export async function signupWithOrganization(input: {
  displayName: string;
  email: string;
  password: string;
  organizationName: string;
  ip: string;
  userAgent: string;
}): Promise<{ created: boolean; data: SignupResponseData }> {
  const email = input.email.toLowerCase();
  const passwordError = validateEnterprisePassword(input.password);
  if (passwordError) {
    throw new AuthCoreError("WEAK_PASSWORD", passwordError, 400);
  }

  const limiter = await assertRateLimit({
    key: `${email}:${input.ip}`,
    action: "auth:v1:signup",
    maxAttempts: 5,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    throw new AuthCoreError("RATE_LIMITED", "Too many signup attempts. Try again later.", 429);
  }

  const platformConfig = await getPlatformConfig();
  if (platformConfig.maintenanceMode) {
    throw new AuthCoreError("MAINTENANCE_MODE", "Provisioning is temporarily unavailable. Please try again later.", 503);
  }
  if (platformConfig.freezeProvisioning) {
    throw new AuthCoreError("PROVISIONING_FROZEN", "Organization onboarding is currently unavailable.", 423);
  }
  if (!platformConfig.allowPublicSignup || !authAllowRegistration) {
    throw new AuthCoreError("PUBLIC_SIGNUP_DISABLED", "Public signup is currently disabled.", 403);
  }
  if (!platformConfig.allowOrgCreate) {
    throw new AuthCoreError("ORG_CREATE_DISABLED", "Organization onboarding is currently unavailable.", 403);
  }

  const existing = await prisma.user.findFirst({
    where: { email },
    select: { id: true },
  });

  if (existing) {
    await writeAuditLog({
      action: "AUTH_SIGNUP_DUPLICATE_ATTEMPT",
      userId: existing.id,
      ip: input.ip,
      userAgent: input.userAgent,
    });

    return {
      created: false,
      data: {
        created: false,
        verificationRequired: true,
        message: "If this email is eligible, account setup instructions will be sent.",
        user: null,
        organization: null,
      },
    };
  }

  const passwordHash = await hashPassword(input.password);
  const baseSlug = slugifyOrganizationName(input.organizationName);
  let candidateSlug = baseSlug;
  let suffix = 1;

  while (true) {
    const slugExists = await prisma.organization.findUnique({
      where: { slug: candidateSlug },
      select: { id: true },
    });
    if (!slugExists) {
      break;
    }
    suffix += 1;
    candidateSlug = `${baseSlug}-${suffix}`;
  }

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: input.displayName,
        email,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });

    const organization = await tx.organization.create({
      data: {
        name: input.organizationName,
        slug: candidateSlug,
        createdById: user.id,
      },
      select: {
        id: true,
        name: true,
        slug: true,
      },
    });

    await tx.membership.create({
      data: {
        userId: user.id,
        orgId: organization.id,
        role: OrgRole.OWNER,
      },
    });

    await tx.user.update({
      where: { id: user.id },
      data: {
        defaultOrgId: organization.id,
      },
    });

    return { user, organization };
  });

  await ensureStarterMigraDriveForOrg({
    orgId: created.organization.id,
    orgSlug: created.organization.slug,
  });

  const token = generateToken();
  await prisma.emailVerificationToken.create({
    data: {
      userId: created.user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });

  const verifyBaseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
  const verifyUrl = `${verifyBaseUrl}/verify-email?token=${token}`;
  await sendMail({
    to: email,
    subject: "Verify your MigraTeck account",
    text: `Verify your account: ${verifyUrl}`,
    html: `<p>Welcome to MigraTeck.</p><p><a href="${verifyUrl}">Verify your email</a></p>`,
  });

  await writeAuditLog({
    userId: created.user.id,
    orgId: created.organization.id,
    action: "AUTH_SIGNUP",
    ip: input.ip,
    userAgent: input.userAgent,
  });

  await recordSecurityEvent({
    userId: created.user.id,
    orgId: created.organization.id,
    eventType: "USER_SIGNED_UP",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await recordSecurityEvent({
    userId: created.user.id,
    orgId: created.organization.id,
    eventType: "EMAIL_VERIFICATION_SENT",
    ip: input.ip,
    userAgent: input.userAgent,
  });
  await emitPlatformEvent({
    eventType: "user.registered",
    source: "auth-core.signup",
    orgId: created.organization.id,
    actorId: created.user.id,
    entityType: "User",
    entityId: created.user.id,
  });

  return {
    created: true,
    data: {
      created: true,
      verificationRequired: true,
      message: "Account created. Check your email to verify your account.",
      user: {
        id: created.user.id,
        email: created.user.email,
        displayName: created.user.name ?? null,
        status: "PENDING_VERIFICATION",
      },
      organization: created.organization,
    },
  };
}

export async function resendVerification(input: {
  email: string;
  ip: string;
  userAgent: string;
}): Promise<{ message: string }> {
  const email = input.email.toLowerCase();
  const limiter = await assertRateLimit({
    key: `${email}:${input.ip}`,
    action: "auth:v1:resend-verification",
    maxAttempts: 5,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    throw new AuthCoreError("RATE_LIMITED", "Too many resend attempts. Try again later.", 429);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerified: true },
  });

  if (user && !user.emailVerified && user.email) {
    const token = generateToken();
    await prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const verifyBaseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
    const verifyUrl = `${verifyBaseUrl}/verify-email?token=${token}`;
    await sendMail({
      to: user.email,
      subject: "Verify your MigraTeck account",
      text: `Verify your account: ${verifyUrl}`,
      html: `<p><a href="${verifyUrl}">Verify your email</a></p>`,
    });
    await recordSecurityEvent({
      userId: user.id,
      eventType: "EMAIL_VERIFICATION_SENT",
      ip: input.ip,
      userAgent: input.userAgent,
    });
  }

  return {
    message: "If this email is registered and unverified, a new verification link has been sent.",
  };
}