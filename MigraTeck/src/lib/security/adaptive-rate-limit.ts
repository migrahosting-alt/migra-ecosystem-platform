import { prisma } from "@/lib/prisma";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { countRecentSecurityEvents, recordSecurityEvent } from "@/lib/security/security-events";

/**
 * Adaptive rate limiter.
 *
 * The base rate limit uses the existing sliding-window from rate-limit.ts.
 * On top of that, this module tightens limits for IPs or users that have
 * recent security events (suspicious logins, brute force, token reuse).
 *
 * Escalation tiers:
 *   0 events → normal limits
 *   1-2 events → 50% reduction
 *   3-5 events → 75% reduction
 *   6+ events → 90% reduction (near-lockout)
 */

interface AdaptiveRateLimitInput {
  key: string;
  action: string;
  baseMaxAttempts: number;
  baseWindowSeconds: number;
  userId?: string | undefined;
  ip?: string | undefined;
}

interface AdaptiveRateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
  effectiveMaxAttempts: number;
  riskMultiplier: number;
}

export async function assertAdaptiveRateLimit(
  input: AdaptiveRateLimitInput,
): Promise<AdaptiveRateLimitResult> {
  const riskMultiplier = await computeRiskMultiplier(input.userId, input.ip);
  const effectiveMaxAttempts = Math.max(1, Math.floor(input.baseMaxAttempts * riskMultiplier));

  const result = await assertRateLimit({
    key: input.key,
    action: input.action,
    maxAttempts: effectiveMaxAttempts,
    windowSeconds: input.baseWindowSeconds,
  });

  return {
    ok: result.ok,
    retryAfterSeconds: result.retryAfterSeconds,
    effectiveMaxAttempts,
    riskMultiplier,
  };
}

async function computeRiskMultiplier(
  userId?: string,
  ip?: string,
): Promise<number> {
  const windowSeconds = 3600; // 1 hour lookback

  const [userEvents, ipEvents] = await Promise.all([
    userId
      ? countRecentSecurityEvents({
          userId,
          eventType: "SUSPICIOUS_LOGIN",
          windowSeconds,
        })
      : Promise.resolve(0),
    ip
      ? countRecentSecurityEvents({
          ip,
          eventType: "BRUTE_FORCE_DETECTED",
          windowSeconds,
        })
      : Promise.resolve(0),
  ]);

  const totalEvents = userEvents + ipEvents;

  if (totalEvents === 0) return 1.0;
  if (totalEvents <= 2) return 0.5;
  if (totalEvents <= 5) return 0.25;
  return 0.1;
}

// ── Suspicious login detection ──

interface LoginContext {
  userId: string;
  ip: string;
  userAgent: string;
  email: string;
}

interface SuspicionResult {
  suspicious: boolean;
  reasons: string[];
  score: number;
}

export async function evaluateLoginSuspicion(ctx: LoginContext): Promise<SuspicionResult> {
  const reasons: string[] = [];
  let score = 0;

  // 1. Check for new IP (never seen for this user)
  const knownIpCount = await prisma.refreshSession.count({
    where: {
      userId: ctx.userId,
      ipAddress: ctx.ip,
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) }, // 90 days
    },
  });
  if (knownIpCount === 0) {
    score += 30;
    reasons.push("new_ip");
  }

  // 2. Check for new user-agent (never seen for this user)
  const knownUaCount = await prisma.refreshSession.count({
    where: {
      userId: ctx.userId,
      userAgent: ctx.userAgent,
      createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
    },
  });
  if (knownUaCount === 0) {
    score += 20;
    reasons.push("new_user_agent");
  }

  // 3. Check for recent failed logins from this IP
  const recentFailedCount = await prisma.rateLimitEvent.count({
    where: {
      key: { contains: ctx.ip },
      action: "auth:login",
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }, // 15 min
    },
  });
  if (recentFailedCount >= 3) {
    score += 25;
    reasons.push("recent_failed_logins");
  }

  // 4. Check for concurrent sessions from many different IPs
  const recentSessionIps = await prisma.refreshSession.findMany({
    where: {
      userId: ctx.userId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { ipAddress: true },
    distinct: ["ipAddress"],
  });
  if (recentSessionIps.length >= 5) {
    score += 20;
    reasons.push("many_concurrent_ips");
  }

  // 5. Check for recent security events
  const recentSecurityEventCount = await countRecentSecurityEvents({
    userId: ctx.userId,
    eventType: "SUSPICIOUS_LOGIN",
    windowSeconds: 3600,
  });
  if (recentSecurityEventCount >= 2) {
    score += 15;
    reasons.push("repeated_suspicion");
  }

  const suspicious = score >= 50;

  if (suspicious) {
    await recordSecurityEvent({
      userId: ctx.userId,
      eventType: "SUSPICIOUS_LOGIN",
      severity: "WARNING",
      ip: ctx.ip,
      userAgent: ctx.userAgent,
      metadata: { reasons, score, email: ctx.email },
    });
  }

  return { suspicious, reasons, score };
}
