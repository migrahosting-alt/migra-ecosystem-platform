import { MigraHostingAuthCard } from "./migrahosting-auth-card";
import { MigraHostingAuthShell } from "./migrahosting-auth-shell";

export function MigraHostingCallbackLoading() {
  return (
    <MigraHostingAuthShell>
      <MigraHostingAuthCard
        title="Signing you in"
        subtitle="We’re securely connecting your MigraTeck account to MigraHosting."
      >
        <div className="flex flex-col items-center justify-center py-2">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/15 border-t-fuchsia-400" />
          <p className="mt-5 text-center text-sm leading-6 text-white/60">
            Please wait while we complete your secure sign-in.
          </p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <p className="text-center text-xs leading-5 text-white/55">
            Do not close this window.
          </p>
        </div>
      </MigraHostingAuthCard>
    </MigraHostingAuthShell>
  );
}
