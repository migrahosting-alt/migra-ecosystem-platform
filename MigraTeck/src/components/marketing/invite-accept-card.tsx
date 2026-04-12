"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface InviteAcceptCardProps {
  token: string;
  authenticated: boolean;
}

export function InviteAcceptCard({ token, authenticated }: InviteAcceptCardProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function acceptInvite() {
    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/invites/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ token }),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    setLoading(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to accept invitation.");
      return;
    }

    setMessage("Invitation accepted. Redirecting to your app workspace...");
    router.push("/app");
    router.refresh();
  }

  if (!authenticated) {
    const encodedNext = encodeURIComponent(`/invite?token=${encodeURIComponent(token)}`);

    return (
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <p className="text-sm text-[var(--ink-muted)]">
          Sign in with the invited email address to accept this organization invitation.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`/login?next=${encodedNext}`} className="text-sm font-semibold text-[var(--brand-600)]">
            Log in to accept
          </Link>
          <Link href={`/signup?next=${encodedNext}`} className="text-sm font-semibold text-[var(--brand-600)]">
            Create account
          </Link>
        </div>
      </article>
    );
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
      <p className="text-sm text-[var(--ink-muted)]">You are signed in. Accept this invitation to join the organization.</p>
      <div className="mt-4 flex items-center gap-3">
        <ActionButton disabled={loading} onClick={acceptInvite}>
          {loading ? "Accepting..." : "Accept invitation"}
        </ActionButton>
        {message ? <span className="text-sm text-green-700">{message}</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
    </article>
  );
}
