import Link from "next/link";
import { listDriveOperationsForOps } from "@/lib/drive/drive-ops";
import { requireDriveOpsPageAccess } from "@/lib/drive/drive-ops-page-access";

export default async function MigraDriveReconciliationPage() {
  const access = await requireDriveOpsPageAccess();
  const { items } = await listDriveOperationsForOps({
    orgId: access.platformOwner ? undefined : access.activeOrg?.orgId,
    operationType: "RECONCILE_TENANT",
    limit: 100,
  });

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Reconciliation</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Recorded tenant reconcile runs and drift preflight results.</p>
        </div>
        <Link href="/app/platform/migradrive/storage-health" className="text-sm font-semibold text-[var(--brand-600)]">Storage Health</Link>
      </div>

      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            <tr>
              <th className="px-3 py-2">Completed</th>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Summary</th>
            </tr>
          </thead>
          <tbody>
            {items.map((operation) => (
              <tr key={operation.id} className="border-t border-[var(--line)]">
                <td className="px-3 py-2 text-[var(--ink-muted)]">{operation.completedAt?.toISOString() || operation.startedAt.toISOString()}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{operation.tenantId || "-"}</td>
                <td className="px-3 py-2 font-semibold">{operation.status}</td>
                <td className="px-3 py-2 text-[var(--ink-muted)]">{operation.responseJson || operation.errorMessage || "-"}</td>
              </tr>
            ))}
            {!items.length ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-[var(--ink-muted)]">No reconciliation runs recorded yet.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>
    </section>
  );
}