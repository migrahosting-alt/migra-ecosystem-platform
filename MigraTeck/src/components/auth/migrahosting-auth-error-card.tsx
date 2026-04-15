import Link from "next/link";
import { MigraHostingAuthCard } from "./migrahosting-auth-card";
import { MigraHostingAuthShell } from "./migrahosting-auth-shell";

export function MigraHostingAuthErrorCard({
  title = "We couldn’t complete sign-in",
  subtitle = "There was a problem while connecting your MigraTeck account to MigraHosting.",
  message = "Please try again. If the problem continues, contact support.",
  retryHref = "/login",
  supportHref = "mailto:support@migrateck.com",
}: {
  title?: string;
  subtitle?: string;
  message?: string;
  retryHref?: string;
  supportHref?: string;
}) {
  return (
    <MigraHostingAuthShell>
      <MigraHostingAuthCard title={title} subtitle={subtitle}>
        <div className="rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-4">
          <p className="text-sm leading-6 text-red-100/90">{message}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={retryHref}
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#ec4899_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.28)] transition duration-200 hover:scale-[0.995] hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Try again
          </Link>

          <Link
            href={supportHref}
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white/80 transition duration-200 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Contact support
          </Link>
        </div>
      </MigraHostingAuthCard>
    </MigraHostingAuthShell>
  );
}
