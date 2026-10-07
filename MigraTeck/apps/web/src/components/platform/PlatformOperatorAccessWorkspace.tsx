"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Crown,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  Users,
} from "lucide-react";

type PlatformRole = "support" | "operator" | "owner";

type Authority = {
  user_id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
};

type RoleGrant = {
  user_id: string;
  email: string | null;
  role: PlatformRole;
  granted_at: string;
  granted_by_user_id: string | null;
  note: string | null;
};

type OperatorPayload = {
  operator: boolean;
  canManageRoles: boolean;
  authority: Authority | null;
  grants: RoleGrant[];
  permissionCatalog: string[];
};

type UserResult = {
  id: string;
  email: string | null;
  status: string;
  email_verified: boolean;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
};

const ROLE_MODEL: Array<{
  role: PlatformRole;
  label: string;
  description: string;
  emphasis: string;
}> = [
  {
    role: "support",
    label: "Support",
    description:
      "Investigate users, commerce, trust, and platform evidence without broad mutation authority.",
    emphasis: "Read and investigate",
  },
  {
    role: "operator",
    label: "Operator",
    description:
      "Perform approved operational actions across platform services without deciding who gets authority.",
    emphasis: "Operate and resolve",
  },
  {
    role: "owner",
    label: "Owner",
    description:
      "Full platform authority, including granting and revoking MigraTeck operator roles.",
    emphasis: "Authority over authority",
  },
];

function roleClass(role: string) {
  if (role === "owner") return "border-violet-200 bg-violet-50 text-violet-700";
  if (role === "operator") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function PlatformOperatorAccessWorkspace() {
  const [data, setData] = useState<OperatorPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<UserResult[]>([]);
  const [searchPending, setSearchPending] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserResult | null>(null);
  const [role, setRole] = useState<PlatformRole>("support");
  const [note, setNote] = useState("");
  const [grantPending, setGrantPending] = useState(false);
  const [revokePending, setRevokePending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/platform/access/operator", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load platform operator access.");
      }
      setData(body);
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : "Unable to load platform operator access.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.canManageRoles || query.trim().length < 2) {
      setUsers([]);
      setSearchPending(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setSearchPending(true);
      try {
        const response = await fetch(
          "/api/platform/access/operator/users?q=" +
            encodeURIComponent(query.trim()),
          { cache: "no-store" },
        );
        const body = await response.json();
        if (!response.ok) {
          setMessage(body.error ?? "Unable to search MigraAuth users.");
          setUsers([]);
          return;
        }
        setUsers(body.users ?? []);
      } catch {
        setMessage("Unable to search MigraAuth users.");
        setUsers([]);
      } finally {
        setSearchPending(false);
      }
    }, 300);

    return () => window.clearTimeout(timer);
  }, [data?.canManageRoles, query]);

  const grantsByUser = useMemo(() => {
    const grouped = new Map<
      string,
      { userId: string; email: string | null; grants: RoleGrant[] }
    >();

    for (const grant of data?.grants ?? []) {
      const current = grouped.get(grant.user_id) ?? {
        userId: grant.user_id,
        email: grant.email,
        grants: [],
      };
      current.grants.push(grant);
      grouped.set(grant.user_id, current);
    }

    return [...grouped.values()].sort((a, b) =>
      String(a.email ?? a.userId).localeCompare(String(b.email ?? b.userId)),
    );
  }, [data?.grants]);

  async function grantRole() {
    if (!selectedUser) {
      setMessage("Select a MigraAuth user first.");
      return;
    }

    setGrantPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/platform/access/operator/roles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: selectedUser.id,
          role,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "Unable to grant platform role.");
        return;
      }

      setMessage(
        role.toUpperCase() +
          " granted to " +
          (selectedUser.email ?? selectedUser.display_name ?? selectedUser.id) +
          ".",
      );
      setSelectedUser(null);
      setQuery("");
      setUsers([]);
      setNote("");
      setRole("support");
      await load();
    } catch {
      setMessage("Unable to grant platform role.");
    } finally {
      setGrantPending(false);
    }
  }

  async function revokeRole(grant: RoleGrant) {
    const label = grant.email ?? grant.user_id;
    if (
      !window.confirm(
        "Revoke " +
          grant.role.toUpperCase() +
          " platform authority from " +
          label +
          "?",
      )
    ) {
      return;
    }

    const pendingKey = grant.user_id + ":" + grant.role;
    setRevokePending(pendingKey);
    setMessage(null);
    try {
      const response = await fetch("/api/platform/access/operator/roles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: grant.user_id,
          role: grant.role,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        setMessage(body.error ?? "Unable to revoke platform role.");
        return;
      }

      setMessage(
        grant.role.toUpperCase() +
          " revoked from " +
          (grant.email ?? grant.user_id) +
          ".",
      );
      await load();
    } catch {
      setMessage("Unable to revoke platform role.");
    } finally {
      setRevokePending(null);
    }
  }

  if (loading && !data) {
    return (
      <section
        id="platform-operator-access"
        className="grid min-h-64 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-violet-600" />
          Loading platform authority…
        </div>
      </section>
    );
  }

  if (loadError || !data) {
    return (
      <section
        id="platform-operator-access"
        className="rounded-3xl border border-rose-200 bg-rose-50 p-6"
      >
        <h2 className="font-semibold text-rose-950">
          Platform authority unavailable
        </h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {loadError ?? "Unable to resolve MigraAuth operator authority."}
        </p>
        <button
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  if (!data.operator || !data.authority) {
    return (
      <section
        id="platform-operator-access"
        className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
            MigraTeck operator plane
          </p>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
            No platform operator grant
          </h2>
        </div>
        <div className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[auto_1fr]">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
            <ShieldCheck size={21} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">
              This identity has organization access only.
            </p>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              Organization OWNER, ADMIN, BILLING_ADMIN, and MEMBER roles do not
              grant MigraTeck-wide authority. Platform operator roles are
              separate MigraAuth grants and are assigned only by a platform
              OWNER.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      id="platform-operator-access"
      className="space-y-6 rounded-3xl border border-slate-200 bg-[linear-gradient(180deg,#ffffff,#fafafa)] p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
            MigraTeck operator plane
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-slate-950">
            Platform operator access
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            These roles control MigraTeck-wide operational authority. They are
            independent from every customer or tenant organization membership.
          </p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={15} /> Refresh authority
        </button>
      </div>

      {data.authority.via_bootstrap ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold">Bootstrap authority is active</p>
            <p className="mt-1 text-xs leading-5">
              This operator is still receiving OWNER-equivalent authority from
              the bootstrap allowlist. Grant a persistent OWNER role and remove
              the bootstrap path when migration is complete.
            </p>
          </div>
        </div>
      ) : null}

      {message ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <AccessMetric
          icon={<BadgeCheck size={17} />}
          label="Your platform roles"
          value={
            data.authority.roles.length
              ? data.authority.roles.map((item) => item.toUpperCase()).join(" + ")
              : "None"
          }
          detail={data.authority.email ?? data.authority.user_id}
        />
        <AccessMetric
          icon={<KeyRound size={17} />}
          label="Effective permissions"
          value={String(data.authority.permissions.length)}
          detail="Resolved live from MigraAuth on every operator request."
        />
        <AccessMetric
          icon={<Crown size={17} />}
          label="Authority management"
          value={data.canManageRoles ? "OWNER enabled" : "OWNER required"}
          detail={
            data.canManageRoles
              ? "You can grant and revoke platform roles."
              : "Your role cannot widen anyone’s platform authority."
          }
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {ROLE_MODEL.map((item) => (
          <article
            key={item.role}
            className="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <span
                className={
                  "rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] " +
                  roleClass(item.role)
                }
              >
                {item.label}
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">
                {item.emphasis}
              </span>
            </div>
            <p className="mt-3 text-xs leading-5 text-slate-600">
              {item.description}
            </p>
          </article>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-4 sm:px-5">
          <h3 className="text-sm font-semibold text-slate-900">
            Your effective operator permissions
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            This is the live permission set returned by MigraAuth, not a UI
            approximation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 p-4 sm:p-5">
          {data.authority.permissions.map((permission) => (
            <code
              key={permission}
              className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600"
            >
              {permission}
            </code>
          ))}
        </div>
      </div>

      {data.canManageRoles ? (
        <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <div className="flex items-start gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600">
                <Users size={17} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Platform operator roster
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Live MigraAuth role grants. Revocations take effect on the
                  next authorized request.
                </p>
              </div>
            </div>

            {grantsByUser.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">
                No persistent platform role grants exist yet.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {grantsByUser.map((operator) => (
                  <div key={operator.userId} className="p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {operator.email ?? "MigraAuth user"}
                        </p>
                        <code className="mt-1 block truncate text-[10px] text-slate-400">
                          {operator.userId}
                        </code>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {operator.grants.map((grant) => (
                          <span
                            key={grant.user_id + ":" + grant.role}
                            className={
                              "rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] " +
                              roleClass(grant.role)
                            }
                          >
                            {grant.role}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {operator.grants.map((grant) => {
                        const pendingKey = grant.user_id + ":" + grant.role;
                        return (
                          <div
                            key={pendingKey}
                            className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div>
                              <p className="text-[11px] font-semibold text-slate-700">
                                {grant.role.toUpperCase()} · granted{" "}
                                {formatDate(grant.granted_at)}
                              </p>
                              <p className="mt-0.5 text-[10px] leading-4 text-slate-500">
                                {grant.note ?? "No grant note recorded."}
                              </p>
                            </div>
                            <button
                              onClick={() => void revokeRole(grant)}
                              disabled={revokePending === pendingKey}
                              className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                            >
                              {revokePending === pendingKey ? (
                                <Loader2 size={13} className="animate-spin" />
                              ) : (
                                <Trash2 size={13} />
                              )}
                              Revoke
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600">
                <UserRoundCog size={17} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Grant platform authority
                </h3>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Select an existing MigraAuth identity. This does not add the
                  person to any customer organization.
                </p>
              </div>
            </div>

            <div className="relative mt-5">
              <Search
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedUser(null);
                }}
                placeholder="Search name or email…"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm text-slate-900 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
              {searchPending ? (
                <Loader2
                  size={15}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                />
              ) : null}
            </div>

            {users.length > 0 && !selectedUser ? (
              <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                {users.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      setSelectedUser(user);
                      setQuery(user.email ?? user.display_name ?? user.id);
                      setUsers([]);
                    }}
                    className="block w-full border-b border-slate-100 px-3 py-3 text-left last:border-b-0 hover:bg-slate-50"
                  >
                    <p className="text-sm font-semibold text-slate-900">
                      {user.display_name ?? user.email ?? "MigraAuth user"}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {user.email ?? user.id}
                    </p>
                    <p className="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400">
                      {user.status} · {user.email_verified ? "verified" : "unverified"}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}

            {selectedUser ? (
              <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                <p className="text-xs font-semibold text-blue-950">
                  {selectedUser.display_name ??
                    selectedUser.email ??
                    "Selected MigraAuth user"}
                </p>
                <p className="mt-1 text-[10px] text-blue-700">
                  {selectedUser.email ?? selectedUser.id}
                </p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3">
              <label className="text-xs font-semibold text-slate-700">
                Platform role
                <select
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as PlatformRole)
                  }
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-400"
                >
                  <option value="support">Support</option>
                  <option value="operator">Operator</option>
                  <option value="owner">Owner</option>
                </select>
              </label>

              <label className="text-xs font-semibold text-slate-700">
                Grant reason
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  maxLength={300}
                  placeholder="Why does this person need this authority?"
                  className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:bg-white"
                />
              </label>

              <button
                onClick={() => void grantRole()}
                disabled={grantPending || !selectedUser}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {grantPending ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Plus size={15} />
                )}
                {grantPending ? "Granting…" : "Grant platform role"}
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-blue-900">
          Your operator authority is active, but only a platform OWNER can grant
          or revoke operator roles. This is intentional: the ability to operate
          the platform is separate from the ability to decide who may operate it.
        </div>
      )}
    </section>
  );
}

function AccessMetric({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-500">
        {icon}
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </p>
      </div>
      <p className="mt-2 break-words text-base font-semibold text-slate-950">
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}
