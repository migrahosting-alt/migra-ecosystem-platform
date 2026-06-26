import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const recentAttempts = new Map<string, { count: number; resetAt: number }>();

type OptInBody = {
  phone?: unknown;
  consent?: unknown;
  consentText?: unknown;
};

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function getClientKey(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp || "unknown";
}

function isRateLimited(key: string, now: number) {
  const current = recentAttempts.get(key);

  if (!current || current.resetAt <= now) {
    recentAttempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return false;
  }

  if (current.count >= RATE_LIMIT_MAX_ATTEMPTS) {
    return true;
  }

  current.count += 1;
  return false;
}

function maskPhone(phone: string) {
  if (phone.length <= 4) return phone;
  return `${"*".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}`;
}

/**
 * POST /api/sms-opt-in — records an SMS opt-in consent for the
 * Pale / AnnouPale text messaging program.
 *
 * Validates consent + a plausible phone number, then logs a structured
 * consent record. No DB write is performed here on purpose.
 */
export async function POST(req: Request) {
  const now = Date.now();
  const clientKey = getClientKey(req);
  if (isRateLimited(clientKey, now)) {
    return json({ error: "Too many requests. Please try again later." }, 429);
  }

  let body: OptInBody;
  try {
    body = (await req.json()) as OptInBody;
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  if (body.consent !== true) {
    return json({ error: "Consent is required" }, 400);
  }

  const rawPhone = typeof body.phone === "string" ? body.phone : "";
  const normalizedPhone = rawPhone.replace(/\D/g, "");

  if (normalizedPhone.length < 10 || normalizedPhone.length > 15) {
    return json({ error: "Valid phone number required" }, 400);
  }

  const consentText = typeof body.consentText === "string" ? body.consentText : "";
  if (consentText.length < 20 || consentText.length > 1000) {
    return json({ error: "Consent disclosure missing or invalid" }, 400);
  }

  // TODO(consent-store): persist opt-in (phone, consentText, timestamp, ip) to a durable consent store before production SMS sends. Not wired to DB to avoid prod schema change.
  console.info(
    "[sms-opt-in] consent recorded",
    JSON.stringify({
      timestamp: new Date(now).toISOString(),
      phone: maskPhone(normalizedPhone),
      consentTextLength: consentText.length,
      ipObserved: clientKey !== "unknown",
    }),
  );

  return json({ ok: true }, 200);
}
