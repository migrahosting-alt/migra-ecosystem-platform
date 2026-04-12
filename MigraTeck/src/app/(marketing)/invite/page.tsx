import { InviteAcceptCard } from "@/components/marketing/invite-accept-card";
import { getAuthSession } from "@/lib/auth/session";

interface InvitePageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function InvitePage({ searchParams }: InvitePageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <section className="mx-auto max-w-2xl space-y-4 px-6 py-16">
        <h1 className="text-4xl font-black tracking-tight">Invitation link required</h1>
        <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          This invitation is missing a token. Request a new invite link from your organization admin.
        </p>
      </section>
    );
  }

  const session = await getAuthSession();

  return (
    <section className="mx-auto max-w-2xl space-y-4 px-6 py-16">
      <h1 className="text-4xl font-black tracking-tight">Organization invitation</h1>
      <p className="text-sm text-[var(--ink-muted)]">Accept access to the organization workspace using your invited email address.</p>
      <InviteAcceptCard token={token} authenticated={Boolean(session?.user?.id)} />
    </section>
  );
}
