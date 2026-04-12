import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import { AuditExportPanel } from "@/components/app/audit-export-panel";
import { prisma } from "@/lib/prisma";
import { can, canViewAudit } from "@/lib/rbac";

export default async function AuditPage() {
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    return <p>No organization context available.</p>;
  }

  if (!canViewAudit(membership.role)) {
    await writeAuditLog({
      userId: session.user.id,
      orgId: membership.orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "audit:read",
      metadata: {
        route: "/app/audit",
        role: membership.role,
      },
    });

    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Your role does not permit audit visibility.
      </p>
    );
  }

  const events = await prisma.auditLog.findMany({
    where: { orgId: membership.orgId },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">Audit log</h1>
      {can(membership.role, "audit:export") ? <AuditExportPanel orgId={membership.orgId} /> : null}
      <div className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Entity</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-t border-[var(--line)]">
                <td className="px-4 py-3 text-[var(--ink-muted)]">{event.createdAt.toISOString()}</td>
                <td className="px-4 py-3 font-semibold text-[var(--ink)]">{event.action}</td>
                <td className="px-4 py-3 text-[var(--ink-muted)]">{event.userId || "system"}</td>
                <td className="px-4 py-3 text-[var(--ink-muted)]">{event.entityType || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
