import { DriveTenantStatus, EntitlementStatus, ProductKey } from "@prisma/client";
import { LaunchButton } from "@/components/app/launch-button";
import { RequestAccessButton } from "@/components/app/request-access-button";
import { PRODUCT_CATALOG } from "@/lib/constants";
import type { DriveOperationPolicy } from "@/lib/drive/drive-operation-policy";
import type { DriveRecentEvent } from "@/lib/drive/drive-recent-events";
import type { DriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import type { DriveTenantCapabilities } from "@/lib/drive/drive-tenant-types";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";
import { isInternalOrg } from "@/lib/security/internal-org";

type EntitlementsByProduct = Partial<
  Record<
    ProductKey,
    {
      status: EntitlementStatus;
      startsAt: Date | null;
      endsAt: Date | null;
    }
  >
>;

interface ProductAccessGridProps {
  orgId: string;
  orgSlug: string;
  isMigraHostingClient: boolean;
  entitlements: EntitlementsByProduct;
  driveTenant?: {
    status: DriveTenantStatus;
    restrictionReason?: string | null | undefined;
    disableReason?: string | null | undefined;
  } | null;
  driveTenantSummary?: DriveTenantSummary | null;
  driveOperationPolicy?: DriveOperationPolicy | null;
  driveRecentEvents?: DriveRecentEvent[] | null;
}

function getLifecycleReasonMessage(reason: string | null) {
  if (reason === "billing_past_due") {
    return "Billing is past due. MigraDrive remains available in read-only mode until billing is restored.";
  }

  if (reason === "quota_exceeded_after_downgrade") {
    return "Storage usage exceeds the current plan quota. Reduce usage to restore write access.";
  }

  if (reason === "billing_canceled") {
    return "The MigraDrive subscription was canceled. Access remains disabled until service is restored.";
  }

  return reason ? `Lifecycle policy: ${reason}.` : null;
}

function getTenantMessage(reason: string | null, tenantLifecycleReason: string | null) {
  if (reason === "TENANT_PENDING") {
    return "MigraDrive provisioning is in progress. Launch stays blocked until the tenant is activated.";
  }

  if (reason === "TENANT_DISABLED") {
    return getLifecycleReasonMessage(tenantLifecycleReason)
      || "MigraDrive access is disabled for this organization. Tenant data remains preserved.";
  }

  if (reason === "CLIENT_ONLY_PRODUCT") {
    return "This product is currently available to eligible clients.";
  }

  return "This product requires an active entitlement before launch.";
}

function formatCapabilitySummary(capabilities: DriveTenantCapabilities | null) {
  if (!capabilities || !capabilities.readOnlyMode) {
    return null;
  }

  const allowed: string[] = [];
  if (capabilities.canDownload) allowed.push("download");
  if (capabilities.canPreview) allowed.push("preview");
  if (capabilities.canRename) allowed.push("rename");
  if (capabilities.canMove) allowed.push("move");

  return allowed.length > 0 ? `Read-only mode: ${allowed.join(", ")} allowed.` : "Read-only mode is active.";
}

function formatDriveOperationPolicy(policy: DriveOperationPolicy | null | undefined) {
  if (!policy) {
    return null;
  }

  const limitGiB = Math.round(policy.maxSingleUploadBytes / (1024 * 1024 * 1024));
  const details = [`${limitGiB} GiB max upload`, `${policy.pendingUploadStaleAfterHours}h pending cleanup`];

  if (policy.supportsPendingUploadCancel) {
    details.push("manual cancel");
  }

  if (policy.supportsShareLinks) {
    details.push("share links");
  }

  return `Drive policy: ${details.join(" | ")}.`;
}

function formatDriveTenantSummary(summary: DriveTenantSummary | null | undefined) {
  if (!summary) {
    return null;
  }

  const usedGiB = Number(summary.storageUsedBytes) / (1024 * 1024 * 1024);
  const usedLabel = usedGiB >= 10 ? `${usedGiB.toFixed(0)} GiB` : `${usedGiB.toFixed(1)} GiB`;
  const details = [
    `${usedLabel} of ${summary.storageQuotaGb} GiB used`,
    `${summary.activeFileCount} active files`,
    `${summary.pendingUploadCount} pending uploads`,
  ];

  if (summary.stalePendingUploadCount > 0) {
    details.push(`${summary.stalePendingUploadCount} stale pending`);
  }

  if (summary.lastCleanupAt) {
    details.push(`last cleanup ${new Date(summary.lastCleanupAt).toLocaleString()}`);
  }

  return details.join(" | ");
}

function formatDriveRecentEvents(events: DriveRecentEvent[] | null | undefined) {
  if (!events || events.length === 0) {
    return null;
  }

  return `Recent activity: ${events
    .slice(0, 2)
    .map((event) => event.summary)
    .join(" | ")}.`;
}

export function ProductAccessGrid({
  orgId,
  orgSlug,
  isMigraHostingClient,
  entitlements,
  driveTenant = null,
  driveTenantSummary = null,
  driveOperationPolicy = null,
  driveRecentEvents = null,
}: ProductAccessGridProps) {
  const internalOrg = isInternalOrg({
    slug: orgSlug,
  });

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {PRODUCT_CATALOG.map((product) => {
        const entitlement = entitlements[product.key];
        const driveTenantInput = driveTenant
          ? {
              status: driveTenant.status,
              ...(driveTenant.restrictionReason !== undefined ? { restrictionReason: driveTenant.restrictionReason } : {}),
              ...(driveTenant.disableReason !== undefined ? { disableReason: driveTenant.disableReason } : {}),
            }
          : null;
        const runtime = resolveProductRuntimeAccess({
          productKey: product.key,
          entitlement,
          isMigraHostingClient,
          isInternalOrg: internalOrg,
          driveTenant: driveTenantInput,
        });

        const statusLabel =
          product.key === ProductKey.MIGRADRIVE && runtime.tenantStatus
            ? runtime.tenantStatus
            : runtime.canLaunch
              ? "ACTIVE"
              : "RESTRICTED";

        const statusClass =
          statusLabel === "ACTIVE"
            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
            : statusLabel === "RESTRICTED"
              ? "border-amber-200 bg-amber-50 text-amber-800"
              : "border-rose-200 bg-rose-50 text-rose-700";
        const capabilitySummary = formatCapabilitySummary(runtime.capabilities);
        const lifecycleReasonMessage = getLifecycleReasonMessage(runtime.tenantLifecycleReason);
        const operationPolicySummary =
          product.key === ProductKey.MIGRADRIVE ? formatDriveOperationPolicy(driveOperationPolicy) : null;
        const tenantSummaryText =
          product.key === ProductKey.MIGRADRIVE ? formatDriveTenantSummary(driveTenantSummary) : null;
        const recentEventsSummary =
          product.key === ProductKey.MIGRADRIVE ? formatDriveRecentEvents(driveRecentEvents) : null;

        return (
          <article
            key={product.key}
            className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{product.code}</p>
                <h2 className="mt-1 text-xl font-bold">{product.name}™</h2>
              </div>
              <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusClass}`}>
                {statusLabel}
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">{product.description}</p>
            {tenantSummaryText ? (
              <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900">
                {tenantSummaryText}
              </div>
            ) : null}
            {operationPolicySummary ? (
              <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-900">
                {operationPolicySummary}
              </div>
            ) : null}
            {recentEventsSummary ? (
              <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-900">
                {recentEventsSummary}
              </div>
            ) : null}
            {product.key === ProductKey.MIGRADRIVE && capabilitySummary ? (
              <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-900">
                {capabilitySummary}
              </div>
            ) : null}
            {product.key === ProductKey.MIGRADRIVE && runtime.tenantStatus === "RESTRICTED" && lifecycleReasonMessage ? (
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                {lifecycleReasonMessage}
              </div>
            ) : null}
            <div className="mt-4 space-y-3">
              {runtime.canLaunch ? (
                <LaunchButton product={product.key} />
              ) : (
                <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">Not Available for This Organization</p>
                    <p className="mt-1 text-xs text-amber-800">
                      {getTenantMessage(runtime.reason, runtime.tenantLifecycleReason)}
                    </p>
                  </div>
                  {runtime.requestAccess ? <RequestAccessButton orgId={orgId} product={product.key} /> : null}
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
