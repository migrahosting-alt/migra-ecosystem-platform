import { ProductKey, Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireApiSession } from "@/lib/auth/api-auth";
import { getActiveOrgContext } from "@/lib/auth/session";
import { assertPermission } from "@/lib/authorization";
import { writeAuditLog } from "@/lib/audit";
import { normalizeMessagingTags, normalizeUsPhoneNumber } from "@/lib/migramarket-messaging";
import { prisma } from "@/lib/prisma";
import { getClientIp, getUserAgent } from "@/lib/request";
import { requireSameOrigin } from "@/lib/security/csrf";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

const importSchema = z.object({
  text: z.string().trim().min(10).max(200_000),
  defaultSourceChannel: z.string().trim().min(2).max(80).default("csv_import"),
  defaultStatus: z.string().trim().min(2).max(40).default("new"),
  defaultConsentStatus: z.enum(["unknown", "subscribed", "unsubscribed"]).default("subscribed"),
  defaultConsentSource: z.string().trim().min(2).max(160).default("csv_import"),
  defaultTags: z.array(z.string().trim().min(1).max(80)).max(20).default([]),
  dryRun: z.boolean().default(true),
});

type CanonicalLeadRow = {
  fullName: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  sourceChannel: string | null;
  campaign: string | null;
  landingPage: string | null;
  status: string | null;
  valueEstimate: string | null;
  notes: string | null;
  smsConsentStatus: string | null;
  smsConsentSource: string | null;
  smsConsentEvidence: string | null;
  messagingTags: string | null;
};

const HEADER_MAP: Record<string, keyof CanonicalLeadRow> = {
  name: "fullName",
  fullname: "fullName",
  full_name: "fullName",
  email: "email",
  mail: "email",
  phone: "phone",
  mobile: "phone",
  cell: "phone",
  company: "company",
  business: "company",
  source: "sourceChannel",
  sourcechannel: "sourceChannel",
  source_channel: "sourceChannel",
  campaign: "campaign",
  landingpage: "landingPage",
  landing_page: "landingPage",
  status: "status",
  value: "valueEstimate",
  valueestimate: "valueEstimate",
  value_estimate: "valueEstimate",
  notes: "notes",
  consent: "smsConsentStatus",
  consentstatus: "smsConsentStatus",
  smsconsentstatus: "smsConsentStatus",
  consentsource: "smsConsentSource",
  smsconsentsource: "smsConsentSource",
  consentevidence: "smsConsentEvidence",
  smsconsentevidence: "smsConsentEvidence",
  tags: "messagingTags",
  messagingtags: "messagingTags",
};

function parseDelimitedLine(line: string, delimiter: string) {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];

    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  values.push(current.trim());
  return values;
}

function normalizeHeader(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function parseLeadImport(text: string) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("Provide a header row and at least one data row.");
  }

  const [headerLine = "", ...dataLines] = lines;
  const delimiter = headerLine.includes("\t") ? "\t" : ",";
  const rawHeaders = parseDelimitedLine(headerLine, delimiter);
  const headers = rawHeaders.map((header) => HEADER_MAP[normalizeHeader(header)] || null);

  if (!headers.includes("fullName")) {
    throw new Error("The import must include a name/fullName column.");
  }

  return dataLines.map((line, rowIndex) => {
    const values = parseDelimitedLine(line, delimiter);
    const row: CanonicalLeadRow = {
      fullName: "",
      email: null,
      phone: null,
      company: null,
      sourceChannel: null,
      campaign: null,
      landingPage: null,
      status: null,
      valueEstimate: null,
      notes: null,
      smsConsentStatus: null,
      smsConsentSource: null,
      smsConsentEvidence: null,
      messagingTags: null,
    };

    headers.forEach((header, columnIndex) => {
      if (!header) return;
      const rawValue = values[columnIndex]?.trim() || "";
      (row[header] as string | null) = rawValue || null;
    });

    return {
      rowNumber: rowIndex + 2,
      row,
    };
  });
}

function parseValueEstimate(input: string | null) {
  if (!input) return null;
  const parsed = Number.parseFloat(input);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

type ImportError = {
  rowNumber: number;
  message: string;
};

export async function POST(request: NextRequest) {
  const csrfFailure = requireSameOrigin(request);
  if (csrfFailure) {
    return csrfFailure;
  }

  const authResult = await requireApiSession();
  if (!authResult.ok) {
    return authResult.response;
  }

  const activeOrg = await getActiveOrgContext(authResult.session.user.id);
  if (!activeOrg) {
    return NextResponse.json({ error: "No active organization." }, { status: 404 });
  }

  const ip = getClientIp(request);
  const userAgent = getUserAgent(request);
  const allowed = await assertPermission({
    actorUserId: authResult.session.user.id,
    orgId: activeOrg.orgId,
    role: activeOrg.role,
    action: "org:manage",
    route: "/api/migramarket/leads/import",
    ip,
    userAgent,
  });

  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await assertEntitlement({
      orgId: activeOrg.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: authResult.session.user.id,
      actorRole: activeOrg.role,
      ip,
      userAgent,
      route: "/api/migramarket/leads/import",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.httpStatus });
    }

    console.error("[API] Unhandled entitlement error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal server error." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }

  const body = await request.json().catch(() => null);
  const parsed = importSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  let importedRows: ReturnType<typeof parseLeadImport>;
  try {
    importedRows = parseLeadImport(parsed.data.text);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to parse import." },
      { status: 400 },
    );
  }

  if (importedRows.length > 500) {
    return NextResponse.json({ error: "Import is limited to 500 rows at a time." }, { status: 400 });
  }

  const errors: ImportError[] = [];
  const normalizedRows = importedRows
    .map(({ rowNumber, row }) => {
      try {
        const fullName = (row.fullName || "").trim();
        if (!fullName) {
          throw new Error("Missing full name.");
        }

        const email = row.email ? row.email.trim().toLowerCase() : null;
        const phone = row.phone ? normalizeUsPhoneNumber(row.phone) : null;

        if (!phone && !email) {
          throw new Error("Each row needs at least a phone number or email.");
        }

        const smsConsentStatus = (row.smsConsentStatus || parsed.data.defaultConsentStatus).toLowerCase();
        if (!["unknown", "subscribed", "unsubscribed"].includes(smsConsentStatus)) {
          throw new Error("Consent status must be unknown, subscribed, or unsubscribed.");
        }

        if (smsConsentStatus === "subscribed" && !phone) {
          throw new Error("Subscribed SMS contacts require a phone number.");
        }

        const tags = Array.from(
          new Set(
            normalizeMessagingTags([
              ...(row.messagingTags ? row.messagingTags.split(/[,\n]/) : []),
              ...parsed.data.defaultTags,
            ]),
          ),
        );

        return {
          rowNumber,
          fullName,
          email,
          phone,
          company: row.company?.trim() || null,
          sourceChannel: row.sourceChannel?.trim() || parsed.data.defaultSourceChannel,
          campaign: row.campaign?.trim() || null,
          landingPage: row.landingPage?.trim() || null,
          status: row.status?.trim() || parsed.data.defaultStatus,
          valueEstimate: parseValueEstimate(row.valueEstimate),
          notes: row.notes?.trim() || null,
          smsConsentStatus,
          smsConsentSource: row.smsConsentSource?.trim() || parsed.data.defaultConsentSource,
          smsConsentEvidence: row.smsConsentEvidence?.trim() || `Imported via MigraMarket on ${new Date().toISOString()}`,
          messagingTags: tags,
        };
      } catch (error) {
        errors.push({
          rowNumber,
          message: error instanceof Error ? error.message : "Invalid row.",
        });
        return null;
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const phoneSet = Array.from(new Set(normalizedRows.map((row) => row.phone).filter((value): value is string => Boolean(value))));
  const emailSet = Array.from(new Set(normalizedRows.map((row) => row.email).filter((value): value is string => Boolean(value))));

  const existingLeadWhere: Prisma.MigraMarketLeadRecordWhereInput = {
    orgId: activeOrg.orgId,
    ...(phoneSet.length || emailSet.length
      ? {
          OR: [
            ...(phoneSet.length ? [{ phone: { in: phoneSet } }] : []),
            ...(emailSet.length ? [{ email: { in: emailSet } }] : []),
          ],
        }
      : {}),
  };

  const existingLeads =
    phoneSet.length || emailSet.length
      ? await prisma.migraMarketLeadRecord.findMany({ where: existingLeadWhere })
      : [];

  const existingByPhone = new Map(existingLeads.filter((lead) => lead.phone).map((lead) => [lead.phone!, lead]));
  const existingByEmail = new Map(existingLeads.filter((lead) => lead.email).map((lead) => [lead.email!, lead]));

  let createCount = 0;
  let updateCount = 0;

  if (!parsed.data.dryRun) {
    for (const row of normalizedRows) {
      const existing = (row.phone ? existingByPhone.get(row.phone) : null) || (row.email ? existingByEmail.get(row.email) : null);
      const commonData = {
        fullName: row.fullName,
        email: row.email,
        phone: row.phone,
        company: row.company,
        sourceChannel: row.sourceChannel,
        campaign: row.campaign,
        landingPage: row.landingPage,
        status: row.status,
        valueEstimate: row.valueEstimate,
        notes: row.notes,
        smsConsentStatus: row.smsConsentStatus,
        smsConsentSource: row.smsConsentSource,
        smsConsentEvidence: row.smsConsentEvidence,
        smsConsentAt: row.smsConsentStatus === "subscribed" ? new Date() : null,
        smsOptedOutAt: row.smsConsentStatus === "unsubscribed" ? new Date() : null,
        messagingTags: row.messagingTags.length
          ? (JSON.parse(JSON.stringify(row.messagingTags)) as Prisma.InputJsonValue)
          : Prisma.JsonNull,
      };

      if (existing) {
        await prisma.migraMarketLeadRecord.update({
          where: { id: existing.id },
          data: {
            ...commonData,
            metadata: {
              ...(typeof existing.metadata === "object" && existing.metadata && !Array.isArray(existing.metadata)
                ? (existing.metadata as Record<string, unknown>)
                : {}),
              updatedBy: "bulk_import",
              importedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        updateCount += 1;
      } else {
        const created = await prisma.migraMarketLeadRecord.create({
          data: {
            orgId: activeOrg.orgId,
            ...commonData,
            metadata: {
              importedBy: authResult.session.user.email,
              importedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
        if (created.phone) existingByPhone.set(created.phone, created);
        if (created.email) existingByEmail.set(created.email, created);
        createCount += 1;
      }
    }
  } else {
    normalizedRows.forEach((row) => {
      const existing = (row.phone ? existingByPhone.get(row.phone) : null) || (row.email ? existingByEmail.get(row.email) : null);
      if (existing) {
        updateCount += 1;
      } else {
        createCount += 1;
      }
    });
  }

  await writeAuditLog({
    actorId: authResult.session.user.id,
    actorRole: activeOrg.role,
    orgId: activeOrg.orgId,
    action: parsed.data.dryRun ? "MIGRAMARKET_LEADS_IMPORT_PREVIEWED" : "MIGRAMARKET_LEADS_IMPORTED",
    resourceType: "migramarket_lead_import",
    resourceId: activeOrg.orgId,
    ip,
    userAgent,
    metadata: {
      dryRun: parsed.data.dryRun,
      totalRows: importedRows.length,
      validRows: normalizedRows.length,
      createCount,
      updateCount,
      skippedCount: errors.length,
    },
  });

  return NextResponse.json({
    summary: {
      dryRun: parsed.data.dryRun,
      totalRows: importedRows.length,
      validRows: normalizedRows.length,
      createCount,
      updateCount,
      skippedCount: errors.length,
      errors: errors.slice(0, 50),
    },
  });
}
