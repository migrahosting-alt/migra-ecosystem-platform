import Link from "next/link";
import { PlatformConfigForm } from "@/components/app/platform-config-form";
import { requireAuthSession } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { getPlatformConfig, isPlatformOwner } from "@/lib/platform-config";
import { prisma } from "@/lib/prisma";

export default async function PlatformSettingsPage() {
  const session = await requireAuthSession();
  const activeMembership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      status: "ACTIVE",
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const platformOwner = await isPlatformOwner(session.user.id);

  if (!activeMembership || !platformOwner) {
    await writeAuditLog({
      userId: session.user.id,
      orgId: activeMembership?.orgId || null,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "platform:config:manage",
      metadata: {
        route: "/app/platform/settings",
        role: activeMembership?.role || null,
      },
    });

    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Platform settings</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Owner role is required to manage platform switches.
        </p>
      </section>
    );
  }

  const config = await getPlatformConfig();

  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-black tracking-tight">Platform settings</h1>
        <Link href="/app/system" className="text-sm font-semibold text-[var(--brand-600)]">
          Back to system
        </Link>
      </div>
      <p className="text-sm text-[var(--ink-muted)]">
        Organization context: {activeMembership.org.name}. Changes apply across the full platform.
      </p>
      <PlatformConfigForm
        initialConfig={{
          allowPublicSignup: config.allowPublicSignup,
          allowOrgCreate: config.allowOrgCreate,
          waitlistMode: config.waitlistMode,
          maintenanceMode: config.maintenanceMode,
          freezeProvisioning: config.freezeProvisioning,
          pauseProvisioningWorker: config.pauseProvisioningWorker,
          pauseEntitlementExpiryWorker: config.pauseEntitlementExpiryWorker,
          updatedAt: config.updatedAt.toISOString(),
        }}
      />
    </section>
  );
}
