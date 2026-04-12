import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { sendMail } from "@/lib/mail";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { generateToken, hashToken } from "@/lib/tokens";

const schema = z.object({
  email: z.string().email(),
});

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const limiter = await assertRateLimit({
    key: `${parsed.data.email.toLowerCase()}:${ip}`,
    action: "auth:request-password-reset",
    maxAttempts: 6,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    return NextResponse.json(
      { error: "Too many reset attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limiter.retryAfterSeconds) } },
    );
  }

  const user = await prisma.user.findUnique({
    where: { email: parsed.data.email.toLowerCase() },
  });

  if (!user) {
    return NextResponse.json({ message: "If the account exists, reset instructions have been sent." });
  }

  const token = generateToken();

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
  });

  const baseUrl = env.NEXTAUTH_URL || "http://localhost:3000";
  const resetUrl = `${baseUrl}/reset-password?token=${token}`;

  await sendMail({
    to: user.email || parsed.data.email,
    subject: "Reset your MigraTeck password",
    text: `Reset your password: ${resetUrl}`,
    html: `<p><a href="${resetUrl}">Reset password</a></p>`,
  });

  await writeAuditLog({
    userId: user.id,
    action: "AUTH_PASSWORD_RESET_REQUESTED",
    ip,
    userAgent,
  });

  return NextResponse.json({ message: "If the account exists, reset instructions have been sent." });
}
