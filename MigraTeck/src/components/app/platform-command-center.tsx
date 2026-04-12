import Link from "next/link";
import { LinkButton } from "@/components/ui/button";

type PlatformModule = {
  href: string;
  title: string;
  description: string;
  detail: string;
  tone: "default" | "success" | "attention";
};

interface PlatformCommandCenterProps {
  email: string | null | undefined;
  orgName: string;
  orgSlug: string;
  role: string;
  organizationCount: number;
  activeSessionCount: number;
  productsActive: number;
  auditCount7d: number;
  lastLoginLabel: string;
  modules: PlatformModule[];
}

const toneClass: Record<PlatformModule["tone"], string> = {
  default: "border-slate-200 bg-white text-slate-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  attention: "border-amber-200 bg-amber-50 text-amber-800",
};

export function PlatformCommandCenter({
  email,
  orgName,
  orgSlug,
  role,
  organizationCount,
  activeSessionCount,
  productsActive,
  auditCount7d,
  lastLoginLabel,
  modules,
}: PlatformCommandCenterProps) {
  return (
    <section className="space-y-6">
      <article className="overflow-hidden rounded-[2rem] border border-[var(--line)] bg-[radial-gradient(circle_at_top_left,rgba(15,122,216,0.12),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(147,51,234,0.10),transparent_30%),linear-gradient(180deg,#09111d,#122033)] p-6 text-white shadow-[0_24px_70px_rgba(10,22,40,0.25)] sm:p-8">
        <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr] xl:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-300/80">Control plane</p>
            <h1 className="mt-3 text-4xl font-black tracking-tight sm:text-5xl">One account, one organization graph, one operating surface.</h1>
            <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-300">
              MigraTeck should feel like the authority layer for identity, entitlements, billing, launches, audit, and product operations. This workspace is the shared control plane for {orgName}.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <LinkButton href="/app/products">Open product catalog</LinkButton>
              <LinkButton href="/app/orgs" variant="secondary" className="border-white/15 bg-white/10 text-white shadow-none hover:bg-white/15 hover:text-white">
                Manage organization
              </LinkButton>
              <LinkButton href="/app/billing" variant="secondary" className="border-white/15 bg-white/10 text-white shadow-none hover:bg-white/15 hover:text-white">
                Review billing
              </LinkButton>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Identity context</p>
              <p className="mt-2 text-lg font-semibold">{email || "No email available"}</p>
              <p className="mt-1 text-sm text-slate-400">{orgName} · {role}</p>
              <p className="mt-1 text-xs text-slate-500">Org slug {orgSlug}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Operator posture</p>
              <dl className="mt-3 grid gap-2 text-sm text-slate-300 sm:grid-cols-2 xl:grid-cols-2">
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Organizations</dt>
                  <dd className="mt-1 text-lg font-semibold text-white">{organizationCount}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Launch-ready products</dt>
                  <dd className="mt-1 text-lg font-semibold text-white">{productsActive}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Active sessions</dt>
                  <dd className="mt-1 text-lg font-semibold text-white">{activeSessionCount}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Audit events 7d</dt>
                  <dd className="mt-1 text-lg font-semibold text-white">{auditCount7d}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-slate-500">Last login {lastLoginLabel}</p>
            </div>
          </div>
        </div>
      </article>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {modules.map((module) => (
          <Link
            key={module.href}
            href={module.href}
            className="group rounded-2xl border border-[var(--line)] bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-1 hover:shadow-lg"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold tracking-tight text-[var(--ink)]">{module.title}</h2>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-muted)]">{module.description}</p>
              </div>
              <span className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${toneClass[module.tone]}`}>
                {module.tone === "success" ? "Ready" : module.tone === "attention" ? "Review" : "Open"}
              </span>
            </div>
            <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">{module.detail}</p>
            <p className="mt-4 text-sm font-semibold text-[var(--brand-600)] transition group-hover:text-[var(--brand-700)]">Open surface →</p>
          </Link>
        ))}
      </div>
    </section>
  );
}