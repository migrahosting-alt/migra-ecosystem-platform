import { prisma } from "@/lib/prisma";

interface RateLimitInput {
  key: string;
  action: string;
  maxAttempts: number;
  windowSeconds: number;
}

interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

async function cleanupOldRateLimitEvents(): Promise<void> {
  if (Math.random() > 0.03) {
    return;
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  await prisma.rateLimitEvent.deleteMany({
    where: {
      createdAt: { lt: sevenDaysAgo },
    },
  });
}

export async function assertRateLimit(input: RateLimitInput): Promise<RateLimitResult> {
  await cleanupOldRateLimitEvents();

  const windowStart = new Date(Date.now() - input.windowSeconds * 1000);

  const attempts = await prisma.rateLimitEvent.count({
    where: {
      key: input.key,
      action: input.action,
      createdAt: { gte: windowStart },
    },
  });

  if (attempts >= input.maxAttempts) {
    const oldestAttempt = await prisma.rateLimitEvent.findFirst({
      where: {
        key: input.key,
        action: input.action,
        createdAt: { gte: windowStart },
      },
      orderBy: { createdAt: "asc" },
    });

    const retryAfterSeconds = oldestAttempt
      ? Math.max(1, Math.ceil((oldestAttempt.createdAt.getTime() + input.windowSeconds * 1000 - Date.now()) / 1000))
      : input.windowSeconds;

    return { ok: false, retryAfterSeconds };
  }

  await prisma.rateLimitEvent.create({
    data: {
      key: input.key,
      action: input.action,
    },
  });

  return { ok: true, retryAfterSeconds: 0 };
}
