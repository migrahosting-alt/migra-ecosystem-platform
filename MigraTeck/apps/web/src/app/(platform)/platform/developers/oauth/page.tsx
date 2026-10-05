import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ArrowLeft, Fingerprint, KeyRound, ShieldCheck } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { OAuthClientManager } from "./OAuthClientManager";

export const dynamic = "force-dynamic";

export default async function OAuthAppsPage() {
  ensureAuthClientInitialized();
  await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Developers / Identity integration"
        title="OAuth Apps"
        description="Register applications that use MigraAuth for sign-in. Control callback boundaries, scopes, PKCE, confidential credentials, and application lifecycle from one workspace."
        actions={
          <Link
            href="/platform/developers"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
          >
            <ArrowLeft size={14} /> Developer platform
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <Fingerprint size={19} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">MigraAuth-native</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            OAuth 2.1 authorization-code flows, OpenID Connect identity, and refresh-token rotation use the canonical identity authority.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <ShieldCheck size={19} className="text-emerald-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">PKCE enforced</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            New applications require PKCE. SPA and native clients remain public clients and never receive a reusable client secret.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <KeyRound size={19} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">Secret-safe lifecycle</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Confidential secrets are displayed only when issued or rotated. Lifecycle changes are recorded by MigraAuth audit events.
          </p>
        </article>
      </div>

      <OAuthClientManager />
    </div>
  );
}
