import { EntitlementStatus, ProductKey, ProvisioningJobSource } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { writeAuditLog } from "@/lib/audit";
import { env } from "@/lib/env";
import { isSmtpConfigured, sendMail } from "@/lib/mail";
import { ensureMigraMarketWorkspace } from "@/lib/migramarket";
import { slugifyOrganizationName } from "@/lib/org";
import { prisma } from "@/lib/prisma";
import { queueProvisioningForEntitlementTransition } from "@/lib/provisioning/queue";

const handoffSchema = z.object({
  source: z.string().optional(),
  company: z.string().min(2).max(120),
  plan: z.string().min(2).max(160),
  product: z.string().optional(),
  tenantId: z.string().nullable().optional(),
  serviceInstanceId: z.string().nullable().optional(),
  domain: z.string().nullable().optional(),
  targetIp: z.string().nullable().optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
  mailboxEmail: z.string().email().optional(),
  mailboxPassword: z.string().min(8).optional(),
  mailboxName: z.string().min(1).max(120).optional(),
  mailboxQuotaMb: z.number().positive().optional(),
  mailDomainDescription: z.string().max(200).optional(),
  mailDomainMaxMailboxes: z.number().positive().optional(),
  mailDomainQuotaMb: z.number().positive().optional(),
  monthlyRevenue: z.number().nonnegative().optional(),
  revenueCustomerId: z.string().optional(),
  organizationId: z.string().optional(),
  orgSlug: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactName: z.string().optional(),
  notes: z.string().max(2000).optional(),
});

function normalizeIncomingProduct(raw: string | undefined): ProductKey {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "MT" || value === "MIGRATECK") return ProductKey.MIGRATECK;
  if (value === "MH" || value === "MIGRAHOSTING") return ProductKey.MIGRAHOSTING;
  if (value === "MP" || value === "MIGRAPANEL") return ProductKey.MIGRAPANEL;
  if (value === "MV" || value === "MIGRAVOICE") return ProductKey.MIGRAVOICE;
  if (value === "MM" || value === "MIGRAMAIL") return ProductKey.MIGRAMAIL;
  if (value === "MI" || value === "MIGRAINTAKE") return ProductKey.MIGRAINTAKE;
  if (value === "MK" || value === "MIGRAMARKET") return ProductKey.MIGRAMARKET;
  if (value === "PILOT" || value === "MIGRAPILOT") return ProductKey.MIGRAPILOT;
  return ProductKey.MIGRAPANEL;
}

function extractBearerToken(request: NextRequest): string {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export async function POST(request: NextRequest) {
  const configuredToken = env.MARKET_INTERNAL_PROVISION_TOKEN?.trim();
  const suppliedToken = extractBearerToken(request);

  if (!configuredToken || suppliedToken !== configuredToken) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = handoffSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const payload = parsed.data;
  const product = normalizeIncomingProduct(payload.product);
  const baseSlug = slugifyOrganizationName(payload.orgSlug || payload.company);
  const requestReference = randomUUID();

  let candidateSlug = baseSlug;
  let suffix = 1;
  while (!candidateSlug) {
    suffix += 1;
    candidateSlug = `org-${suffix}`;
  }

  let org = await prisma.organization.findUnique({
    where: { slug: candidateSlug },
    select: { id: true, slug: true, name: true, isMigraHostingClient: true },
  });

  if (!org) {
    let finalSlug = candidateSlug;
    while (true) {
      const existing = await prisma.organization.findUnique({ where: { slug: finalSlug }, select: { id: true } });
      if (!existing) break;
      suffix += 1;
      finalSlug = `${candidateSlug}-${suffix}`;
    }

    org = await prisma.organization.create({
      data: {
        name: payload.company,
        slug: finalSlug,
        isMigraHostingClient: true,
      },
      select: { id: true, slug: true, name: true, isMigraHostingClient: true },
    });

    await writeAuditLog({
      actorId: null,
      actorRole: "SYSTEM",
      orgId: org.id,
      action: "ORG_CREATED_FROM_REVENUE_HANDOFF",
      resourceType: "organization",
      resourceId: org.id,
      riskTier: 1,
      metadata: {
        source: payload.source || "migra-market",
        company: payload.company,
        contactEmail: payload.contactEmail || null,
        revenueCustomerId: payload.revenueCustomerId || null,
      },
    });
  }

  const previous = await prisma.orgEntitlement.findUnique({
    where: {
      orgId_product: {
        orgId: org.id,
        product,
      },
    },
  });

  const entitlement = await prisma.orgEntitlement.upsert({
    where: {
      orgId_product: {
        orgId: org.id,
        product,
      },
    },
    update: {
      status: EntitlementStatus.ACTIVE,
      notes: payload.notes || `Provisioned from revenue handoff for ${payload.plan}`,
    },
    create: {
      orgId: org.id,
      product,
      status: EntitlementStatus.ACTIVE,
      notes: payload.notes || `Provisioned from revenue handoff for ${payload.plan}`,
    },
  });

  if (product === ProductKey.MIGRAMARKET) {
    await ensureMigraMarketWorkspace(org.id);
  }

  if (previous?.status !== entitlement.status) {
    await queueProvisioningForEntitlementTransition({
      orgId: org.id,
      orgSlug: org.slug,
      product,
      previousStatus: previous?.status || null,
      newStatus: entitlement.status,
      source: ProvisioningJobSource.SYSTEM,
      transitionId: `revenue:${payload.revenueCustomerId || "unknown"}:${org.id}:${product}`,
      payload: {
        source: payload.source || "migra-market",
        company: payload.company,
        plan: payload.plan,
        tenantId: payload.tenantId || null,
        serviceInstanceId: payload.serviceInstanceId || null,
        domain: payload.domain || null,
        targetIp: payload.targetIp || null,
        limits: payload.limits || null,
        mailboxEmail: payload.mailboxEmail || null,
        mailboxPassword: payload.mailboxPassword || null,
        mailboxName: payload.mailboxName || null,
        mailboxQuotaMb: payload.mailboxQuotaMb || null,
        mailDomainDescription: payload.mailDomainDescription || null,
        mailDomainMaxMailboxes: payload.mailDomainMaxMailboxes || null,
        mailDomainQuotaMb: payload.mailDomainQuotaMb || null,
        contactEmail: payload.contactEmail || null,
        contactName: payload.contactName || null,
        revenueCustomerId: payload.revenueCustomerId || null,
        reference: requestReference,
      },
      actorRole: "SYSTEM",
    });
  }

  const onboardingContact = await prisma.revenueOnboardingContact.create({
    data: {
      orgId: org.id,
      reference: requestReference,
      source: payload.source || "migra-market",
      company: payload.company,
      contactName: payload.contactName || null,
      contactEmail: payload.contactEmail || null,
      plan: payload.plan,
      requestedProduct: product,
      status: previous?.status !== entitlement.status ? "provisioning" : "queued",
      revenueCustomerId: payload.revenueCustomerId || null,
      tenantId: payload.tenantId || null,
      monthlyRevenue: payload.monthlyRevenue || 0,
      notes: payload.notes || null,
    },
  });

  await writeAuditLog({
    actorId: null,
    actorRole: "SYSTEM",
    orgId: org.id,
    action: "REVENUE_PROVISION_HANDOFF_ACCEPTED",
    resourceType: "org_entitlement",
    resourceId: `${org.id}:${product}`,
    riskTier: 1,
    metadata: {
      source: payload.source || "migra-market",
      company: payload.company,
      plan: payload.plan,
      product,
      tenantId: payload.tenantId || null,
      monthlyRevenue: payload.monthlyRevenue || 0,
      revenueCustomerId: payload.revenueCustomerId || null,
      contactEmail: payload.contactEmail || null,
      contactName: payload.contactName || null,
      requestReference,
      orgCreated: previous ? false : true,
    },
  });

  let operatorEmailSent = false;
  let contactEmailSent = false;
  if (isSmtpConfigured()) {
    const notifyTo = env.ACCESS_REQUEST_NOTIFY_TO || "services@migrateck.com";
    operatorEmailSent = await sendMail({
      to: notifyTo,
      subject: `Revenue provisioning handoff (${requestReference})`,
      text: `Reference: ${requestReference}
Company: ${payload.company}
Plan: ${payload.plan}
Product: ${product}
Org: ${org.name} (${org.slug})
Contact: ${payload.contactName || "(none)"} <${payload.contactEmail || "n/a"}>
Revenue customer: ${payload.revenueCustomerId || "(none)"}
Notes: ${payload.notes || "(none)"}`,
      html: `<p><strong>Reference:</strong> ${requestReference}</p>
<p><strong>Company:</strong> ${payload.company}</p>
<p><strong>Plan:</strong> ${payload.plan}</p>
<p><strong>Product:</strong> ${product}</p>
<p><strong>Org:</strong> ${org.name} (${org.slug})</p>
<p><strong>Contact:</strong> ${payload.contactName || "(none)"} &lt;${payload.contactEmail || "n/a"}&gt;</p>
<p><strong>Revenue customer:</strong> ${payload.revenueCustomerId || "(none)"}</p>
<p><strong>Notes:</strong> ${payload.notes || "(none)"}</p>`,
    });

    if (payload.contactEmail) {
      contactEmailSent = await sendMail({
        to: payload.contactEmail,
        subject: "Your MigraTeck onboarding is being prepared",
        text: `We received your onboarding handoff for ${payload.company}.

Reference: ${requestReference}
Plan: ${payload.plan}
Product lane: ${product}

Platform operations has queued the setup workflow and will follow up with next-step access details.`,
        html: `<p>We received your onboarding handoff for <strong>${payload.company}</strong>.</p>
<p><strong>Reference:</strong> ${requestReference}<br/>
<strong>Plan:</strong> ${payload.plan}<br/>
<strong>Product lane:</strong> ${product}</p>
<p>Platform operations has queued the setup workflow and will follow up with next-step access details.</p>`,
      });
    }
  }

  await prisma.revenueOnboardingContact.update({
    where: { id: onboardingContact.id },
    data: {
      operatorEmailSent,
      contactEmailSent,
      status:
        previous?.status !== entitlement.status
          ? "provisioning"
          : operatorEmailSent || contactEmailSent
            ? "contacted"
            : "queued",
    },
  });

  return NextResponse.json({
    ok: true,
    org: {
      id: org.id,
      slug: org.slug,
      name: org.name,
    },
    entitlement: {
      product,
      status: entitlement.status,
      updatedAt: entitlement.updatedAt,
    },
    provisioningQueued: previous?.status !== entitlement.status,
    onboardingContact: {
      id: onboardingContact.id,
      reference: requestReference,
      status:
        previous?.status !== entitlement.status
          ? "provisioning"
          : operatorEmailSent || contactEmailSent
            ? "contacted"
            : "queued",
    },
    onboarding: {
      reference: requestReference,
      operatorEmailSent,
      contactEmailSent,
    },
  });
}
