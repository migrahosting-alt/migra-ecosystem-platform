import Link from "next/link";
import { MembershipStatus } from "@prisma/client";
import { CreateOrgForm } from "@/components/app/create-org-form";
import { requireAuthSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export default async function OrganizationsPage() {
  const session = await requireAuthSession();

  const memberships = await prisma.membership.findMany({
    where: {
      userId: session.user.id,
      status: MembershipStatus.ACTIVE,
    },
    include: { org: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">Organizations</h1>
      <div className="grid gap-4 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          {memberships.map((membership) => (
            <article key={membership.id} className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">{membership.role}</p>
              <h2 className="mt-1 text-xl font-bold">{membership.org.name}</h2>
              <p className="text-sm text-[var(--ink-muted)]">{membership.org.slug}</p>
              <Link
                href={`/app/orgs/${membership.orgId}/settings`}
                className="mt-3 inline-block text-sm font-semibold text-[var(--brand-600)]"
              >
                Open settings
              </Link>
            </article>
          ))}
          {!memberships.length ? (
            <p className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-muted)]">
              No organizations yet.
            </p>
          ) : null}
        </div>
        <CreateOrgForm />
      </div>
    </section>
  );
}
