import { PartnerTier, PartnerStatus, ProductKey, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";

// ─── Partner Binding ────────────────────────────────────────────────────

interface CreatePartnerInput {
  orgId: string;
  tier?: PartnerTier | undefined;
  companyName?: string | undefined;
  contactEmail?: string | undefined;
  commissionPct?: number | undefined;
  metadata?: Prisma.InputJsonValue | undefined;
}

export async function applyForPartner(input: CreatePartnerInput) {
  const existing = await prisma.partnerBinding.findUnique({
    where: { orgId: input.orgId },
  });
  if (existing) throw new Error("Partner application already exists.");

  const data: Record<string, unknown> = {
    orgId: input.orgId,
    status: "PENDING" as PartnerStatus,
  };
  if (input.tier !== undefined) data.tier = input.tier;
  if (input.companyName !== undefined) data.companyName = input.companyName;
  if (input.contactEmail !== undefined) data.contactEmail = input.contactEmail;
  if (input.commissionPct !== undefined) data.commissionPct = input.commissionPct;
  if (input.metadata !== undefined) data.metadata = input.metadata;

  return prisma.partnerBinding.create({
    data: data as Parameters<typeof prisma.partnerBinding.create>[0]["data"],
  });
}

export async function approvePartner(orgId: string) {
  return prisma.partnerBinding.update({
    where: { orgId },
    data: { status: "ACTIVE", approvedAt: new Date() },
  });
}

export async function suspendPartner(orgId: string) {
  return prisma.partnerBinding.update({
    where: { orgId },
    data: { status: "SUSPENDED", suspendedAt: new Date() },
  });
}

export async function revokePartner(orgId: string) {
  return prisma.partnerBinding.update({
    where: { orgId },
    data: { status: "REVOKED" },
  });
}

export async function getPartnerBinding(orgId: string) {
  return prisma.partnerBinding.findUnique({ where: { orgId } });
}

export async function listPartners(status?: PartnerStatus) {
  const where = status ? { status } : {};
  return prisma.partnerBinding.findMany({
    where,
    include: { org: { select: { id: true, name: true, slug: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// ─── Referral Codes ─────────────────────────────────────────────────────

function generateCode(): string {
  return "MIGRA-" + randomBytes(4).toString("hex").toUpperCase();
}

interface CreateReferralCodeInput {
  partnerId: string;
  description?: string | undefined;
  commissionPct?: number | undefined;
  maxUses?: number | undefined;
  expiresAt?: Date | undefined;
}

export async function createReferralCode(input: CreateReferralCodeInput) {
  // Verify partner is active
  const partner = await prisma.partnerBinding.findUnique({
    where: { orgId: input.partnerId },
  });
  if (!partner || partner.status !== "ACTIVE") {
    throw new Error("Partner not found or not active.");
  }

  const data: Record<string, unknown> = {
    code: generateCode(),
    partnerId: input.partnerId,
    commissionPct: input.commissionPct ?? partner.commissionPct,
  };
  if (input.description !== undefined) data.description = input.description;
  if (input.maxUses !== undefined) data.maxUses = input.maxUses;
  if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;

  return prisma.referralCode.create({
    data: data as Parameters<typeof prisma.referralCode.create>[0]["data"],
  });
}

export async function listReferralCodes(partnerId: string) {
  return prisma.referralCode.findMany({
    where: { partnerId },
    include: { _count: { select: { conversions: true } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function deactivateReferralCode(codeId: string) {
  return prisma.referralCode.update({
    where: { id: codeId },
    data: { isActive: false },
  });
}

// ─── Referral Conversion ────────────────────────────────────────────────

interface RecordConversionInput {
  referralCode: string;
  convertedOrgId: string;
  convertedUserId?: string | undefined;
  product?: ProductKey | undefined;
  revenueAmountCents?: number | undefined;
}

export async function recordConversion(input: RecordConversionInput) {
  const code = await prisma.referralCode.findUnique({
    where: { code: input.referralCode },
  });
  if (!code || !code.isActive) {
    throw new Error("Referral code not found or inactive.");
  }
  if (code.maxUses !== null && code.usedCount >= code.maxUses) {
    throw new Error("Referral code has reached maximum uses.");
  }
  if (code.expiresAt && code.expiresAt < new Date()) {
    throw new Error("Referral code has expired.");
  }

  const commissionAmountCents = input.revenueAmountCents
    ? Math.round((input.revenueAmountCents * code.commissionPct) / 100)
    : null;

  const convData: Record<string, unknown> = {
    referralCodeId: code.id,
    convertedOrgId: input.convertedOrgId,
  };
  if (input.convertedUserId !== undefined) convData.convertedUserId = input.convertedUserId;
  if (input.product !== undefined) convData.product = input.product;
  if (input.revenueAmountCents !== undefined) convData.revenueAmountCents = input.revenueAmountCents;
  if (commissionAmountCents !== null) convData.commissionAmountCents = commissionAmountCents;

  const [conversion] = await prisma.$transaction([
    prisma.referralConversion.create({
      data: convData as Parameters<typeof prisma.referralConversion.create>[0]["data"],
    }),
    prisma.referralCode.update({
      where: { id: code.id },
      data: { usedCount: { increment: 1 } },
    }),
  ]);

  return conversion;
}

// ─── Partner Analytics ──────────────────────────────────────────────────

export async function getPartnerStats(partnerId: string) {
  const [codes, conversions, totalRevenue] = await Promise.all([
    prisma.referralCode.count({ where: { partnerId } }),
    prisma.referralConversion.count({
      where: { referralCode: { partnerId } },
    }),
    prisma.referralConversion.aggregate({
      where: { referralCode: { partnerId } },
      _sum: { revenueAmountCents: true, commissionAmountCents: true },
    }),
  ]);

  return {
    codes,
    conversions,
    totalRevenueCents: totalRevenue._sum.revenueAmountCents ?? 0,
    totalCommissionCents: totalRevenue._sum.commissionAmountCents ?? 0,
  };
}

export async function listConversions(partnerId: string, limit = 50) {
  return prisma.referralConversion.findMany({
    where: { referralCode: { partnerId } },
    include: {
      referralCode: { select: { code: true } },
      convertedOrg: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
