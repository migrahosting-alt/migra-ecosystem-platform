import Link from "next/link";
import { listDriveOperationsForOps } from "@/lib/drive/drive-ops";
import { requireDriveOpsPageAccess } from "@/lib/drive/drive-ops-page-access";

function value(input: string | string[] | undefined): string | undefined {
  if (Array.isArray(input)) {
    return input[0];
  }

  return input;
}

export default async function MigraDriveOperationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireDriveOpsPageAccess();
  const params = await searchParams;
  const { items } = await listDriveOperationsForOps({
    orgId: access.platformOwner ? value(params.orgId) : access.activeOrg?.orgId,
    operationType: value(params.operationType),
    status: value(params.status),
    limit: value(params.limit) ? Number(value(params.limit)) : 100,
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Operations Feed</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Recent lifecycle, cleanup, and reconciliation actions across MigraDrive tenants.</p>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--brand-600)]">
          <Link href="/app/platform/migradrive/tenants">Tenant Search</Link>
          <Link href="/app/platform/migradrive/reconciliation">Reconciliation</Link>
        </div>
      </div>

      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            <tr>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Operation</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Error</th>
            </tr>
          </thead>
          <tbody>
            {items.map((operation) => (
              <tr key={operation.id} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 text-[var(--ink-muted)]">{operation.startedAt.toISOString()}</td>
                <td className="px-3 py-2 font-semibold">{operation.operationType}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{operation.status}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{operation.tenantId || "-"}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{operation.errorCode || operation.errorMessage || "-"}</td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-[var(--ink-muted)]">No operations recorded yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>
    </section>
  );
}