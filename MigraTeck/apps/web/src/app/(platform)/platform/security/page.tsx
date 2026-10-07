import Link from "next/link";
import { requirePermission } from "@migrateck/auth-client";
import {
  KeyRound,
  MonitorSmartphone,
  ShieldCheck,
} from "lucide-react";
import { PlatformPageHeader } from "@/components/platform/PlatformPageHeader";
import { PlatformStatCard } from "@/components/platform/PlatformStatCard";
import { SecurityWorkspace } from "@/components/platform/SecurityWorkspace";
import { ensureAuthClientInitialized } from "@/lib/auth/init";

export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  ensureAuthClientInitialized();
  const session = await requirePermission("platform.read");

  return (
    <div className="p-5 sm:p-6 lg:p-8">
      <PlatformPageHeader
        eyebrow="Trust / Your identity"
        title="Security"
        description="Secure your own MigraAuth identity: sessions, authenticator MFA, recovery codes, connected sign-in providers, and password credentials. Platform-wide account investigation and containment remain in Trust Operations."
        actions={
          <Link
            href="/platform/trust"
            className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <ShieldCheck size={14} /> Open Trust Operations
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <PlatformStatCard
          label="Identity authority"
          value="MigraAuth"
          detail="Authentication, sessions, MFA, linked providers, and password credentials are enforced by the central identity service."
        />
        <PlatformStatCard
          label="Security scope"
          value="Your account"
          detail="Everything on this page is self-service for the signed-in identity; it does not grant tenant or platform authority."
        />
        <PlatformStatCard
          label="App session"
          value={new Date(session.expiresAt).toLocaleDateString()}
          detail={"Current Platform session began " + new Date(session.createdAt).toLocaleString() + "."}
        />
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <MonitorSmartphone size={18} className="text-blue-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Session and device control
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Review every visible MigraAuth session, revoke one device, or end all
            other browser sessions while keeping the current session.
          </p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <KeyRound size={18} className="text-violet-600" />
          <h2 className="mt-3 text-sm font-semibold text-slate-950">
            Credential redundancy
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Add a password or connected provider, enable TOTP, and keep recovery
            codes current so one lost credential does not become an account lockout.
          </p>
        </article>
      </div>

      <SecurityWorkspace sessionExpiresAt={session.expiresAt} />
    </div>
  );
}
