import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  ArrowLeft,
  FileCheck2,
  PackageCheck,
  ShieldCheck,
  Warehouse,
} from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { DistributionWorkspace } from "./DistributionWorkspace";

export const dynamic = "force-dynamic";

export default async function DistributionPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Infrastructure / Software distribution"
        title="Releases & Downloads"
        description="Operate MigraTeck release artifacts as a supply chain: verify object-store bytes, register immutable release metadata, activate approved builds, deactivate compromised releases, and retain audit evidence."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/downloads"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Public downloads
            </Link>
            <Link
              href="/platform/overview"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <ArrowLeft size={14} /> Platform overview
            </Link>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <PackageCheck size={19} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Immutable registration</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Artifact size and SHA-256 are derived from object storage at registration instead of typed manually.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <FileCheck2 size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Verify before publish</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Activation streams the object again and fails closed if either the checksum or byte count changed.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Warehouse size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Private object store</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Release objects stay in MinIO/S3. Customers receive short-lived signed URLs only after entitlement checks.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-amber-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">No destructive delete</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Bad releases are deactivated with a reason. Historical metadata and audit evidence remain available.
          </p>
        </article>
      </div>

      <DistributionWorkspace />
    </div>
  );
}
