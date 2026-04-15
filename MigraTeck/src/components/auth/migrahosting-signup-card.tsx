import Link from "next/link";
import { MigraHostingAuthCard } from "./migrahosting-auth-card";
import { MigraHostingAuthShell } from "./migrahosting-auth-shell";

export function MigraHostingSignupCard({
  continueHref = "/api/auth/signup",
  loginHref = "/login",
}: {
  continueHref?: string;
  loginHref?: string;
}) {
  return (
    <MigraHostingAuthShell>
      <MigraHostingAuthCard
        title="Create your MigraHosting account"
        subtitle="Use your MigraTeck account to get started with hosting services."
        footer={(
          <div className="text-center text-sm text-white/55">
            Already have an account?{" "}
            <Link href={loginHref} className="font-semibold text-white transition hover:text-fuchsia-300">
              Sign in
            </Link>
          </div>
        )}
      >
        <Link
          href={continueHref}
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#ec4899_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.28)] transition duration-200 hover:scale-[0.995] hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Create account
        </Link>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="text-center text-xs leading-5 text-white/55">
            By continuing, you will create or use your MigraTeck identity for MigraHosting.
          </p>
        </div>
      </MigraHostingAuthCard>
    </MigraHostingAuthShell>
  );
}
