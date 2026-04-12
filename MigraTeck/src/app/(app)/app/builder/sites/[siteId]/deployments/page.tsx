import { prisma } from "@/lib/prisma";
import { requireAuthSession, getActiveOrgContext } from "@/lib/auth/session";
import { notFound } from "next/navigation";
import Link from "next/link";

type PageProps = { params: Promise<{ siteId: string }> };

export default async function DeploymentsPage({ params }: PageProps) {
  const session = await requireAuthSession();
  const ctx = await getActiveOrgContext(session.user.id);
  if (!ctx) return notFound();

  const { siteId } = await params;

  const site = await prisma.builderSite.findFirst({
    where: { id: siteId, orgId: ctx.orgId },
    select: { id: true, name: true, slug: true },
  });
  if (!site) return notFound();

  const deployments = await prisma.builderDeployment.findMany({
    where: { siteId },
    orderBy: { startedAt: "desc" },
    take: 50,
  });

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/app/builder/sites/${siteId}/editor`}
          className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
        >
          ← Back to Editor
        </Link>
        <span className="text-[var(--line)]">|</span>
        <h1 className="text-xl font-bold text-[var(--ink)]">
          Deployments — {site.name}
        </h1>
      </div>

      {deployments.length === 0 ? (
        <div className="rounded-xl border border-[var(--line)] bg-white p-8 text-center">
          <p className="text-[var(--ink-muted)]">No deployments yet. Publish your site to create the first deployment.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deployments.map((d) => (
            <div
              key={d.id}
              className="flex items-center justify-between rounded-xl border border-[var(--line)] bg-white px-5 py-4"
            >
              <div>
                <span className="font-medium text-[var(--ink)]">
                  Deployment
                </span>
                <span className="ml-3 text-sm text-[var(--ink-muted)]">
                  {new Date(d.startedAt).toLocaleString()}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {d.deployUrl && (
                  <a
                    href={d.deployUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[var(--brand-600)] hover:underline"
                  >
                    View →
                  </a>
                )}
                <span
                  className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                    d.status === "LIVE"
                      ? "bg-green-50 text-green-700"
                      : d.status === "FAILED"
                        ? "bg-red-50 text-red-700"
                        : d.status === "PENDING" || d.status === "BUILDING" || d.status === "DEPLOYING"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-gray-50 text-gray-600"
                  }`}
                >
                  {d.status.toLowerCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
