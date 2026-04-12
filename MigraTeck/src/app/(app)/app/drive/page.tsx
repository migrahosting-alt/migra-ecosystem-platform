import { ProductKey } from "@prisma/client";
import { MigraDriveWorkspace } from "@/components/app/migradrive-workspace";
import { LinkButton } from "@/components/ui/button";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { resolveProductRuntimeAccess } from "@/lib/products/runtime-access";
import { prisma } from "@/lib/prisma";
import { isInternalOrg } from "@/lib/security/internal-org";

function readFirstQueryValue(value: string | string[] | undefined): string | null {
  if (typeof value === "string") {
    return value;
  }

  return Array.isArray(value) ? value[0] || null : null;
}

function getAccessMessage(reason: string | null, tenantLifecycleReason: string | null) {
  if (reason === "TENANT_PENDING") {
    return "MigraDrive provisioning is still in progress. Return after the tenant activation job completes.";
  }

  if (reason === "TENANT_DISABLED") {
    return tenantLifecycleReason
      ? `MigraDrive access is currently disabled by lifecycle policy: ${tenantLifecycleReason}.`
      : "MigraDrive access is currently disabled for this organization.";
  }

  return "MigraDrive is not currently available for this organization.";
}

interface MigraDrivePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function MigraDrivePage({ searchParams }: MigraDrivePageProps) {
  const session = await requireAuthSession();
  const activeMembership = await getActiveOrgContext(session.user.id);
  const params = searchParams ? await searchParams : {};
  const mockState = process.env.NODE_ENV === "test" ? readFirstQueryValue(params.mockState) : null;
  const mockEmpty = process.env.NODE_ENV === "test" && readFirstQueryValue(params.mockEmpty) === "true";

  if (!activeMembership) {
    return (
      <section className="space-y-5">
        <h1 className="text-3xl font-black tracking-tight">MigraDrive</h1>
        <p className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-muted)]">
          No organization context is available yet. Create or join an organization before opening MigraDrive.
        </p>
      </section>
    );
  }

  const [entitlement, driveTenant] = await Promise.all([
    prisma.orgEntitlement.findFirst({
      where: {
        orgId: activeMembership.orgId,
        product: ProductKey.MIGRADRIVE,
      },
      select: {
        status: true,
        startsAt: true,
        endsAt: true,
      },
    }),
    prisma.driveTenant.findUnique({
      where: { orgId: activeMembership.orgId },
      select: {
        status: true,
        restrictionReason: true,
        disableReason: true,
      },
    }),
  ]);

  if (!driveTenant) {
    return (
      <section className="space-y-5">
        <h1 className="text-3xl font-black tracking-tight">MigraDrive</h1>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          MigraDrive has not been provisioned for this organization yet. The entitlement may exist, but the tenant is not ready.
        </div>
        <LinkButton href="/app/products" variant="secondary">Back to Products</LinkButton>
      </section>
    );
  }

  if (mockState === "DISABLED") {
    return (
      <section className="space-y-5">
        <h1 className="text-3xl font-black tracking-tight">MigraDrive</h1>
        <div data-testid="drive-blocked-disabled" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Account disabled. MigraDrive access is currently disabled for this organization.
        </div>
        <LinkButton href="/app/products" variant="secondary">Back to Products</LinkButton>
      </section>
    );
  }

  if (mockState === "PENDING") {
    return (
      <section className="space-y-5">
        <h1 className="text-3xl font-black tracking-tight">MigraDrive</h1>
        <div data-testid="drive-blocked-pending" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          Setup in progress. MigraDrive provisioning is still in progress for this organization.
        </div>
        <LinkButton href="/app/products" variant="secondary">Back to Products</LinkButton>
      </section>
    );
  }

  const runtime = resolveProductRuntimeAccess({
    productKey: ProductKey.MIGRADRIVE,
    entitlement,
    isMigraHostingClient: activeMembership.org.isMigraHostingClient,
    isInternalOrg: isInternalOrg(activeMembership.org),
    driveTenant,
  });

  if (!runtime.canLaunch) {
    return (
      <section className="space-y-5">
        <h1 className="text-3xl font-black tracking-tight">MigraDrive</h1>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          {getAccessMessage(runtime.reason, runtime.tenantLifecycleReason)}
        </div>
        <LinkButton href="/app/products" variant="secondary">Back to Products</LinkButton>
      </section>
    );
  }

  return <MigraDriveWorkspace orgName={activeMembership.org.name} testOverrides={{ state: mockState, empty: mockEmpty }} />;
}