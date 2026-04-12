import Link from "next/link";
import { getDriveStorageHealth, listDriveTenantsForOps } from "@/lib/drive/drive-ops";
import { requireDriveOpsPageAccess } from "@/lib/drive/drive-ops-page-access";

function value(input: string | string[] | undefined): string | undefined {
  if (Array.isArray(input)) {
    return input[0];
  }

  return input;
}

function formatBytes(bytes: bigint | string | number, quotaGb?: number | null): string {
  const raw = typeof bytes === "bigint" ? bytes : BigInt(bytes);
  const gib = Number(raw) / (1024 * 1024 * 1024);
  const usage = `${gib.toFixed(gib >= 100 ? 0 : 2)} GiB used`;

  if (!quotaGb) {
    return usage;
  }

  return `${usage} / ${quotaGb} GiB quota`;
}

function badgeTone(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "RESTRICTED":
      return "bg-amber-50 text-amber-800 border-amber-200";
    case "DISABLED":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export default async function MigraDriveTenantsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireDriveOpsPageAccess();
  const params = await searchParams;
  const scopedOrgId = access.platformOwner ? value(params.orgId) : access.activeOrg?.orgId;

  const filters = {
    query: value(params.q),
    status: value(params.status),
    planCode: value(params.planCode),
    orgId: scopedOrgId,
    limit: value(params.limit) ? Number(value(params.limit)) : 50,
  };

  const [tenants, health] = await Promise.all([
    listDriveTenantsForOps(filters),
    getDriveStorageHealth(),
  ]);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">MigraDrive Ops</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Internal tenant search, lifecycle controls, and storage diagnostics.</p>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--brand-600)]">
          <Link href="/app/platform/migradrive/storage-health">Storage Health</Link>
          <Link href="/app/platform/migradrive/operations">Operations</Link>
          <Link href="/app/platform/migradrive/reconciliation">Reconciliation</Link>
        </div>
      </div>

      <form className="grid gap-3 rounded-2xl border border-[var(--line)] bg-white p-4 md:grid-cols-5">
        <label className="text-sm md:col-span-2">
          <span className="mb-1 block text-[var(--ink-muted)]">Search</span>
          <input name="q" defaultValue={value(params.q) || ""} placeholder="tenant ID, org slug, subscription, entitlement, email" className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Status</span>
          <select name="status" defaultValue={value(params.status) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2">
            <option value="">Any</option>
            <option value="PENDING">Pending</option>
            <option value="ACTIVE">Active</option>
            <option value="RESTRICTED">Restricted</option>
            <option value="DISABLED">Disabled</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Plan</span>
          <input name="planCode" defaultValue={value(params.planCode) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        {access.platformOwner ? (
          <label className="text-sm">
            <span className="mb-1 block text-[var(--ink-muted)]">Org ID</span>
            <input name="orgId" defaultValue={value(params.orgId) || ""} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
          </label>
        ) : (
          <input type="hidden" name="orgId" value={access.activeOrg?.orgId || ""} />
        )}
        <div className="md:col-span-5 flex justify-end">
          <button type="submit" className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white">Search tenants</button>
        </div>
      </form>

      <div className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Tenants</p>
          <p className="mt-2 text-3xl font-black">{health.tenants.total}</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Live files</p>
          <p className="mt-2 text-3xl font-black">{health.files.active}</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Pending uploads</p>
          <p className="mt-2 text-3xl font-black">{health.files.pending}</p>
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <p className="text-xs uppercase text-[var(--ink-muted)]">Storage used</p>
          <p className="mt-2 text-3xl font-black">{formatBytes(health.storageUsedBytes)}</p>
        </article>
      </div>

      <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
        <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Tenant Search</h2>
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            <tr>
              <th className="px-3 py-2">Tenant</th>
              <th className="px-3 py-2">Org</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2">Usage</th>
              <th className="px-3 py-2">Links</th>
            </tr>
          </thead>
          <tbody>
            {tenants.items.map((tenant) => (
              <tr key={tenant.id} className="border-t border-[var(--line)] align-top">
                <td className="px-3 py-3">
                  <p className="font-semibold">{tenant.id}</p>
                  <p className="text-xs text-[var(--ink-muted)]">subscription {tenant.subscriptionId || "-"}</p>
                  <p className="text-xs text-[var(--ink-muted)]">entitlement {tenant.entitlementId || "-"}</p>
                </td>
                <td className="px-3 py-3 text-[var(--ink-muted)]">
                  <p>{tenant.org.name}</p>
                  <p>{tenant.orgSlug}</p>
                </td>
                <td className="px-3 py-3">
                  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeTone(tenant.status)}`}>
                    {tenant.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-[var(--ink-muted)]">{tenant.planCode}</td>
                <td className="px-3 py-3 text-[var(--ink-muted)]">{formatBytes(tenant.storageUsedBytes, tenant.storageQuotaGb)}</td>
                <td className="px-3 py-3">
                  <Link href={`/app/platform/migradrive/tenants/${tenant.id}`} className="font-semibold text-[var(--brand-600)]">
                    Open tenant
                  </Link>
                </td>
              </tr>
            ))}
            {!tenants.items.length ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-[var(--ink-muted)]">No tenants matched the current filters.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </article>
    </section>
  );
}