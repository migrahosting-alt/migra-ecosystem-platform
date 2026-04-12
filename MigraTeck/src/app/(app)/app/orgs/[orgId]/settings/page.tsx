import { MembershipStatus } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { OrgInvitesPanel } from "@/components/app/org-invites-panel";
import { requireAuthSession } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { canManageOrg } from "@/lib/rbac";

export default async function OrganizationSettingsPage({ params }: { params: Promise<{ orgId: string }> }) {
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
        include: {
          entitlements: true,
          invites: {
            where: { acceptedAt: null },
            orderBy: { createdAt: "desc" },
          },
          memberships: {
            include: {
              user: {
                select: { id: true, email: true, name: true },
              },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });

  if (!membership) {
    notFound();
  }

  if (!canManageOrg(membership.role)) {
    await writeAuditLog({
      userId: session.user.id,
      orgId: membership.orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "org:manage",
      metadata: {
        route: "/app/orgs/[orgId]/settings",
        role: membership.role,
      },
    });

    return (
      <section className="space-y-4">
        <h1 className="text-3xl font-black tracking-tight">Organization settings</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          You need ADMIN or OWNER role to manage this organization.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">{membership.org.name} settings</h1>
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-lg font-bold">Profile</h2>
        <p className="mt-2 text-sm text-[var(--ink-muted)]">Slug: {membership.org.slug}</p>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          MigraHosting client: {membership.org.isMigraHostingClient ? "Yes" : "No"}
        </p>
      </article>
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-lg font-bold">Members</h2>
        <div className="mt-3 space-y-2 text-sm">
          {membership.org.memberships.map((member) => (
            <div key={member.id} className="flex items-center justify-between rounded-lg border border-[var(--line)] p-3">
              <div>
                <p className="font-semibold text-[var(--ink)]">{member.user.name || member.user.email}</p>
                <p className="text-[var(--ink-muted)]">{member.user.email}</p>
              </div>
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{member.role}</span>
            </div>
          ))}
        </div>
      </article>
      <OrgInvitesPanel
        orgId={orgId}
        initialInvites={membership.org.invites.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          expiresAt: invite.expiresAt.toISOString(),
          createdAt: invite.createdAt.toISOString(),
          isExpired: invite.expiresAt < new Date(),
        }))}
      />
      <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
        <h2 className="text-lg font-bold">Entitlements</h2>
        <Link href={`/app/orgs/${orgId}/entitlements`} className="mt-2 inline-block text-sm font-semibold text-[var(--brand-600)]">
          Open entitlement editor
        </Link>
        <div className="mt-3 space-y-2 text-sm">
          {membership.org.entitlements.map((entitlement) => (
            <div key={entitlement.id} className="flex items-center justify-between rounded-lg border border-[var(--line)] p-3">
              <span>{entitlement.product}</span>
              <span className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                {entitlement.status}
              </span>
            </div>
          ))}
          {!membership.org.entitlements.length ? (
            <p className="text-[var(--ink-muted)]">No product entitlements configured yet.</p>
          ) : null}
        </div>
      </article>
    </section>
  );
}
