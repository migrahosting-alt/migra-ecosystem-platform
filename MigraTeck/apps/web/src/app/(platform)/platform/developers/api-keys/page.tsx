import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ArrowLeft, KeyRound, ShieldCheck } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { ApiKeyManager } from "./ApiKeyManager";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Developers / Machine access"
        title="API Keys"
        description="Create, scope, expire, audit, and revoke organization-level machine credentials. Secrets are displayed once and only their hashes are stored."
        actions={
          <Link
            href="/platform/developers"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Developer platform
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <KeyRound size={18} className="text-blue-600" />
          <p className="mt-3 text-sm font-semibold text-slate-950">Hashed at rest</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">The full secret is never stored and cannot be recovered later.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={18} className="text-emerald-600" />
          <p className="mt-3 text-sm font-semibold text-slate-950">Organization scoped</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">Only active organization owners and admins can issue or revoke keys.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={18} className="text-violet-600" />
          <p className="mt-3 text-sm font-semibold text-slate-950">Audited lifecycle</p>
          <p className="mt-1 text-sm leading-6 text-slate-600">Creation and revocation are written to the platform audit trail.</p>
        </div>
      </div>

      <ApiKeyManager />
    </div>
  );
}
