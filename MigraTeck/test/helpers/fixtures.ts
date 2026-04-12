import { EntitlementStatus, MembershipStatus, OrgRole, ProductKey, type Prisma, type User } from "@prisma/client";
import { getDefaultMigraDrivePlanConfig, resolveMigraDrivePlanConfig } from "@/lib/drive/drive-plan-config";
import { hashPassword } from "@/lib/security/password";
import { hashToken } from "@/lib/tokens";
import { prisma } from "./prisma";

export function getMigraDrivePlanFixture(planCode?: string) {
  const plan = planCode ? resolveMigraDrivePlanConfig(planCode) : getDefaultMigraDrivePlanConfig();

  if (!plan) {
    throw new Error(`Unknown MigraDrive plan fixture requested: ${planCode}`);
  }

  return {
    planCode: plan.planCode,
    storageQuotaGb: plan.storageQuotaGb,
  };
}

export async function resetDatabase(): Promise<void> {
  await prisma.vpsFirewallRule.deleteMany();
  await prisma.vpsFirewallProfile.deleteMany();
  await prisma.vpsSupportLink.deleteMany();
  await prisma.vpsConsoleSession.deleteMany();
  await prisma.vpsAlertEvent.deleteMany();
  await prisma.vpsIncident.deleteMany();
  await prisma.vpsAlertRule.deleteMany();
  await prisma.vpsServerMember.deleteMany();
  await prisma.vpsAuditEvent.deleteMany();
  await prisma.vpsMetricRollup.deleteMany();
  await prisma.vpsBackupPolicy.deleteMany();
  await prisma.vpsSnapshot.deleteMany();
  await prisma.vpsProviderBinding.deleteMany();
  await prisma.vpsActionJob.deleteMany();
  await prisma.vpsServer.deleteMany();
  await prisma.capabilityDefinitionSnapshot.deleteMany();
  await prisma.commandDefinitionSnapshot.deleteMany();
  await prisma.runbookVersion.deleteMany();
  await prisma.runbook.deleteMany();
  await prisma.serviceHealthSnapshot.deleteMany();
  await prisma.resourceEdge.deleteMany();
  await prisma.resourceNode.deleteMany();
  await prisma.pilotIncidentLink.deleteMany();
  await prisma.pilotExecutionLock.deleteMany();
  await prisma.pilotArtifact.deleteMany();
  await prisma.pilotApproval.deleteMany();
  await prisma.pilotPolicyDecision.deleteMany();
  await prisma.pilotEvent.deleteMany();
  await prisma.pilotRunStep.deleteMany();
  await prisma.pilotRun.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.provisioningJobEvent.deleteMany();
  await prisma.provisioningJob.deleteMany();
  await prisma.driveFile.deleteMany();
  await prisma.driveTenantEvent.deleteMany();
  await prisma.driveTenantOperation.deleteMany();
  await prisma.driveTenant.deleteMany();
  await prisma.mutationIntent.deleteMany();
  await prisma.userTotpFactor.deleteMany();
  await prisma.billingWebhookEvent.deleteMany();
  await prisma.provisioningTask.deleteMany();
  await prisma.billingSubscription.deleteMany();
  await prisma.billingCustomer.deleteMany();
  await prisma.billingEntitlementBinding.deleteMany();
  await prisma.migraMarketPublishValidation.deleteMany();
  await prisma.migraMarketOgSnapshot.deleteMany();
  await prisma.migraMarketContentJob.deleteMany();
  await prisma.migraMarketContentCaption.deleteMany();
  await prisma.migraMarketContentAsset.deleteMany();
  await prisma.migraMarketContentCalendarSlot.deleteMany();
  await prisma.migraMarketContentTemplate.deleteMany();
  await prisma.migraMarketCreativeBrief.deleteMany();
  await prisma.migraMarketSocialConnection.deleteMany();
  await prisma.migraMarketMessagingDelivery.deleteMany();
  await prisma.migraMarketMessagingCampaign.deleteMany();
  await prisma.migraMarketMessagingWebhookEvent.deleteMany();
  await prisma.migraMarketLeadRecord.deleteMany();
  await prisma.migraMarketLeadCaptureForm.deleteMany();
  await prisma.migraMarketReportSnapshot.deleteMany();
  await prisma.migraMarketTask.deleteMany();
  await prisma.migraMarketChecklistItem.deleteMany();
  await prisma.migraMarketLocation.deleteMany();
  await prisma.migraMarketAccount.deleteMany();
  await prisma.migraMarketPackageTemplate.deleteMany();
  await prisma.revenueOnboardingContact.deleteMany();
  await prisma.accessRequest.deleteMany();
  await prisma.orgInvitation.deleteMany();
  await prisma.downloadArtifact.deleteMany();
  await prisma.notificationPreference.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.alert.deleteMany();
  await prisma.alertRule.deleteMany();
  await prisma.platformEvent.deleteMany();
  await prisma.platformConfig.deleteMany();
  await prisma.rateLimitEvent.deleteMany();
  await prisma.launchTokenNonce.deleteMany();
  await prisma.passwordResetToken.deleteMany();
  await prisma.emailVerificationToken.deleteMany();
  await prisma.refreshSession.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.orgEntitlement.deleteMany();
  await prisma.membership.deleteMany();
  await prisma.organization.deleteMany();
  await prisma.user.deleteMany();
  await prisma.verificationToken.deleteMany();
}

interface CreateUserInput {
  email: string;
  password: string;
  name?: string | undefined;
  emailVerified?: boolean | undefined;
}

export async function createUser(input: CreateUserInput): Promise<User> {
  return prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      name: input.name || "Integration User",
      passwordHash: await hashPassword(input.password),
      emailVerified: input.emailVerified ? new Date() : null,
    },
  });
}

interface CreateOrganizationInput {
  name: string;
  slug: string;
  isMigraHostingClient?: boolean | undefined;
  createdById?: string | undefined;
}

export async function createOrganization(input: CreateOrganizationInput) {
  return prisma.organization.create({
    data: {
      name: input.name,
      slug: input.slug,
      isMigraHostingClient: input.isMigraHostingClient || false,
      createdById: input.createdById,
    },
  });
}

export async function createMembership(input: { userId: string; orgId: string; role: OrgRole }) {
  return prisma.membership.create({
    data: {
      userId: input.userId,
      orgId: input.orgId,
      role: input.role,
      status: MembershipStatus.ACTIVE,
    },
  });
}

export async function createEntitlement(input: {
  orgId: string;
  product: ProductKey;
  status?: EntitlementStatus | undefined;
  startsAt?: Date | null | undefined;
  endsAt?: Date | null | undefined;
  notes?: string | null | undefined;
}) {
  return prisma.orgEntitlement.create({
    data: {
      orgId: input.orgId,
      product: input.product,
      status: input.status || EntitlementStatus.ACTIVE,
      startsAt: input.startsAt ?? null,
      endsAt: input.endsAt ?? null,
      notes: input.notes ?? null,
    },
  });
}

export async function createDownloadArtifact(input: {
  name: string;
  product: ProductKey;
  version: string;
  fileKey: string;
  sha256?: string | undefined;
  sizeBytes?: bigint | undefined;
  isActive?: boolean | undefined;
}) {
  return prisma.downloadArtifact.create({
    data: {
      name: input.name,
      product: input.product,
      version: input.version,
      fileKey: input.fileKey,
      sha256: input.sha256 || "fixture-sha256",
      sizeBytes: input.sizeBytes || BigInt(1024),
      isActive: input.isActive ?? true,
    },
  });
}

export async function createBillingEntitlementBinding(input: {
  externalPriceId: string;
  product: ProductKey;
  statusOnActive?: EntitlementStatus | undefined;
  notes?: string | undefined;
}) {
  return prisma.billingEntitlementBinding.create({
    data: {
      externalPriceId: input.externalPriceId,
      product: input.product,
      statusOnActive: input.statusOnActive || EntitlementStatus.ACTIVE,
      notes: input.notes || null,
    },
  });
}

export async function createPlatformConfig(input?: {
  allowPublicSignup?: boolean | undefined;
  allowOrgCreate?: boolean | undefined;
  waitlistMode?: boolean | undefined;
  maintenanceMode?: boolean | undefined;
  freezeProvisioning?: boolean | undefined;
  pauseProvisioningWorker?: boolean | undefined;
  pauseEntitlementExpiryWorker?: boolean | undefined;
}) {
  return prisma.platformConfig.upsert({
    where: { id: "default" },
    update: {
      ...(input?.allowPublicSignup !== undefined ? { allowPublicSignup: input.allowPublicSignup } : {}),
      ...(input?.allowOrgCreate !== undefined ? { allowOrgCreate: input.allowOrgCreate } : {}),
      ...(input?.waitlistMode !== undefined ? { waitlistMode: input.waitlistMode } : {}),
      ...(input?.maintenanceMode !== undefined ? { maintenanceMode: input.maintenanceMode } : {}),
      ...(input?.freezeProvisioning !== undefined ? { freezeProvisioning: input.freezeProvisioning } : {}),
      ...(input?.pauseProvisioningWorker !== undefined ? { pauseProvisioningWorker: input.pauseProvisioningWorker } : {}),
      ...(input?.pauseEntitlementExpiryWorker !== undefined
        ? { pauseEntitlementExpiryWorker: input.pauseEntitlementExpiryWorker }
        : {}),
    },
    create: {
      id: "default",
      allowPublicSignup: input?.allowPublicSignup ?? false,
      allowOrgCreate: input?.allowOrgCreate ?? false,
      waitlistMode: input?.waitlistMode ?? false,
      maintenanceMode: input?.maintenanceMode ?? false,
      freezeProvisioning: input?.freezeProvisioning ?? false,
      pauseProvisioningWorker: input?.pauseProvisioningWorker ?? false,
      pauseEntitlementExpiryWorker: input?.pauseEntitlementExpiryWorker ?? false,
    },
  });
}

export async function createVerificationToken(input: {
  userId: string;
  token: string;
  expiresAt?: Date | undefined;
}) {
  return prisma.emailVerificationToken.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(input.token),
      expiresAt: input.expiresAt || new Date(Date.now() + 60 * 60 * 1000),
    },
  });
}

export async function createPasswordResetToken(input: {
  userId: string;
  token: string;
  expiresAt?: Date | undefined;
}) {
  return prisma.passwordResetToken.create({
    data: {
      userId: input.userId,
      tokenHash: hashToken(input.token),
      expiresAt: input.expiresAt || new Date(Date.now() + 30 * 60 * 1000),
    },
  });
}

export async function createRateLimitEvent(data: Prisma.RateLimitEventUncheckedCreateInput) {
  return prisma.rateLimitEvent.create({ data });
}
