import { MembershipStatus, OrgRole } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { writeAuditLog } from "@/lib/audit";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { slugifyOrganizationName } from "@/lib/org";
import { getPlatformConfig } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertMutationSecurity } from "@/lib/security/mutation-guard";
import { OperatorRiskError } from "@/lib/security/operator-risk";
import { PlatformLockdownError } from "@/lib/security/platform-lockdown";
import { assertRateLimit } from "@/lib/security/rate-limit";

const createOrgSchema = z.object({
  name: z.string().min(2).max(120),
  isMigraHostingClient: z.boolean().optional().default(false),
});

export async function GET() {
  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }
  const { session } = authResult;

  const memberships = await prisma.membership.findMany({
    where: {
      userId: session.user.id,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: true,
    },
  });

  return NextResponse.json({ memberships });
}

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }
  const { session } = authResult;

  if (!session.user.emailVerified) {
    return NextResponse.json({ error: "Email verification required for organization creation." }, { status: 403 });
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  try {
    await assertMutationSecurity({
      action: "org:create",
      actorUserId: session.user.id,
      riskTier: 1,
      ip,
      userAgent,
      route: "/api/orgs",
    });
  } catch (error) {
    if (error instanceof PlatformLockdownError || error instanceof OperatorRiskError) {
      return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: error.httpStatus });
    }

    return NextResponse.json({ error: "Provisioning is temporarily unavailable." }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createOrgSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const limiter = await assertRateLimit({
    key: `${session.user.id}:${ip}`,
    action: "org:create",
    maxAttempts: 10,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const platformConfig = await getPlatformConfig();
  if (!platformConfig.allowOrgCreate) {
    const ownerMembership = await prisma.membership.findFirst({
      where: {
        userId: session.user.id,
        status: MembershipStatus.ACTIVE,
        role: OrgRole.OWNER,
      },
      select: { id: true },
    });

    if (!ownerMembership) {
      await writeAuditLog({
        userId: session.user.id,
        action: "AUTHZ_PERMISSION_DENIED",
        entityType: "permission",
        entityId: "org:create",
        ip,
        userAgent,
        metadata: {
          route: "/api/orgs",
          reason: "allowOrgCreate_false",
        },
      });

      return NextResponse.json({ error: "Organization creation is currently disabled." }, { status: 403 });
    }
  }

  const baseSlug = slugifyOrganizationName(parsed.data.name);
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

  const org = await prisma.$transaction(async (tx) => {
    const createdOrg = await tx.organization.create({
      data: {
        name: parsed.data.name,
        slug: candidateSlug,
        isMigraHostingClient: parsed.data.isMigraHostingClient,
        createdById: session.user.id,
      },
    });

    await tx.membership.create({
      data: {
        userId: session.user.id,
        orgId: createdOrg.id,
        role: OrgRole.OWNER,
      },
    });

    const existingUser = await tx.user.findUnique({ where: { id: session.user.id }, select: { defaultOrgId: true } });
    if (!existingUser?.defaultOrgId) {
      await tx.user.update({
        where: { id: session.user.id },
        data: { defaultOrgId: createdOrg.id },
      });
    }

    return createdOrg;
  });

  await writeAuditLog({
    userId: session.user.id,
    orgId: org.id,
    action: "ORG_CREATED",
    entityType: "organization",
    entityId: org.id,
    ip,
    userAgent,
  });

  const res = NextResponse.json({ org }, { status: 201 });
  res.cookies.set(ACTIVE_ORG_COOKIE, org.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return res;
}
