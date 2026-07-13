import { redirect } from "next/navigation";
import { getSession } from "../../lib/auth";
import { resolveStaffIdentity } from "../../lib/mail-identity";
import { ConsolePageShell } from "../../components/ConsolePageShell";
import { MailAdminClient } from "./MailAdminClient";

export const dynamic = "force-dynamic";

export default async function MailSettingsPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const identity = await resolveStaffIdentity(session.email);
  if (identity?.role !== "super_admin") redirect("/console/mail");

  return (
    <ConsolePageShell
      session={{ email: session.email }}
      activePath="/console/mail"
      title="Mailbox access"
      subtitle="Register ecosystem mailboxes, manage staff, and assign per-mailbox permissions"
    >
      <MailAdminClient />
    </ConsolePageShell>
  );
}
