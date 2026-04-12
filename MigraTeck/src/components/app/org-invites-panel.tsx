"use client";

import { OrgRole } from "@prisma/client";
import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface InviteRow {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
  isExpired: boolean;
}

interface OrgInvitesPanelProps {
  orgId: string;
  initialInvites: InviteRow[];
}

const inviteRoleOptions: OrgRole[] = [OrgRole.ADMIN, OrgRole.BILLING, OrgRole.MEMBER, OrgRole.READONLY];

export function OrgInvitesPanel({ orgId, initialInvites }: OrgInvitesPanelProps) {
  const [invites, setInvites] = useState<InviteRow[]>(initialInvites);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrgRole>(OrgRole.MEMBER);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);

  async function createInvite() {
    setSaving(true);
    setError(null);
    setMessage(null);
    setShareLink(null);

    const response = await fetch(`/api/orgs/${orgId}/invites`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, role }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; invite?: InviteRow; inviteLink?: string; emailSent?: boolean }
      | null;

    setSaving(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to create invite.");
      return;
    }

    if (payload?.invite) {
      setInvites((previous) => [payload.invite as InviteRow, ...previous]);
    }

    setMessage(payload?.emailSent ? "Invite email sent." : "Invite created.");
    setShareLink(payload?.inviteLink || null);
    setEmail("");
    setRole(OrgRole.MEMBER);
  }

  async function revokeInvite(inviteId: string) {
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/orgs/${orgId}/invites/${inviteId}`, {
      method: "DELETE",
    });

    const payload = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      setError(payload?.error || "Unable to revoke invite.");
      return;
    }

    setInvites((previous) => previous.filter((invite) => invite.id !== inviteId));
    setMessage("Invite revoked.");
  }

  async function resendInvite(inviteId: string) {
    setError(null);
    setMessage(null);
    setShareLink(null);

    const response = await fetch(`/api/orgs/${orgId}/invites/${inviteId}/resend`, {
      method: "POST",
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; invite?: { id: string; expiresAt: string }; inviteLink?: string; emailSent?: boolean }
      | null;

    if (!response.ok) {
      setError(payload?.error || "Unable to resend invite.");
      return;
    }

    if (payload?.invite) {
      setInvites((previous) =>
        previous.map((invite) =>
          invite.id === inviteId
            ? {
                ...invite,
                expiresAt: payload.invite?.expiresAt || invite.expiresAt,
                isExpired: false,
              }
            : invite,
        ),
      );
    }

    setMessage(payload?.emailSent ? "Invite email resent." : "Invite regenerated.");
    setShareLink(payload?.inviteLink || null);
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <h2 className="text-lg font-bold">Members & Invites</h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">Invite users by email and assign role before they join.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-[1.5fr_1fr_auto]">
        <input
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
        />
        <select
          value={role}
          onChange={(event) => setRole(event.target.value as OrgRole)}
          className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
        >
          {inviteRoleOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ActionButton disabled={saving || !email} onClick={() => void createInvite()}>
          {saving ? "Inviting..." : "Send invite"}
        </ActionButton>
      </div>
      {shareLink ? (
        <p className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] p-2 text-xs text-[var(--ink-muted)]">
          Manual share link: <span className="font-mono">{shareLink}</span>
        </p>
      ) : null}
      {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      <div className="mt-4 space-y-2">
        {!invites.length ? <p className="text-sm text-[var(--ink-muted)]">No pending invites.</p> : null}
        {invites.map((invite) => (
          <div key={invite.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-[var(--ink)]">{invite.email}</p>
                <p className="text-xs text-[var(--ink-muted)]">
                  Role: {invite.role} · Expires: {new Date(invite.expiresAt).toISOString()}
                </p>
              </div>
              <div className="flex gap-2">
                <ActionButton variant="secondary" onClick={() => void resendInvite(invite.id)}>
                  Resend
                </ActionButton>
                <ActionButton variant="secondary" onClick={() => void revokeInvite(invite.id)}>
                  Revoke
                </ActionButton>
              </div>
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
