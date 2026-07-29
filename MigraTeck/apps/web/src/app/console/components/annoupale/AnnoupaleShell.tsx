import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { AnnoupaleSidebar } from "./AnnoupaleSidebar";
import { AnnoupaleMobileNav } from "./AnnoupaleMobileNav";
import { AnnoupaleTopbar } from "./AnnoupaleTopbar";

/**
 * Dedicated AnnouPale Trust & Operations shell — a self-contained sub-console
 * inside MigraPanel (its own sidebar + top bar + staff banner), replacing the
 * generic ConsolePageShell for every /console/annoupale/* page.
 *
 * Auth is still the MigraPanel console session (each page checks getSession and
 * redirects to /console/login). The shell only renders chrome; it holds no
 * secrets and performs no data fetching of its own.
 */

export type AnnoupaleShellSession = { email: string };

const OPERATOR_ROLE = "Trust & Safety";

function operatorName(email: string): string {
  const local = email.split("@")[0] || "Operator";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ") || "Operator";
}

export function AnnoupaleShell({
  session,
  title,
  subtitle,
  breadcrumb,
  actions,
  attentionCount = null,
  defaultQuery,
  children,
}: {
  session: AnnoupaleShellSession;
  title: string;
  subtitle?: string | undefined;
  breadcrumb?: ReactNode;
  actions?: ReactNode;
  attentionCount?: number | null;
  defaultQuery?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-[#070b16] text-slate-100">
      <AnnoupaleSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <AnnoupaleTopbar
          operatorName={operatorName(session.email)}
          operatorRole={OPERATOR_ROLE}
          attentionCount={attentionCount}
          defaultQuery={defaultQuery}
        />
        <main className="min-w-0 flex-1 space-y-5 p-5 lg:p-7">
          <AnnoupaleMobileNav />
          {breadcrumb && <div>{breadcrumb}</div>}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
              {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>

          <div className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-[12px] text-slate-300">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
            <p>
              <span className="font-medium text-slate-200">Staff-only. All actions may be audited.</span>{" "}
              Native compliance, appeals, moderation, audit, and analytics are served live from
              AnnouPale through the per-operator staff bridge.
            </p>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}
