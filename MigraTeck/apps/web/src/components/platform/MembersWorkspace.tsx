"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/cn";

type OrganizationMember = {
  id: string;
  role: string;
  status: string;
  joinedAt: string;
  user: {
    id: string;
    email: string;
    displayName?: string | null;
  };
};

type MembersWorkspaceProps = {
  orgId: string;
  orgName: string;
  canManageMembers: boolean;
  currentUserEmail: string;
  currentUserName?: string;
  currentUserRole?: string;
};

const roleOptions = [
  {
    value: "admin",
    label: "Admin",
    description: "Manage access, workflows, and operational controls inside the organization.",
  },
  {
    value: "billing_admin",
    label: "Billing admin",
    description: "Own invoices, subscriptions, tax, and payment administration.",
  },
  {
    value: "member",
    label: "Member",
    description: "Work inside the organization without administrative authority.",
  },
] as const;

function normalizeRoleValue(role: string) {
  return role.trim().toLowerCase().replace(/\s+/g, "_");
}

function formatRole(role: string) {
  return role.replace(/_/g, " ");
}

function getSafeErrorMessage(fallback: string) {
  return `${fallback} Refresh sign-in and try again.`;
}

export function MembersWorkspace({
  orgId,
  orgName,
  canManageMembers,
  currentUserEmail,
  currentUserName,
  currentUserRole,
}: MembersWorkspaceProps) {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [submitPending, setSubmitPending] = useState(false);
  const [submitMessage, setSubmitMessage] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [updatePendingId, setUpdatePendingId] = useState<string | null>(null);
  const [removePendingId, setRemovePendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      setLoading(true);
      setLoadError(null);

      try {
        const response = await fetch(`/api/platform/organizations/${orgId}/members`);
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          if (!cancelled) {
            setLoadError(getSafeErrorMessage("Team access is unavailable right now."));
          }
          return;
        }

        if (!cancelled) {
          setMembers(
            Array.isArray(payload?.members)
              ? payload.members.map((member: any) => ({
                  id: member.id,
                  role: member.role,
                  status: member.status,
                  joinedAt: member.joined_at,
                  user: {
                    id: member.user.id,
                    email: member.user.email,
                    displayName: member.user.display_name,
                  },
                }))
              : [],
          );
        }
      } catch {
        if (!cancelled) {
          setLoadError(getSafeErrorMessage("Team access is unavailable right now."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadMembers();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const visibleMembers = useMemo(() => {
    if (members.length > 0) {
      return members;
    }

    return [
      {
        id: "current-user",
        role: currentUserRole ?? "OWNER",
        status: "ACTIVE",
        joinedAt: new Date().toISOString(),
        user: {
          id: "current-user",
          email: currentUserEmail,
          displayName: currentUserName,
        },
      },
    ];
  }, [currentUserEmail, currentUserName, currentUserRole, members]);

  const ownerCount = visibleMembers.filter((member) => member.role === "OWNER").length;
  const adminCount = visibleMembers.filter((member) => ["OWNER", "ADMIN"].includes(member.role)).length;
  const billingCount = visibleMembers.filter((member) => member.role === "BILLING_ADMIN").length;

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitPending(true);
    setSubmitMessage(null);

    try {
      const response = await fetch(`/api/platform/organizations/${orgId}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, role }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setSubmitMessage(payload?.error ?? "Unable to add this member right now.");
        return;
      }

      if (payload?.member) {
        setMembers((current) => [
          ...current,
          {
            id: payload.member.id,
            role: payload.member.role,
            status: payload.member.status,
            joinedAt: payload.member.joined_at,
            user: {
              id: payload.member.user.id,
              email: payload.member.user.email,
              displayName: payload.member.user.display_name,
            },
          },
        ]);
      }

      setEmail("");
      setRole("member");
      setSubmitMessage("Member added to the organization.");
    } catch {
      setSubmitMessage("Unable to add this member right now.");
    } finally {
      setSubmitPending(false);
    }
  }

  async function handleRoleUpdate(memberId: string) {
    const nextRole = roleDrafts[memberId];
    if (!nextRole) {
      return;
    }

    setUpdatePendingId(memberId);
    setSubmitMessage(null);
    try {
      const response = await fetch(`/api/platform/organizations/${orgId}/members/${memberId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: nextRole }),
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setSubmitMessage(payload?.error ?? "Unable to update the member role right now.");
        return;
      }

      setMembers((current) => current.map((member) => (
        member.id === memberId
          ? {
              ...member,
              role: payload.member.role,
            }
          : member
      )));
      setRoleDrafts((current) => {
        const next = { ...current };
        delete next[memberId];
        return next;
      });
      setSubmitMessage("Member role updated.");
    } catch {
      setSubmitMessage("Unable to update the member role right now.");
    } finally {
      setUpdatePendingId(null);
    }
  }

  async function handleRemove(memberId: string) {
    setRemovePendingId(memberId);
    setSubmitMessage(null);
    try {
      const response = await fetch(`/api/platform/organizations/${orgId}/members/${memberId}`, {
        method: "DELETE",
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        setSubmitMessage(payload?.error ?? "Unable to remove this member right now.");
        return;
      }

      setMembers((current) => current.filter((member) => member.id !== memberId));
      setSubmitMessage("Member removed from the organization.");
    } catch {
      setSubmitMessage("Unable to remove this member right now.");
    } finally {
      setRemovePendingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Membership</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{visibleMembers.length}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">Active members currently attached to {orgName}.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Administrative coverage</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{adminCount}</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">{ownerCount} owner{ownerCount === 1 ? "" : "s"}, {billingCount} billing admin{billingCount === 1 ? "" : "s"}.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Access workflow</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Direct add</p>
          <p className="mt-2 text-sm leading-6 text-slate-500">Existing MigraAuth users can be added immediately. Invitation tracking is not yet exposed by the auth service.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="text-sm font-semibold text-slate-900">Members in {orgName}</h2>
          <p className="mt-1 text-sm text-slate-500">
            Team access is enforced centrally through MigraAuth and reflected here as the organization control surface.
          </p>
        </div>

        {loading ? (
          <div className="px-6 py-10 text-sm text-slate-500">Loading members...</div>
        ) : loadError ? (
          <div className="px-6 py-10 text-sm text-rose-600">{loadError}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Member</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Role</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Status</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Joined</th>
                  <th className="px-6 py-3 text-left text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {visibleMembers.map((member) => {
                  const isCurrentUser = member.user.email === currentUserEmail;
                  const lockedRole = isCurrentUser || member.role === "OWNER" || !canManageMembers;
                  const draftRole = roleDrafts[member.id] ?? normalizeRoleValue(member.role);

                  return (
                    <tr key={member.id}>
                      <td className="px-6 py-4">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-slate-900">
                              {member.user.displayName ?? member.user.email.split("@")[0]}
                            </p>
                            {isCurrentUser ? (
                              <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700">
                                You
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-slate-500">{member.user.email}</p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        {lockedRole ? (
                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-700">
                            {formatRole(member.role)}
                          </span>
                        ) : (
                          <select
                            value={draftRole}
                            onChange={(event) => setRoleDrafts((current) => ({
                              ...current,
                              [member.id]: event.target.value,
                            }))}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
                          >
                            {roleOptions.map((option) => (
                              <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
                            member.status === "ACTIVE"
                              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border border-amber-200 bg-amber-50 text-amber-700",
                          )}
                        >
                          {member.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{new Date(member.joinedAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4">
                        {lockedRole ? (
                          <span className="text-xs text-slate-400">Role locked</span>
                        ) : (
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void handleRoleUpdate(member.id)}
                              disabled={updatePendingId === member.id || draftRole === normalizeRoleValue(member.role)}
                              className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {updatePendingId === member.id ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemove(member.id)}
                              disabled={removePendingId === member.id}
                              className="rounded-full border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50"
                            >
                              {removePendingId === member.id ? "Removing..." : "Remove"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">Add member</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          Add an existing MigraAuth user by email and assign a platform role immediately.
        </p>
        <form className="mt-5 grid gap-4 md:grid-cols-[1.3fr_0.7fr_auto]" onSubmit={handleInvite}>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="teammate@example.com"
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
            required
          />
          <select
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15"
          >
            {roleOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="submit"
            disabled={submitPending}
            className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-60"
          >
            {submitPending ? "Adding..." : "Add member"}
          </button>
        </form>
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          {roleOptions.map((option) => (
            <div key={option.value} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-600">{option.label}</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">{option.description}</p>
            </div>
          ))}
        </div>
        {submitMessage ? <p className="mt-4 text-sm text-slate-600">{submitMessage}</p> : null}
      </div>
    </div>
  );
}
