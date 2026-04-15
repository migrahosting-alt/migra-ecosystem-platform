import Link from "next/link";
import { MigraHostingAuthCard } from "@/components/auth/migrahosting-auth-card";
import { MigraHostingAuthShell } from "@/components/auth/migrahosting-auth-shell";

export default function LogoutSuccessPage() {
  return (
    <MigraHostingAuthShell>
      <MigraHostingAuthCard
        title="You’ve been signed out"
        subtitle="Your MigraHosting session has ended successfully."
      >
        <Link
          href="/login"
          className="inline-flex h-12 w-full items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#7c3aed_0%,#ec4899_100%)] px-4 text-sm font-semibold text-white shadow-[0_12px_30px_rgba(168,85,247,0.28)] transition duration-200 hover:scale-[0.995] hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/60 focus:ring-offset-2 focus:ring-offset-slate-950"
        >
          Sign in again
        </Link>
      </MigraHostingAuthCard>
    </MigraHostingAuthShell>
  );
}
