import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import { ShieldCheck, BookOpenCheck, KeyRound, Activity, ArrowRight } from "lucide-react";
import { ensureAuthClientInitialized } from "@/lib/auth/init";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";

export const dynamic = "force-dynamic";

export default async function TrustOverviewPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  return (
    <div className="p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Security & governance"
        title="Trust"
        description="Identity assurance, sessions, delegated authority, audit evidence, compliance posture, and platform security controls belong to one governance domain."
        actions={
          <Link
            href="/platform/security"
            className="inline-flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700"
          >
            Open security <ArrowRight size={15} />
          </Link>
        }
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600"><ShieldCheck size={19} /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-950">Identity & Sessions</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">MigraAuth owns user identity, credentials, MFA, active sessions, platform roles, organization memberships, and OAuth authorization.</p>
          <Link href="/platform/security" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">Review security <ArrowRight size={14} /></Link>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-600"><BookOpenCheck size={19} /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-950">Compliance & Audit</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">Privileged changes must remain attributable: who changed access, credentials, billing state, configuration, or lifecycle controls and when.</p>
          <Link href="/platform/compliance" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">Open audit <ArrowRight size={14} /></Link>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600"><KeyRound size={19} /></span>
          <h2 className="mt-4 text-base font-semibold text-slate-950">Machine Trust</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">API keys, OAuth clients, service identities, scopes, signing secrets, and environment isolation are governed here even when their creation UX lives in Developers.</p>
          <Link href="/platform/developers" className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-blue-600">Developer access <ArrowRight size={14} /></Link>
        </article>
      </div>

      <section className="mt-6 rounded-2xl border border-slate-200 bg-[linear-gradient(135deg,#f8fafc,#f4f8ff)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <Activity size={19} className="text-blue-600" />
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Current authority session</p>
            <p className="mt-1 text-sm font-semibold text-slate-950">{session.email}</p>
          </div>
        </div>
        <p className="mt-4 max-w-4xl text-sm leading-6 text-slate-600">
          Authentication does not imply authorization. Platform roles and organization memberships remain separate authority layers, and every privileged surface must resolve the appropriate layer explicitly.
        </p>
      </section>
    </div>
  );
}
