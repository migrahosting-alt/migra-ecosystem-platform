import { OrgRole } from "@prisma/client";
import Link from "next/link";
import { writeAuditLog } from "@/lib/audit";
import { getActiveOrgContext, requireAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export default async function SystemPage() {
  const session = await requireAuthSession();
  const membership = await getActiveOrgContext(session.user.id);

  if (!membership) {
    return (
      <p className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-muted)]">
        Organization context is required to view system telemetry.
      </p>
    );
  }

  if (membership.role !== OrgRole.OWNER) {
    await writeAuditLog({
      userId: session.user.id,
      orgId: membership.orgId,
      action: "AUTHZ_PERMISSION_DENIED",
      entityType: "permission",
      entityId: "system:read",
      metadata: {
        route: "/app/system",
        role: membership.role,
      },
    });

    return (
      <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Owner role required. System telemetry is restricted to platform owners.
      </p>
    );
  }

  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setDate(twentyFourHoursAgo.getDate() - 1);

  const [totalUsers, totalOrgs, activeSessions, loginFailures24h, launchTokenIssued24h] = await Promise.all([
    prisma.user.count(),
    prisma.organization.count(),
    prisma.session.count({
      where: {
        expires: { gt: new Date() },
      },
    }),
    prisma.auditLog.count({
      where: {
        action: { in: ["AUTH_LOGIN_FAILED", "AUTH_LOGIN_RATE_LIMITED"] },
        createdAt: { gte: twentyFourHoursAgo },
      },
    }),
    prisma.auditLog.count({
      where: {
        action: "PRODUCT_LAUNCH_TOKEN_ISSUED",
        createdAt: { gte: twentyFourHoursAgo },
      },
    }),
  ]);

  const metrics = [
    { label: "Total users", value: totalUsers },
    { label: "Total organizations", value: totalOrgs },
    { label: "Active sessions", value: activeSessions },
    { label: "Login failures (24h)", value: loginFailures24h },
    { label: "Launch token issuance (24h)", value: launchTokenIssued24h },
  ];

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">System telemetry</h1>
      <p className="text-sm text-[var(--ink-muted)]">
        Internal platform metrics for live operational visibility. Scope: ecosystem-level control plane.
      </p>
      <Link href="/app/platform/settings" className="inline-block text-sm font-semibold text-[var(--brand-600)]">
        Open platform switches
      </Link>
      <Link href="/app/platform/ops" className="ml-4 inline-block text-sm font-semibold text-[var(--brand-600)]">
        Open operations explorer
      </Link>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {metrics.map((metric) => (
          <article key={metric.label} className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{metric.label}</p>
            <p className="mt-2 text-3xl font-black tracking-tight text-[var(--ink)]">{metric.value}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
