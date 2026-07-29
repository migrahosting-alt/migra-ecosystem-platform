import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "../lib/auth";
import { resolveStaffIdentity, isMailModuleConfigured } from "../lib/mail-identity";
import { ConsolePageShell } from "../components/ConsolePageShell";
import { SectionCard } from "../components/SectionCard";
import { MailClient } from "./MailClient";

export const dynamic = "force-dynamic";

export default async function MailPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const identity = await resolveStaffIdentity(session.email);
  const configured = isMailModuleConfigured();
  const isSuper = identity?.role === "super_admin";

  return (
    <ConsolePageShell
      session={{ email: session.email }}
      activePath="/console/mail"
      title="Mail"
      subtitle="Shared ecosystem mailboxes — you only see what you're authorized to use"
      actions={
        isSuper ? (
          <Link
            href="/console/mail/settings"
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:border-fuchsia-400/40 hover:bg-white/10"
          >
            Mailbox access
          </Link>
        ) : undefined
      }
    >
      {!configured ? (
        <SectionCard title="Mail module not configured">
          <p className="text-sm text-slate-400">
            The MigraMail integration is not configured on this server. Set{" "}
            <code className="text-slate-300">MIGRAMAIL_PANEL_API_BASE</code> and{" "}
            <code className="text-slate-300">MIGRAMAIL_PANEL_SECRET</code> in the console
            environment, then reload.
          </p>
        </SectionCard>
      ) : !identity ? (
        <SectionCard title="No mailbox access">
          <p className="text-sm text-slate-400">
            Your account has no mailbox access yet. Ask a Super Admin to assign you a
            mailbox under <span className="text-slate-300">Mailbox access</span>.
          </p>
        </SectionCard>
      ) : (
        <MailClient canManage={isSuper} me={identity.email} />
      )}
    </ConsolePageShell>
  );
}
