import { prisma } from "@/lib/prisma";
import { requireAuthSession, getActiveOrgContext } from "@/lib/auth/session";
import Link from "next/link";

export default async function BuilderSitesPage() {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);

  if (!ctx) {
    return (
      <div className="py-12 text-center">
        <h2 className="text-xl font-semibold text-[var(--ink)]">No Organization Selected</h2>
        <p className="mt-2 text-[var(--ink-muted)]">Select an organization to manage your websites.</p>
      </div>
    );
  }

  const sites = await prisma.builderSite.findMany({
    where: { orgId: ctx.orgId, status: { not: "ARCHIVED" } },
    orderBy: { updatedAt: "desc" },
    include: {
      _count: { select: { pages: true, deployments: true } },
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--ink)]">Website Builder</h1>
          <p className="text-[var(--ink-muted)] mt-1">Create and manage websites for your organization.</p>
        </div>
        <Link
          href="/app/builder/sites/new"
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-600)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-700)] transition-colors"
        >
          + New Website
        </Link>
      </div>

      {sites.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-white p-12 text-center">
          <div className="text-4xl mb-4">🌐</div>
          <h3 className="text-lg font-semibold text-[var(--ink)]">No websites yet</h3>
          <p className="text-[var(--ink-muted)] mt-1 mb-6">
            Describe your business and we'll generate a professional website for you.
          </p>
          <Link
            href="/app/builder/sites/new"
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--brand-600)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--brand-700)] transition-colors"
          >
            Create Your First Website
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sites.map((site) => (
            <Link
              key={site.id}
              href={`/app/builder/sites/${site.id}/editor`}
              className="group rounded-xl border border-[var(--line)] bg-white p-5 hover:border-[var(--brand-500)] hover:shadow-sm transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <h3 className="font-semibold text-[var(--ink)] group-hover:text-[var(--brand-600)] transition-colors">
                  {site.name}
                </h3>
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    site.status === "PUBLISHED"
                      ? "bg-green-50 text-green-700"
                      : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {site.status.toLowerCase()}
                </span>
              </div>
              <p className="text-sm text-[var(--ink-muted)] mb-3 font-mono">{site.slug}</p>
              <div className="flex gap-4 text-xs text-[var(--ink-muted)]">
                <span>{site._count.pages} page{site._count.pages !== 1 ? "s" : ""}</span>
                <span>{site._count.deployments} deploy{site._count.deployments !== 1 ? "s" : ""}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
