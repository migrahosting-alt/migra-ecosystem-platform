import { OrgRole, ProductKey } from "@prisma/client";
import {
  MigraMarketWorkspace,
  type WorkspaceAccount,
  type WorkspaceCalendarSlot,
  type WorkspaceChecklistItem,
  type WorkspaceContentJob,
  type WorkspaceContentTemplate,
  type WorkspaceLead,
  type WorkspaceLeadForm,
  type WorkspaceLocation,
  type WorkspaceMessagingCampaign,
  type WorkspaceMessagingDelivery,
  type WorkspacePackageTemplate,
  type WorkspaceReportSnapshot,
  type WorkspaceCreativeBrief,
  type WorkspaceSocialConnection,
  type WorkspaceTask,
} from "@/components/app/migramarket-workspace";
import { MigraMarketLegacyHandoffCleaner } from "@/components/app/migramarket-legacy-handoff-cleaner";
import { LinkButton } from "@/components/ui/button";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { getMigraMarketWorkspace, normalizeStringList, serializePackageTemplate } from "@/lib/migramarket";
import {
  serializeCalendarSlot,
  serializeContentJob,
  serializeContentTemplate,
  serializeCreativeBrief,
  serializeSocialConnection,
} from "@/lib/migramarket-social";
import { roleAtLeast } from "@/lib/rbac";
import { EntitlementEnforcementError, assertEntitlement } from "@/lib/security/enforcement";

export default async function MigraMarketPage() {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);

  if (!activeMembership) {
    return <p>No active organization. Create or join one first.</p>;
  }

  try {
    await assertEntitlement({
      orgId: activeMembership.orgId,
      feature: ProductKey.MIGRAMARKET,
      actorUserId: session.user.id,
      actorRole: activeMembership.role,
      route: "/app/migramarket",
    });
  } catch (error) {
    if (error instanceof EntitlementEnforcementError) {
      return (
        <section className="rounded-3xl border border-[var(--line)] bg-white p-6">
          <h1 className="text-3xl font-black tracking-tight">MigraMarket</h1>
          <p className="mt-3 max-w-2xl text-sm text-[var(--ink-muted)]">
            MigraMarket is not active for this organization yet. Activate the product or request access before using the
            growth operations workspace.
          </p>
          <div className="mt-5 flex gap-3">
            <LinkButton href="/app/products">View products</LinkButton>
          </div>
        </section>
      );
    }

    throw error;
  }

  const workspace = await getMigraMarketWorkspace(activeMembership.orgId);
  const canManage = roleAtLeast(activeMembership.role, OrgRole.ADMIN);

  const account: WorkspaceAccount | null = workspace.account
    ? {
        id: workspace.account.id,
        orgId: workspace.account.orgId,
        packageTemplateId: workspace.account.packageTemplateId,
        packageTemplateCode: workspace.account.packageTemplate?.code || null,
        packageName: workspace.account.packageName,
        clientStage: workspace.account.clientStage,
        healthStatus: workspace.account.healthStatus,
        messagingBrandName: workspace.account.messagingBrandName,
        messagingFromNumber: workspace.account.messagingFromNumber,
        messagingSupportEmail: workspace.account.messagingSupportEmail,
        primaryGoals: normalizeStringList(workspace.account.primaryGoals),
        targetMarkets: normalizeStringList(workspace.account.targetMarkets),
        googleBusinessProfileUrl: workspace.account.googleBusinessProfileUrl,
        websiteUrl: workspace.account.websiteUrl,
        socialProfiles: normalizeStringList(workspace.account.socialProfiles),
        adBudgetMonthly: workspace.account.adBudgetMonthly,
        notes: workspace.account.notes,
        createdAt: workspace.account.createdAt.toISOString(),
        updatedAt: workspace.account.updatedAt.toISOString(),
      }
    : null;

  const locations: WorkspaceLocation[] = workspace.locations.map((item: (typeof workspace.locations)[number]) => ({
    id: item.id,
    name: item.name,
    city: item.city,
    region: item.region,
    country: item.country,
    serviceArea: item.serviceArea,
    primaryPhone: item.primaryPhone,
    primary: item.primary,
    status: item.status,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }));

  const checklist: WorkspaceChecklistItem[] = workspace.checklist.map((item: (typeof workspace.checklist)[number]) => ({
    id: item.id,
    key: item.key,
    title: item.title,
    description: item.description,
    status: item.status,
    owner: item.owner,
    dueAt: item.dueAt ? item.dueAt.toISOString() : null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }));

  const tasks: WorkspaceTask[] = workspace.tasks.map((item: (typeof workspace.tasks)[number]) => ({
    id: item.id,
    title: item.title,
    category: item.category,
    status: item.status,
    priority: item.priority,
    dueAt: item.dueAt ? item.dueAt.toISOString() : null,
    completedAt: item.completedAt ? item.completedAt.toISOString() : null,
    assignee: item.assignee,
    notes: item.notes,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }));

  const reports: WorkspaceReportSnapshot[] = workspace.reports.map((item: (typeof workspace.reports)[number]) => ({
    id: item.id,
    label: item.label,
    periodStart: item.periodStart.toISOString(),
    periodEnd: item.periodEnd.toISOString(),
    leads: item.leads,
    calls: item.calls,
    bookedAppointments: item.bookedAppointments,
    profileViews: item.profileViews,
    websiteSessions: item.websiteSessions,
    conversionRate: item.conversionRate,
    reviewCount: item.reviewCount,
    averageRating: item.averageRating,
    emailOpenRate: item.emailOpenRate,
    socialReach: item.socialReach,
    adSpend: item.adSpend,
    costPerLead: item.costPerLead,
    revenueAttributed: item.revenueAttributed,
    summary: item.summary,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }));

  const packageTemplates: WorkspacePackageTemplate[] = workspace.packageTemplates.map(
    (item: (typeof workspace.packageTemplates)[number]) => serializePackageTemplate(item),
  );

  const leadForms: WorkspaceLeadForm[] = workspace.leadForms.map((form: (typeof workspace.leadForms)[number]) => ({
    ...form,
    createdAt: form.createdAt.toISOString(),
    updatedAt: form.updatedAt.toISOString(),
  }));

  const leads: WorkspaceLead[] = workspace.leads.map((lead: (typeof workspace.leads)[number]) => ({
    ...lead,
    messagingTags: normalizeStringList(lead.messagingTags),
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
    smsConsentAt: lead.smsConsentAt ? lead.smsConsentAt.toISOString() : null,
    smsOptedOutAt: lead.smsOptedOutAt ? lead.smsOptedOutAt.toISOString() : null,
    form: lead.form
      ? {
          ...lead.form,
          createdAt: lead.form.createdAt.toISOString(),
          updatedAt: lead.form.updatedAt.toISOString(),
        }
      : null,
  }));

  const messagingCampaigns: WorkspaceMessagingCampaign[] = workspace.messagingCampaigns.map(
    (campaign: (typeof workspace.messagingCampaigns)[number]) => ({
      ...campaign,
      mediaUrls: normalizeStringList(campaign.mediaUrls),
      scheduledAt: campaign.scheduledAt ? campaign.scheduledAt.toISOString() : null,
      launchedAt: campaign.launchedAt ? campaign.launchedAt.toISOString() : null,
      completedAt: campaign.completedAt ? campaign.completedAt.toISOString() : null,
      lastDispatchedAt: campaign.lastDispatchedAt ? campaign.lastDispatchedAt.toISOString() : null,
      createdAt: campaign.createdAt.toISOString(),
      updatedAt: campaign.updatedAt.toISOString(),
    }),
  );

  const recentDeliveries: WorkspaceMessagingDelivery[] = workspace.recentDeliveries.map(
    (delivery: (typeof workspace.recentDeliveries)[number]) => ({
      ...delivery,
      createdAt: delivery.createdAt.toISOString(),
      updatedAt: delivery.updatedAt.toISOString(),
      deliveredAt: delivery.deliveredAt ? delivery.deliveredAt.toISOString() : null,
      finalizedAt: delivery.finalizedAt ? delivery.finalizedAt.toISOString() : null,
      campaign: delivery.campaign
        ? {
            id: delivery.campaign.id,
            name: delivery.campaign.name,
          }
        : null,
      lead: delivery.lead
        ? {
            id: delivery.lead.id,
            fullName: delivery.lead.fullName,
            phone: delivery.lead.phone,
          }
        : null,
    }),
  );

  const socialConnections: WorkspaceSocialConnection[] = workspace.socialConnections.map((connection: (typeof workspace.socialConnections)[number]) =>
    serializeSocialConnection(connection),
  );

  const creativeBriefs: WorkspaceCreativeBrief[] = workspace.creativeBriefs.map((brief: (typeof workspace.creativeBriefs)[number]) =>
    serializeCreativeBrief(brief),
  );

  const contentJobs: WorkspaceContentJob[] = workspace.contentJobs.map((job: (typeof workspace.contentJobs)[number]) => serializeContentJob(job));
  const contentTemplates: WorkspaceContentTemplate[] = workspace.contentTemplates.map((template: (typeof workspace.contentTemplates)[number]) =>
    serializeContentTemplate(template),
  );
  const calendarSlots: WorkspaceCalendarSlot[] = workspace.calendarSlots.map((slot: (typeof workspace.calendarSlots)[number]) =>
    serializeCalendarSlot(slot),
  );

  return (
    <>
      <MigraMarketLegacyHandoffCleaner />
      <MigraMarketWorkspace
        orgName={activeMembership.org.name}
        orgSlug={activeMembership.org.slug}
        canManage={canManage}
        initialWorkspace={{
          account,
          locations,
          checklist,
          tasks,
          reports,
          packageTemplates,
          leadForms,
          leads,
          messagingCampaigns,
          recentDeliveries,
          socialConnections,
          creativeBriefs,
          contentJobs,
          contentTemplates,
          calendarSlots,
        }}
      />
    </>
  );
}
