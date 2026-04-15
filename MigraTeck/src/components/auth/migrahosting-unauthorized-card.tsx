import Link from "next/link";
import { MigraHostingAuthCard } from "./migrahosting-auth-card";
import { MigraHostingAuthShell } from "./migrahosting-auth-shell";

export function MigraHostingUnauthorizedCard({
  dashboardHref = "/app",
  loginHref = "/login",
}: {
  dashboardHref?: string;
  loginHref?: string;
}) {
  return (
    <MigraHostingAuthShell>
      <MigraHostingAuthCard
        title="Access not available"
        subtitle="Your account is signed in, but you do not have permission to view this area."
      >
        <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-4">
          <p className="text-sm leading-6 text-amber-100/90">
            Contact your organization administrator if you believe you should have access to this section.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            href={dashboardHref}
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#ec4899_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.28)] transition duration-200 hover:scale-[0.995] hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Back to dashboard
          </Link>

          <Link
            href={loginHref}
            className="inline-flex h-11 w-full items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm font-medium text-white/80 transition duration-200 hover:bg-white/[0.06] hover:text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:ring-offset-2 focus:ring-offset-slate-950"
          >
            Sign in again
          </Link>
        </div>
      </MigraHostingAuthCard>
    </MigraHostingAuthShell>
  );
}
