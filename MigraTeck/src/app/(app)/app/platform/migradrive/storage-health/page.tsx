import Link from "next/link";
import { getDriveStorageHealth } from "@/lib/drive/drive-ops";
import { requireDriveOpsPageAccess } from "@/lib/drive/drive-ops-page-access";

function formatBytes(bytes: string): string {
  const value = Number(BigInt(bytes)) / (1024 * 1024 * 1024);
  return `${value.toFixed(value >= 100 ? 0 : 2)} GiB`;
}

function bucketTone(status: string): string {
  switch (status) {
    case "ok":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "unreachable":
      return "bg-rose-50 text-rose-700 border-rose-200";
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

export default async function MigraDriveStorageHealthPage() {
  await requireDriveOpsPageAccess();
  const health = await getDriveStorageHealth();

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black tracking-tight">Storage Health</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">Backend configuration, bucket layout, and recent storage drift signals.</p>
        </div>
        <div className="flex items-center gap-3 text-sm font-semibold text-[var(--brand-600)]">
          <Link href="/app/platform/migradrive/tenants">Tenant Search</Link>
          <Link href="/app/platform/migradrive/operations">Operations</Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Upload provider</p><p className="mt-2 text-2xl font-black">{health.storage.uploadProvider}</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Download provider</p><p className="mt-2 text-2xl font-black">{health.storage.downloadProvider}</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Signed URL TTL</p><p className="mt-2 text-2xl font-black">{health.storage.signedUrlTtlSeconds}s</p></article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4"><p className="text-xs uppercase text-[var(--ink-muted)]">Storage used</p><p className="mt-2 text-2xl font-black">{formatBytes(health.storageUsedBytes)}</p></article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <h2 className="text-lg font-bold">Bucket Layout</h2>
          <dl className="mt-3 space-y-2 text-sm text-[var(--ink-muted)]">
            <div className="flex justify-between gap-4"><dt>Primary</dt><dd>{health.storage.buckets.primary || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Derivatives</dt><dd>{health.storage.buckets.derivatives || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Archive</dt><dd>{health.storage.buckets.archive || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Logs</dt><dd>{health.storage.buckets.logs || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Endpoint</dt><dd>{health.storage.endpoint || "-"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Region</dt><dd>{health.storage.region}</dd></div>
            <div className="flex justify-between gap-4"><dt>Provider reachable</dt><dd>{health.storage.providerReachable ? "yes" : "no"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Path style</dt><dd>{health.storage.forcePathStyle === null ? "-" : String(health.storage.forcePathStyle)}</dd></div>
            <div className="flex justify-between gap-4"><dt>Multipart min part</dt><dd>{health.storage.multipartMinPartSizeMb} MB</dd></div>
            <div className="flex justify-between gap-4"><dt>Max upload</dt><dd>{health.storage.maxUploadSizeMb} MB</dd></div>
          </dl>
          <div className="mt-4 space-y-2">
            {health.storage.bucketChecks.map((bucket) => (
              <div key={bucket.kind} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                <div>
                  <p className="font-semibold text-[var(--ink)]">{bucket.kind}</p>
                  <p className="text-[var(--ink-muted)]">{bucket.bucket || "not configured"}</p>
                </div>
                <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${bucketTone(bucket.status)}`}>
                  {bucket.status}
                </span>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <h2 className="text-lg font-bold">Health Signals</h2>
          <dl className="mt-3 space-y-2 text-sm text-[var(--ink-muted)]">
            <div className="flex justify-between gap-4"><dt>Tenants</dt><dd>{health.tenants.total}</dd></div>
            <div className="flex justify-between gap-4"><dt>Active files</dt><dd>{health.files.active}</dd></div>
            <div className="flex justify-between gap-4"><dt>Pending uploads</dt><dd>{health.files.pending}</dd></div>
            <div className="flex justify-between gap-4"><dt>Trash files</dt><dd>{health.files.deleted}</dd></div>
            <div className="flex justify-between gap-4"><dt>Drift status</dt><dd>{health.driftStatus}</dd></div>
            <div className="flex justify-between gap-4"><dt>Incomplete multipart uploads</dt><dd>{health.incompleteMultipartUploads ?? "unavailable"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Multipart support</dt><dd>{health.storage.multipartSupport ? "yes" : "no"}</dd></div>
          </dl>
          {health.storage.warnings.length ? (
            <ul className="mt-4 space-y-1 text-sm text-amber-800">
              {health.storage.warnings.map((warning) => (
                <li key={warning}>- {warning}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-emerald-700">No storage configuration warnings reported.</p>
          )}
          {health.storage.multipartSampleKeys.length ? (
            <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3 text-sm text-[var(--ink-muted)]">
              <p className="font-semibold text-[var(--ink)]">Multipart sample keys</p>
              <ul className="mt-2 space-y-1">
                {health.storage.multipartSampleKeys.map((key) => (
                  <li key={key}>{key}</li>
                ))}
              </ul>
              {health.storage.multipartListingTruncated ? <p className="mt-2 text-xs">List truncated to protect request-time inspection cost.</p> : null}
            </div>
          ) : null}
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <h2 className="text-lg font-bold">Last Reconciler Run</h2>
          {health.lastReconcilerRun ? (
            <div className="mt-3 text-sm text-[var(--ink-muted)]">
              <p className="font-semibold text-[var(--ink)]">{health.lastReconcilerRun.operationType} · {health.lastReconcilerRun.status}</p>
              <p>{(health.lastReconcilerRun.completedAt || health.lastReconcilerRun.startedAt).toISOString()}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No reconcile operation has been recorded yet.</p>
          )}
        </article>
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4">
          <h2 className="text-lg font-bold">Last Failed Storage Action</h2>
          {health.lastFailedStorageAction ? (
            <div className="mt-3 text-sm text-[var(--ink-muted)]">
              <p className="font-semibold text-[var(--ink)]">{health.lastFailedStorageAction.operationType} · {health.lastFailedStorageAction.status}</p>
              <p>{health.lastFailedStorageAction.errorCode || health.lastFailedStorageAction.errorMessage || "No additional detail."}</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[var(--ink-muted)]">No failed storage action has been recorded.</p>
          )}
        </article>
      </div>
    </section>
  );
}