import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { createMagicLinkToken, normalizeMagicLinkCallbackUrl, storeMagicLinkToken } from "@/lib/auth/magic-link";
import { isEmailVerificationRequiredForLogin, isMagicLinkEnabled } from "@/lib/env";
import { isSmtpConfigured, sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";

const schema = z.object({
  email: z.string().email(),
  callbackUrl: z.string().optional(),
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

  if (!isMagicLinkEnabled) {
    return jsonNoStore({ error: "Magic links are disabled." }, 404);
  }

  if (!isSmtpConfigured()) {
    return jsonNoStore({ error: "Magic links are unavailable right now." }, 503);
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return jsonNoStore({ error: "Invalid payload." }, 400);
  }

  const email = parsed.data.email.toLowerCase();
  const callbackUrl = normalizeMagicLinkCallbackUrl(parsed.data.callbackUrl);
  const limiter = await assertRateLimit({
    key: `${email}:${ip}`,
    action: "auth:magic-link",
    maxAttempts: 5,
    windowSeconds: 600,
  });

  if (!limiter.ok) {
    await writeAuditLog({
      action: "AUTH_MAGIC_LINK_RATE_LIMITED",
      ip,
      userAgent,
      metadata: { email },
    });

    return jsonNoStore(
      { error: "Too many magic link attempts. Try again later." },
      429,
      { "Retry-After": String(limiter.retryAfterSeconds) },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      emailVerified: true,
    },
  });

  await writeAuditLog({
    action: "AUTH_MAGIC_LINK_REQUESTED",
    userId: user?.id,
    ip,
    userAgent,
    metadata: { email },
  });

  if (!user || (isEmailVerificationRequiredForLogin && !user.emailVerified)) {
    return jsonNoStore({ ok: true });
  }

  const token = createMagicLinkToken();
  await storeMagicLinkToken(email, token);

  const link = new URL("/api/auth/magic-link/verify", request.nextUrl.origin);
  link.searchParams.set("token", token);
  link.searchParams.set("callbackUrl", callbackUrl);

  const delivered = await sendMail({
    to: email,
    subject: "Your MigraTeck sign-in link",
    text: `Use this secure sign-in link: ${link.toString()}\n\nThis link expires in 15 minutes.`,
    html: `<p>Use this secure sign-in link:</p><p><a href="${link.toString()}">${link.toString()}</a></p><p>This link expires in 15 minutes.</p>`,
  });

  await writeAuditLog({
    action: delivered ? "AUTH_MAGIC_LINK_SENT" : "AUTH_MAGIC_LINK_SEND_FAILED",
    userId: user.id,
    ip,
    userAgent,
    metadata: { email },
  });

  if (!delivered) {
    await prisma.verificationToken.deleteMany({
      where: { identifier: email },
    });

    return jsonNoStore({ error: "Magic link delivery failed." }, 502);
  }

  return jsonNoStore({ ok: true });
}
