import Link from "next/link";
import { notFound } from "next/navigation";
import { getDriveTenantOpsDetail } from "@/lib/drive/drive-ops";
import { canAccessDriveTenantOrg, requireDriveOpsPageAccess } from "@/lib/drive/drive-ops-page-access";

function value(input: string | string[] | undefined): string | undefined {
  if (Array.isArray(input)) {
    return input[0];
  }

  return input;
}

function formatBytes(bytes: bigint | string | number, quotaGb?: number | null): string {
  const raw = typeof bytes === "bigint" ? bytes : BigInt(bytes);
  const gib = Number(raw) / (1024 * 1024 * 1024);
  const usage = `${gib.toFixed(gib >= 100 ? 0 : 2)} GiB`;
  return quotaGb ? `${usage} / ${quotaGb} GiB` : usage;
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

export default async function MigraDriveTenantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const access = await requireDriveOpsPageAccess();
  const { tenantId } = await params;
  const query = await searchParams;
  const detail = await getDriveTenantOpsDetail(tenantId);

  if (!detail) {
    notFound();
  }

  if (!canAccessDriveTenantOrg(access, detail.tenant.orgId)) {
    notFound();
  }

  const result = value(query.result);
  const error = value(query.error);
  const formAction = `/api/platform/migradrive/tenants/${detail.tenant.id}/actions`;

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-black tracking-tight">{detail.tenant.org.name}</h1>
            <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${badgeTone(detail.tenant.status)}`}>{detail.tenant.status}</span>
            <span className="inline-flex rounded-full border border-[var(--line)] bg-white px-2 py-1 text-xs font-semibold text-[var(--ink-muted)]">{detail.tenant.planCode}</span>
          </div>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">{detail.tenant.org.slug} · {detail.tenant.id}</p>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--brand-600)]">
          <Link href="/app/platform/migradrive/tenants">Back to tenants</Link>
          <Link href="/app/platform/migradrive/storage-health">Storage Health</Link>
        </div>
      </div>

      {result ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-700">{result}</p> : null}
      {error ? <p className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Usage</p><p className="mt-2 text-2xl font-black">{formatBytes(detail.tenant.storageUsedBytes, detail.tenant.storageQuotaGb)}</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Files</p><p className="mt-2 text-2xl font-black">{detail.summary?.activeFileCount ?? 0}</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Pending uploads</p><p className="mt-2 text-2xl font-black">{detail.summary?.pendingUploadCount ?? 0}</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Last cleanup</p><p className="mt-2 text-lg font-black">{detail.summary?.lastCleanupAt ? new Date(detail.summary.lastCleanupAt).toLocaleString() : "Never"}</p></article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <h2 className="text-lg font-bold">Tenant Overview</h2>
          <dl className="mt-3 space-y-2 text-sm text-[var(--ink-muted)]">
            <div className="flex justify-between gap-4"><dt>Org ID</dt><dd>{detail.tenant.orgId}</dd></div>
            <div className="flex justify-between gap-4"><dt>Subscription</dt><dd>{detail.tenant.subscriptionId || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Entitlement</dt><dd>{detail.tenant.entitlementId || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>External ref</dt><dd>{detail.tenant.externalRef || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Activated</dt><dd>{detail.tenant.activatedAt?.toISOString() || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Restricted</dt><dd>{detail.tenant.restrictedAt?.toISOString() || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Disabled</dt><dd>{detail.tenant.disabledAt?.toISOString() || "-"}</dd></div>
          </dl>
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-4 space-y-4">
          <div>
            <h2 className="text-lg font-bold">Lifecycle Actions</h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">Restricted and disabled actions are immediate; cleanup and reconcile write operation records.</p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <form method="post" action={formAction} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
              <input type="hidden" name="action" value="activate" />
              <p className="text-sm font-semibold">Activate</p>
              <input name="reason" placeholder="optional reason" className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
              <button className="rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white">Activate tenant</button>
            </form>
            <form method="post" action={formAction} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
              <input type="hidden" name="action" value="restrict" />
              <p className="text-sm font-semibold">Restrict</p>
              <input name="reason" placeholder="restriction reason" className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
              <button className="rounded-lg bg-amber-600 px-3 py-2 text-sm font-semibold text-white">Restrict tenant</button>
            </form>
            <form method="post" action={formAction} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
              <input type="hidden" name="action" value="disable" />
              <p className="text-sm font-semibold">Disable</p>
              <input name="reason" placeholder="disable reason" className="w-full rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
              <button className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-semibold text-white">Disable tenant</button>
            </form>
            <form method="post" action={formAction} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
              <input type="hidden" name="action" value="cleanup" />
              <p className="text-sm font-semibold">Cleanup</p>
              <p className="text-xs text-[var(--ink-muted)]">Remove stale pending uploads and write an operation entry.</p>
              <button className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white">Run cleanup</button>
            </form>
            <form method="post" action={formAction} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
              <input type="hidden" name="action" value="reconcile" />
              <p className="text-sm font-semibold">Reconcile</p>
              <p className="text-xs text-[var(--ink-muted)]">Run the provider-backed drift check against primary storage and tenant counters.</p>
              <button className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white">Run reconcile</button>
            </form>
            <form method="post" action={formAction} className="space-y-2 rounded-xl border border-[var(--line)] p-3">
              <input type="hidden" name="action" value="regenerate-previews" />
              <p className="text-sm font-semibold">Regenerate previews</p>
              <p className="text-xs text-[var(--ink-muted)]">Reserved for the derivative worker pipeline.</p>
              <button className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm font-semibold">Queue preview regen</button>
            </form>
          </div>
          <form method="post" action={formAction} className="space-y-3 rounded-xl border border-[var(--line)] p-3">
            <input type="hidden" name="action" value="update-plan" />
            <p className="text-sm font-semibold">Billing Linkage</p>
            <div className="grid gap-3 md:grid-cols-2">
              <input name="planCode" defaultValue={detail.tenant.planCode} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
              <input name="storageQuotaGb" type="number" min={1} defaultValue={detail.tenant.storageQuotaGb} className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
              <input name="subscriptionId" defaultValue={detail.tenant.subscriptionId || ""} placeholder="subscription ID" className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
              <input name="entitlementId" defaultValue={detail.tenant.entitlementId || ""} placeholder="entitlement ID" className="rounded-lg border border-[var(--line)] px-3 py-2 text-sm" />
            </div>
            <button className="rounded-lg bg-[var(--ink)] px-3 py-2 text-sm font-semibold text-white">Update plan + quota</button>
          </form>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Files</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Path</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">Size</th></tr></thead>
            <tbody>
              {detail.activeFiles.items.map((file) => (
                <tr key={file.id} className="border-t border-[var(--line)]"><td className="px-3 py-2 font-semibold">{file.fileName}</td><td className="px-3 py-2 text-[var(--ink-muted)]">{file.parentPath || "/"}</td><td className="px-3 py-2 text-[var(--ink-muted)]">{file.status}</td><td className="px-3 py-2 text-[var(--ink-muted)]">{formatBytes(file.sizeBytes)}</td></tr>
              ))}
              {!detail.activeFiles.items.length ? <tr><td colSpan={4} className="px-3 py-6 text-center text-[var(--ink-muted)]">No active or pending files.</td></tr> : null}
            </tbody>
          </table>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Trash</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]"><tr><th className="px-3 py-2">Name</th><th className="px-3 py-2">Deleted</th><th className="px-3 py-2">Size</th></tr></thead>
            <tbody>
              {detail.trashFiles.items.map((file) => (
                <tr key={file.id} className="border-t border-[var(--line)]"><td className="px-3 py-2 font-semibold">{file.fileName}</td><td className="px-3 py-2 text-[var(--ink-muted)]">{file.deletedAt?.toISOString() || "-"}</td><td className="px-3 py-2 text-[var(--ink-muted)]">{formatBytes(file.sizeBytes)}</td></tr>
              ))}
              {!detail.trashFiles.items.length ? <tr><td colSpan={3} className="px-3 py-6 text-center text-[var(--ink-muted)]">Trash is empty.</td></tr> : null}
            </tbody>
          </table>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Audit Timeline</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]"><tr><th className="px-3 py-2">Time</th><th className="px-3 py-2">Action</th><th className="px-3 py-2">Actor</th></tr></thead>
            <tbody>
              {detail.events.items.map((event) => (
                <tr key={event.id} className="border-t border-[var(--line)]"><td className="px-3 py-2 text-[var(--ink-muted)]">{event.createdAt.toISOString()}</td><td className="px-3 py-2 font-semibold">{event.action}</td><td className="px-3 py-2 text-[var(--ink-muted)]">{event.actorType}{event.actorId ? `:${event.actorId}` : ""}</td></tr>
              ))}
              {!detail.events.items.length ? <tr><td colSpan={3} className="px-3 py-6 text-center text-[var(--ink-muted)]">No tenant events recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </article>

        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <h2 className="border-b border-[var(--line)] px-4 py-3 text-lg font-bold">Operations</h2>
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]"><tr><th className="px-3 py-2">Started</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Status</th></tr></thead>
            <tbody>
              {detail.operations.items.map((operation) => (
                <tr key={operation.id} className="border-t border-[var(--line)]"><td className="px-3 py-2 text-[var(--ink-muted)]">{operation.startedAt.toISOString()}</td><td className="px-3 py-2 font-semibold">{operation.operationType}</td><td className="px-3 py-2 text-[var(--ink-muted)]">{operation.status}</td></tr>
              ))}
              {!detail.operations.items.length ? <tr><td colSpan={3} className="px-3 py-6 text-center text-[var(--ink-muted)]">No operations recorded yet.</td></tr> : null}
            </tbody>
          </table>
        </article>
      </div>
    </section>
  );
}