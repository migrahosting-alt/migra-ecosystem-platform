import { EntitlementStatus, MembershipStatus, ProductKey } from "@prisma/client";
import { notFound } from "next/navigation";
import { OrgEntitlementsEditor } from "@/components/app/org-entitlements-editor";
import { requireAuthSession } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { can } from "@/lib/rbac";
import { prisma } from "@/lib/prisma";

export default async function OrgEntitlementsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const session = await requireAuthSession();

  const membership = await prisma.membership.findFirst({
    where: {
      userId: session.user.id,
      orgId,
      status: MembershipStatus.ACTIVE,
    },
    include: {
      org: {
        select: {
          id: true,
          name: true,
          isMigraHostingClient: true,
        },
      },
    },
  });

  if (!membership) {
    notFound();
  }

  if (!can(membership.role, "org:entitlement:view")) {
    await writeAuditLog({
      userId: session.user.id,
      orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "org:entitlement:view",
      metadata: {
        route: "/app/orgs/[orgId]/entitlements",
        role: membership.role,
      },
    });

    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Organization entitlements</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Your role does not permit entitlement visibility.
        </p>
      </section>
    );
  }

  const currentRows = await prisma.orgEntitlement.findMany({
    where: { orgId },
    orderBy: { product: "asc" },
  });
  const byProduct = new Map(currentRows.map((row) => [row.product, row]));

  const initialRows = Object.values(ProductKey).map((product) => {
    const row = byProduct.get(product);
    return {
      product,
      status: row?.status || EntitlementStatus.RESTRICTED,
      startsAt: row?.startsAt?.toISOString() || null,
      endsAt: row?.endsAt?.toISOString() || null,
      notes: row?.notes || null,
      updatedAt: row?.updatedAt?.toISOString() || null,
    };
  });

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">{membership.org.name} entitlements</h1>
      <p className="text-sm text-[var(--ink-muted)]">
        Configure product access status, optional validity windows, and operator notes.
      </p>
      <OrgEntitlementsEditor
        orgId={orgId}
        canEdit={can(membership.role, "org:entitlement:edit")}
        isMigraHostingClient={membership.org.isMigraHostingClient}
        initialRows={initialRows}
      />
    </section>
  );
}
