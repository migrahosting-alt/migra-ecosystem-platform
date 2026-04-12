import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { requireApiSession } from "@/lib/auth/api-auth";
import { SESSION_COOKIE_NAMES } from "@/lib/auth/session-cookie";
import { ACTIVE_ORG_COOKIE } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { hashPassword, validatePasswordComplexity, verifyPassword } from "@/lib/security/password";
import { assertRateLimit } from "@/lib/security/rate-limit";

const schema = z
  .object({
    currentPassword: z.string().min(8).max(256),
    newPassword: z.string().min(10).max(256),
    confirmPassword: z.string().min(10).max(256),
  })
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Passwords do not match.",
        path: ["confirmPassword"],
      });
    }

    if (value.currentPassword === value.newPassword) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Choose a new password that is different from the current password.",
        path: ["newPassword"],
      });
    }
  });

export const dynamic = "force-dynamic";

function jsonNoStore(payload: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(headers || {}),
    },
  });
}

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const auth = await requireApiSession();
  if (!auth.ok) {
    return auth.response;
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);

  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid payload." }, 400);
  }

  const limiter = await assertRateLimit({
    key: `${auth.session.user.id}:${ip}`,
    action: "auth:change-password",
    maxAttempts: 5,
    windowSeconds: 30 * 60,
  });

  if (!limiter.ok) {
    await writeAuditLog({
      userId: auth.session.user.id,
      action: "AUTH_PASSWORD_CHANGE_RATE_LIMITED",
      ip,
      userAgent,
      metadata: {
        retryAfterSeconds: limiter.retryAfterSeconds,
      },
    });

    return jsonNoStore(
      { error: "Too many password change attempts. Try again later." },
      429,
      { "Retry-After": String(limiter.retryAfterSeconds) },
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: auth.session.user.id },
    select: {
      id: true,
      passwordHash: true,
    },
  });

  if (!user?.passwordHash) {
    await writeAuditLog({
      userId: auth.session.user.id,
      action: "AUTH_PASSWORD_CHANGE_FAILED",
      ip,
      userAgent,
      metadata: { reason: "password_not_available" },
    });

    return jsonNoStore({ error: "Password change is not available for this account." }, 400);
  }

  const complexityError = validatePasswordComplexity(parsed.data.newPassword);
  if (complexityError) {
    return jsonNoStore({ error: complexityError }, 400);
  }

  const currentPasswordValid = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
  if (!currentPasswordValid) {
    await writeAuditLog({
      userId: auth.session.user.id,
      action: "AUTH_PASSWORD_CHANGE_FAILED",
      ip,
      userAgent,
      metadata: { reason: "invalid_current_password" },
    });

    return jsonNoStore({ error: "Current password is incorrect." }, 401);
  }

  const newPasswordHash = await hashPassword(parsed.data.newPassword);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: auth.session.user.id },
      data: { passwordHash: newPasswordHash },
    }),
    prisma.session.deleteMany({
      where: { userId: auth.session.user.id },
    }),
  ]);

  await writeAuditLog({
    userId: auth.session.user.id,
    action: "AUTH_PASSWORD_CHANGED",
    ip,
    userAgent,
  });

  const response = jsonNoStore({
    message: "Password updated. Sign in again with your new password.",
    requiresReauth: true,
  });

  for (const cookieName of SESSION_COOKIE_NAMES) {
    response.cookies.set(cookieName, "", {
      httpOnly: true,
      secure: cookieName.startsWith("__Secure-"),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
      expires: new Date(0),
    });
  }

  response.cookies.set(ACTIVE_ORG_COOKIE, "", {
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });

  return response;
}
