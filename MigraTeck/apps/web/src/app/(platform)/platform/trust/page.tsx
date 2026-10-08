import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  BookOpenCheck,
  KeyRound,
  ShieldCheck,
} from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { TrustOperationsWorkspace } from "@/components/platform/TrustOperationsWorkspace";

export const dynamic = "force-dynamic";

export default async function TrustOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const initialQuery = rawQuery?.trim().slice(0, 160) ?? "";

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Trust / Platform operations"
        title="Trust Operations"
        description="Investigate identity risk, inspect active sessions, contain compromised access, recover MFA, and review platform-wide authentication evidence from MigraAuth's operator authority."
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/platform/security"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <ShieldCheck size={14} /> My security
            </Link>
            <Link
              href="/platform/compliance"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <BookOpenCheck size={14} /> Audit view
            </Link>
            <Link
              href="/platform/developers"
              className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <KeyRound size={14} /> Machine trust
            </Link>
          </div>
        }
      />

      <TrustOperationsWorkspace initialQuery={initialQuery} />
    </div>
  );
}
