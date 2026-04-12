import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { captureMarketingSmsConsent } from "@/lib/marketing-sms-consent";
import { isSmtpConfigured, sendMail } from "@/lib/mail";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { assertRateLimit } from "@/lib/security/rate-limit";

const responseSlaBusinessDays = 2;

const schema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(320),
  company: z.string().trim().min(2).max(120),
  useCase: z.string().trim().min(20).max(2000),
  phone: z.string().trim().max(40).nullable().optional(),
  smsMarketingConsent: z.boolean().optional().default(false),
  productInterest: z.string().trim().min(2).max(80).optional(),
  planInterest: z.string().trim().min(2).max(80).optional(),
  billingPreference: z.enum(["monthly", "yearly"]).optional(),
  sourceContext: z.string().trim().max(120).optional(),
}).superRefine((value, context) => {
  if (value.smsMarketingConsent && !value.phone) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["phone"],
      message: "Phone number is required when SMS consent is enabled.",
    });
  }
});

function jsonNoStore(payload: unknown, status = 200, headers?: HeadersInit): NextResponse {
  return NextResponse.json(payload, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(headers || {}),
    },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

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
    return jsonNoStore({ error: "Invalid payload." }, 400);
  }

  const email = parsed.data.email.toLowerCase();

  const limiter = await assertRateLimit({
    key: `${email}:${ip}`,
    action: "auth:request-access",
    maxAttempts: 8,
    windowSeconds: 60 * 60,
  });

  if (!limiter.ok) {
    await writeAuditLog({
      action: "AUTH_REQUEST_ACCESS_RATE_LIMITED",
      ip,
      userAgent,
      metadata: {
        route: "/api/auth/request-access",
        email,
      },
    });

    return jsonNoStore(
      { error: "Too many access requests. Try again later." },
      429,
      { "Retry-After": String(limiter.retryAfterSeconds) },
    );
  }

  const requestReference = randomUUID();

  await writeAuditLog({
    action: "AUTH_REQUEST_ACCESS_SUBMITTED",
    ip,
    userAgent,
    metadata: {
      route: "/api/auth/request-access",
      requestReference,
      name: parsed.data.name,
      email,
      company: parsed.data.company,
      phone: parsed.data.phone || null,
      smsMarketingConsent: parsed.data.smsMarketingConsent,
      useCase: parsed.data.useCase,
      productInterest: parsed.data.productInterest || null,
      planInterest: parsed.data.planInterest || null,
      billingPreference: parsed.data.billingPreference || null,
      sourceContext: parsed.data.sourceContext || null,
      responseSlaBusinessDays,
    },
  });

  if (parsed.data.smsMarketingConsent && parsed.data.phone) {
    await captureMarketingSmsConsent({
      fullName: parsed.data.name,
      email,
      phone: parsed.data.phone,
      company: parsed.data.company,
      sourceChannel: "request_access",
      consentLabel:
        "I agree to receive SMS and MMS marketing messages, updates, and offers from MigraHosting. Consent is not a condition of purchase. Message frequency may vary. Message and data rates may apply. Reply STOP to opt out and HELP for help. Questions: admin@migrahosting.com.",
      consentSource: "website:request-access",
      ip,
      userAgent,
      notes: "Request access form SMS opt-in",
    });
  }

  let confirmationEmailSent = false;

  if (isSmtpConfigured()) {
    const notifyTo = env.ACCESS_REQUEST_NOTIFY_TO || "services@migrateck.com";
    const escapedName = escapeHtml(parsed.data.name);
    const escapedEmail = escapeHtml(email);
    const escapedCompany = escapeHtml(parsed.data.company);
    const escapedUseCase = escapeHtml(parsed.data.useCase);
        const escapedProductInterest = parsed.data.productInterest ? escapeHtml(parsed.data.productInterest) : null;
        const escapedPlanInterest = parsed.data.planInterest ? escapeHtml(parsed.data.planInterest) : null;
        const escapedSourceContext = parsed.data.sourceContext ? escapeHtml(parsed.data.sourceContext) : null;
        const requestDescriptor = parsed.data.planInterest || parsed.data.productInterest || "Platform access request";
        const billingPreferenceLine = parsed.data.billingPreference ? `Billing preference: ${parsed.data.billingPreference}` : null;

    await sendMail({
      to: notifyTo,
      subject: `${requestDescriptor} (${requestReference})`,
      text: `Reference: ${requestReference}
Name: ${parsed.data.name}
Email: ${email}
Company: ${parsed.data.company}
Phone: ${parsed.data.phone || "Not provided"}
SMS marketing consent: ${parsed.data.smsMarketingConsent ? "Yes" : "No"}
    Product interest: ${parsed.data.productInterest || "Not specified"}
    Plan interest: ${parsed.data.planInterest || "Not specified"}
    ${billingPreferenceLine || "Billing preference: Not specified"}
    Source context: ${parsed.data.sourceContext || "Not specified"}
Use case: ${parsed.data.useCase}
Response SLA: ${responseSlaBusinessDays} business days`,
      html: `<p><strong>Reference:</strong> ${requestReference}</p>
<p><strong>Name:</strong> ${escapedName}</p>
<p><strong>Email:</strong> ${escapedEmail}</p>
<p><strong>Company:</strong> ${escapedCompany}</p>
<p><strong>Phone:</strong> ${escapeHtml(parsed.data.phone || "Not provided")}</p>
<p><strong>SMS marketing consent:</strong> ${parsed.data.smsMarketingConsent ? "Yes" : "No"}</p>
    <p><strong>Product interest:</strong> ${escapedProductInterest || "Not specified"}</p>
    <p><strong>Plan interest:</strong> ${escapedPlanInterest || "Not specified"}</p>
    <p><strong>Billing preference:</strong> ${escapeHtml(parsed.data.billingPreference || "Not specified")}</p>
    <p><strong>Source context:</strong> ${escapedSourceContext || "Not specified"}</p>
<p><strong>Use case:</strong><br/>${escapedUseCase.replace(/\n/g, "<br/>")}</p>
<p><strong>Response SLA:</strong> ${responseSlaBusinessDays} business days</p>`,
    });

    confirmationEmailSent = await sendMail({
      to: email,
      subject: "We received your MigraTeck access request",
      text: `Thanks for your interest in MigraTeck.

Reference: ${requestReference}
Expected response: within ${responseSlaBusinessDays} business days.

We will contact you after platform operations triage the request.`,
      html: `<p>Thanks for your interest in MigraTeck.</p>
<p><strong>Reference:</strong> ${requestReference}</p>
<p><strong>Expected response:</strong> within ${responseSlaBusinessDays} business days.</p>
<p>We will contact you after platform operations triage the request.</p>`,
    });
  }

  return jsonNoStore(
    {
      message: "Access request received.",
      reference: requestReference,
      responseSlaBusinessDays,
      confirmationEmailSent,
    },
    202,
  );
}
