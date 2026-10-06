"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  KeyRound,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Unlock,
  UserRound,
  UserX,
  X,
} from "lucide-react";

type Authority = {
  user_id: string;
  email: string | null;
  roles: string[];
  permissions: string[];
  via_bootstrap: boolean;
};

type Overview = {
  authority: Authority;
  users: {
    active: number;
    locked: number;
    disabled: number;
    pending: number;
    total: number;
  };
  auditTotal: number;
};

type UserSummary = {
  id: string;
  email: string | null;
  status: "PENDING" | "ACTIVE" | "LOCKED" | "DISABLED";
  email_verified: boolean;
  display_name: string | null;
  created_at: string;
  last_login_at: string | null;
};

type Session = {
  id: string;
  client_id: string | null;
  device_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string | null;
  expires_at: string;
};

type AuditItem = {
  id: string;
  actor_user_id: string | null;
  actor_type: string;
  target_user_id: string | null;
  client_id: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type UserDetail = {
  user: UserSummary & {
    locked_at: string | null;
    disabled_at: string | null;
  };
  memberships: Array<{
    id: string;
    organization_id: string;
    organization_name: string;
    organization_slug: string;
    role: string;
    status: string;
    joined_at: string | null;
    created_at: string;
  }>;
  sessions: Session[];
  recent_audit: AuditItem[];
};

type UsersResponse = {
  users: UserSummary[];
  total: number;
  limit: number;
  offset: number;
};

type AuditResponse = {
  audit_logs: AuditItem[];
  total: number;
  limit: number;
  offset: number;
};

type ActionState = {
  type: "lock" | "unlock" | "disable" | "mfa-reset" | "session" | "sessions-all";
  userId: string;
  sessionId?: string;
  title: string;
  description: string;
};

const statusOptions = ["", "ACTIVE", "LOCKED", "DISABLED", "PENDING"] as const;

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function statusClass(status: string) {
  if (status === "ACTIVE") return "bg-emerald-50 text-emerald-700";
  if (status === "LOCKED") return "bg-amber-50 text-amber-700";
  if (status === "DISABLED") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

function eventClass(event: string) {
  if (/LOCK|DISABL|REVOK|RESET|DENIED|FAIL/i.test(event)) return "bg-rose-50 text-rose-700";
  if (/LOGIN|VERIFY|GRANT|CREATE|SUCCESS/i.test(event)) return "bg-emerald-50 text-emerald-700";
  return "bg-slate-100 text-slate-600";
}

export function TrustOperationsWorkspace() {
  const [tab, setTab] = useState<"accounts" | "audit">("accounts");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [audit, setAudit] = useState<AuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditEvent, setAuditEvent] = useState("");
  const [auditUser, setAuditUser] = useState("");
  const [auditClient, setAuditClient] = useState("");
  const [auditOffset, setAuditOffset] = useState(0);

  const [action, setAction] = useState<ActionState | null>(null);
  const [reason, setReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const permissions = useMemo(
    () => new Set(overview?.authority.permissions ?? []),
    [overview],
  );
  const canSuspend = permissions.has("platform.users.suspend");
  const canSessions = permissions.has("platform.users.sessions.manage");
  const canMfaReset = permissions.has("platform.users.mfa_reset");

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    try {
      const response = await fetch("/api/platform/trust/overview", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load Trust authority");
      setOverview(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load Trust authority");
    } finally {
      setOverviewLoading(false);
    }
  }, []);

  const loadUsers = useCallback(async (q: string, selectedStatus: string) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (q.trim()) params.set("q", q.trim());
      if (selectedStatus) params.set("status", selectedStatus);
      const response = await fetch("/api/platform/trust/users?" + params.toString(), {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load users");
      const typed = body as UsersResponse;
      setUsers(typed.users);
      setUsersTotal(typed.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load users");
    } finally {
      setUsersLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    setActionMessage(null);
    try {
      const response = await fetch("/api/platform/trust/users/" + encodeURIComponent(id), {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load user");
      setDetail(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load user");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const loadAudit = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params = new URLSearchParams({
        limit: "50",
        offset: String(auditOffset),
      });
      if (auditEvent.trim()) params.set("event_type", auditEvent.trim());
      if (auditUser.trim()) params.set("user_id", auditUser.trim());
      if (auditClient.trim()) params.set("client_id", auditClient.trim());
      const response = await fetch("/api/platform/trust/audit?" + params.toString(), {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load audit evidence");
      setAudit(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load audit evidence");
    } finally {
      setAuditLoading(false);
    }
  }, [auditClient, auditEvent, auditOffset, auditUser]);

  useEffect(() => {
    void loadOverview();
    void loadUsers("", "");
  }, [loadOverview, loadUsers]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadUsers(query, status);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadUsers, query, status]);

  useEffect(() => {
    if (tab === "audit") void loadAudit();
  }, [tab, loadAudit]);

  async function selectUser(id: string) {
    setSelectedUserId(id);
    await loadDetail(id);
  }

  function openAction(next: ActionState) {
    setAction(next);
    setReason("");
    setActionMessage(null);
  }

  async function executeAction() {
    if (!action || !reason.trim()) return;
    setActionBusy(true);
    setActionMessage(null);
    try {
      let endpoint: string;
      if (action.type === "session") {
        endpoint =
          "/api/platform/trust/users/" +
          encodeURIComponent(action.userId) +
          "/sessions/" +
          encodeURIComponent(action.sessionId ?? "") +
          "/revoke";
      } else if (action.type === "sessions-all") {
        endpoint =
          "/api/platform/trust/users/" +
          encodeURIComponent(action.userId) +
          "/sessions/revoke-all";
      } else {
        endpoint =
          "/api/platform/trust/users/" +
          encodeURIComponent(action.userId) +
          "/actions/" +
          encodeURIComponent(action.type);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? body.message ?? "Trust action failed");

      setActionMessage(body.message ?? "Action completed and audited.");
      setAction(null);
      setReason("");
      await Promise.all([
        loadOverview(),
        loadUsers(query, status),
        selectedUserId ? loadDetail(selectedUserId) : Promise.resolve(),
      ]);
    } catch (err) {
      setActionMessage(err instanceof Error ? err.message : "Trust action failed");
    } finally {
      setActionBusy(false);
    }
  }

  function exportAuditCsv() {
    const rows = audit?.audit_logs ?? [];
    if (!rows.length) return;
    const quote = (value: unknown) => {
      const text = value === null || value === undefined ? "" : String(value);
      return '"' + text.replaceAll('"', '""') + '"';
    };
    const header = [
      "created_at",
      "event_type",
      "actor_user_id",
      "target_user_id",
      "client_id",
      "ip_address",
      "user_agent",
      "event_data",
    ];
    const lines = [
      header.join(","),
      ...rows.map((item) =>
        [
          item.created_at,
          item.event_type,
          item.actor_user_id,
          item.target_user_id,
          item.client_id,
          item.ip_address,
          item.user_agent,
          JSON.stringify(item.event_data ?? {}),
        ]
          .map(quote)
          .join(","),
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "migrateck-trust-audit-" + new Date().toISOString().slice(0, 10) + ".csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (overviewLoading && !overview) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Resolving platform Trust authority…
        </div>
      </div>
    );
  }

  if (!overview) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Trust Operations unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "MigraAuth platform-operator authority is required."}
        </p>
        <button
          onClick={() => void loadOverview()}
          className="mt-4 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          Retry
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {overview.authority.via_bootstrap ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This session is still using MigraAuth bootstrap authority. Grant a persistent OWNER role before removing the bootstrap path.
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span>{error}</span>
          <button onClick={() => setError(null)} aria-label="Dismiss error">
            <X size={15} />
          </button>
        </div>
      ) : null}

      {actionMessage ? (
        <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
          {actionMessage}
        </div>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Accounts" value={overview.users.total} detail="MigraAuth identities" />
        <Metric label="Active" value={overview.users.active} detail="sign-in eligible" />
        <Metric label="Locked" value={overview.users.locked} detail="contained pending review" />
        <Metric label="Disabled" value={overview.users.disabled} detail="access disabled" />
        <Metric label="Audit events" value={overview.auditTotal} detail="identity evidence" />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
              <ShieldCheck size={18} />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Current platform authority</p>
              <p className="mt-1 text-sm font-semibold text-slate-950">
                {overview.authority.email ?? overview.authority.user_id}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {overview.authority.roles.map((role) => (
              <span key={role} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">
                {role}
              </span>
            ))}
          </div>
        </div>
      </section>

      <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        <button
          onClick={() => setTab("accounts")}
          className={
            "rounded-lg px-4 py-2 text-sm font-semibold transition " +
            (tab === "accounts" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50")
          }
        >
          Accounts & Sessions
        </button>
        <button
          onClick={() => setTab("audit")}
          className={
            "rounded-lg px-4 py-2 text-sm font-semibold transition " +
            (tab === "audit" ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-50")
          }
        >
          Audit Evidence
        </button>
      </div>

      {tab === "accounts" ? (
        <div className="grid min-h-[38rem] overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[0.72fr_1.28fr]">
          <section className="border-b border-slate-100 xl:border-b-0 xl:border-r">
            <div className="space-y-3 border-b border-slate-100 p-4 sm:p-5">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search email or name…"
                  className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm outline-none focus:border-blue-400 focus:bg-white"
                />
                {usersLoading ? <Loader2 size={15} className="absolute right-3.5 top-1/2 -translate-y-1/2 animate-spin text-slate-400" /> : null}
              </div>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"
              >
                {statusOptions.map((value) => (
                  <option key={value || "all"} value={value}>
                    {value || "All account states"}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{usersTotal.toLocaleString()} matching accounts</p>
            </div>

            <div className="max-h-[50rem] divide-y divide-slate-100 overflow-y-auto">
              {users.map((user) => (
                <button
                  key={user.id}
                  onClick={() => void selectUser(user.id)}
                  className={
                    "w-full p-4 text-left transition hover:bg-slate-50 " +
                    (selectedUserId === user.id ? "bg-blue-50/70" : "")
                  }
                >
                  <div className="flex items-start gap-3">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500">
                      <UserRound size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">
                        {user.display_name || user.email || "Unnamed account"}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-slate-500">{user.email ?? user.id}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + statusClass(user.status)}>
                          {user.status}
                        </span>
                        <span className="text-[10px] text-slate-400">
                          last login {formatDate(user.last_login_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="min-w-0">
            {detailLoading ? (
              <div className="grid min-h-[38rem] place-items-center text-sm text-slate-500">
                <span className="flex items-center gap-2"><Loader2 size={17} className="animate-spin" /> Loading identity evidence…</span>
              </div>
            ) : detail ? (
              <UserDetailPanel
                detail={detail}
                canSuspend={canSuspend}
                canSessions={canSessions}
                canMfaReset={canMfaReset}
                onAction={openAction}
              />
            ) : (
              <div className="grid min-h-[38rem] place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                    <ShieldAlert size={21} />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">Select an identity to investigate</h3>
                  <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                    Account state, organization memberships, active sessions, and recent audit evidence will appear here.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-5 sm:p-6">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">MigraAuth evidence</p>
                <h2 className="mt-1 text-lg font-semibold text-slate-950">Platform-wide audit timeline</h2>
                <p className="mt-1 text-sm text-slate-600">Server-side filters operate across the full audit ledger, not only the current operator.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void loadAudit()}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
                >
                  <RefreshCw size={14} className={auditLoading ? "animate-spin" : ""} /> Refresh
                </button>
                <button
                  onClick={exportAuditCsv}
                  disabled={!audit?.audit_logs.length}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                >
                  <Download size={14} /> Export page CSV
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <input
                value={auditEvent}
                onChange={(event) => { setAuditEvent(event.target.value); setAuditOffset(0); }}
                placeholder="Event type, e.g. ACCOUNT_LOCKED"
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-violet-400 focus:bg-white"
              />
              <input
                value={auditUser}
                onChange={(event) => { setAuditUser(event.target.value); setAuditOffset(0); }}
                placeholder="User UUID"
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs outline-none focus:border-violet-400 focus:bg-white"
              />
              <input
                value={auditClient}
                onChange={(event) => { setAuditClient(event.target.value); setAuditOffset(0); }}
                placeholder="OAuth client ID"
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs outline-none focus:border-violet-400 focus:bg-white"
              />
            </div>
          </div>

          {auditLoading && !audit ? (
            <div className="grid min-h-60 place-items-center text-sm text-slate-500"><Loader2 size={17} className="animate-spin" /></div>
          ) : !audit?.audit_logs.length ? (
            <div className="grid min-h-60 place-items-center p-8 text-sm text-slate-500">No audit events match these filters.</div>
          ) : (
            <>
              <div className="divide-y divide-slate-100">
                {audit.audit_logs.map((item) => (
                  <article key={item.id} className="p-5 sm:p-6">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + eventClass(item.event_type)}>
                            {item.event_type}
                          </span>
                          <span className="text-xs text-slate-400">{formatDate(item.created_at)}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                          <span>Actor <code>{item.actor_user_id ?? item.actor_type}</code></span>
                          {item.target_user_id ? <span>Target <code>{item.target_user_id}</code></span> : null}
                          {item.client_id ? <span>Client <code>{item.client_id}</code></span> : null}
                          {item.ip_address ? <span>IP <code>{item.ip_address}</code></span> : null}
                        </div>
                        {Object.keys(item.event_data ?? {}).length ? (
                          <pre className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] leading-5 text-slate-600">
                            {JSON.stringify(item.event_data, null, 2)}
                          </pre>
                        ) : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 p-4 sm:px-6">
                <p className="text-xs text-slate-500">
                  {audit.total.toLocaleString()} events · showing {audit.offset + 1}–{Math.min(audit.offset + audit.limit, audit.total)}
                </p>
                <div className="flex gap-2">
                  <button
                    disabled={auditOffset === 0}
                    onClick={() => setAuditOffset(Math.max(0, auditOffset - 50))}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <button
                    disabled={auditOffset + 50 >= audit.total}
                    onClick={() => setAuditOffset(auditOffset + 50)}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      )}

      {action ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-600">Privileged Trust action</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-950">{action.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{action.description}</p>
              </div>
              <button onClick={() => setAction(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X size={16} />
              </button>
            </div>
            <label className="mt-5 block text-sm font-semibold text-slate-800">
              Operator reason
              <textarea
                autoFocus
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={500}
                placeholder="Why is this action necessary? This is stored in the audit timeline."
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm outline-none focus:border-rose-400 focus:bg-white"
              />
            </label>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => void executeAction()}
                disabled={actionBusy || !reason.trim()}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {actionBusy ? <Loader2 size={15} className="animate-spin" /> : <ShieldAlert size={15} />}
                Confirm audited action
              </button>
              <button
                onClick={() => setAction(null)}
                className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value.toLocaleString()}</p>
      <p className="mt-1 text-xs text-slate-500">{detail}</p>
    </article>
  );
}

function UserDetailPanel({
  detail,
  canSuspend,
  canSessions,
  canMfaReset,
  onAction,
}: {
  detail: UserDetail;
  canSuspend: boolean;
  canSessions: boolean;
  canMfaReset: boolean;
  onAction: (action: ActionState) => void;
}) {
  const user = detail.user;
  return (
    <div className="space-y-6 p-5 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-slate-950">{user.display_name || user.email || "Unnamed account"}</h2>
            <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold " + statusClass(user.status)}>{user.status}</span>
            {user.email_verified ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                <CheckCircle2 size={10} /> verified
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-600">{user.email ?? "No email"}</p>
          <code className="mt-1 block text-[10px] text-slate-400">{user.id}</code>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>Created {formatDate(user.created_at)}</span>
            <span>Last login {formatDate(user.last_login_at)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {canSuspend && user.status === "ACTIVE" ? (
            <button
              onClick={() => onAction({
                type: "lock",
                userId: user.id,
                title: "Lock and contain account",
                description: "Locks the account and atomically revokes every active session and refresh token.",
              })}
              className="inline-flex items-center gap-2 rounded-xl border border-amber-200 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-50"
            >
              <Lock size={13} /> Lock
            </button>
          ) : null}
          {canSuspend && user.status === "LOCKED" ? (
            <button
              onClick={() => onAction({
                type: "unlock",
                userId: user.id,
                title: "Unlock account",
                description: "Restores sign-in eligibility. Previously revoked sessions remain revoked.",
              })}
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
            >
              <Unlock size={13} /> Unlock
            </button>
          ) : null}
          {canSuspend && user.status !== "DISABLED" ? (
            <button
              onClick={() => onAction({
                type: "disable",
                userId: user.id,
                title: "Disable and contain account",
                description: "Disables the identity and atomically revokes every renewable credential.",
              })}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              <UserX size={13} /> Disable
            </button>
          ) : null}
          {canMfaReset ? (
            <button
              onClick={() => onAction({
                type: "mfa-reset",
                userId: user.id,
                title: "Reset MFA enrollment",
                description: "Removes TOTP and recovery codes so the user can enroll a new factor. This does not reactivate a locked or disabled account.",
              })}
              className="inline-flex items-center gap-2 rounded-xl border border-violet-200 px-3 py-2 text-xs font-semibold text-violet-700 hover:bg-violet-50"
            >
              <KeyRound size={13} /> Reset MFA
            </button>
          ) : null}
        </div>
      </div>

      <section>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Active sessions</p>
            <h3 className="mt-1 text-sm font-semibold text-slate-900">{detail.sessions.length} renewable sessions</h3>
          </div>
          {canSessions && detail.sessions.length > 0 ? (
            <button
              onClick={() => onAction({
                type: "sessions-all",
                userId: user.id,
                title: "Revoke all user sessions",
                description: "Revokes all active sessions and refresh tokens without changing the account status.",
              })}
              className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
            >
              <ShieldAlert size={13} /> Revoke all
            </button>
          ) : null}
        </div>

        {detail.sessions.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No active renewable sessions.</div>
        ) : (
          <div className="mt-3 grid gap-3">
            {detail.sessions.map((session) => (
              <article key={session.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Smartphone size={14} className="text-blue-600" />
                      <p className="text-xs font-semibold text-slate-900">{session.device_name || session.client_id || "Unknown device"}</p>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>IP {session.ip_address ?? "unknown"}</span>
                      <span>Last seen {formatDate(session.last_seen_at)}</span>
                      <span>Expires {formatDate(session.expires_at)}</span>
                    </div>
                    {session.user_agent ? <p className="mt-2 break-words text-[10px] leading-5 text-slate-400">{session.user_agent}</p> : null}
                    <code className="mt-1 block text-[9px] text-slate-400">{session.id}</code>
                  </div>
                  {canSessions ? (
                    <button
                      onClick={() => onAction({
                        type: "session",
                        userId: user.id,
                        sessionId: session.id,
                        title: "Revoke this session",
                        description: "Revokes this session and its bound refresh tokens immediately.",
                      })}
                      className="shrink-0 rounded-xl border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                    >
                      Revoke
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] leading-5 text-slate-400">
          Renewable access is cut off immediately. Already-issued access tokens expire naturally within MigraAuth&apos;s short access-token lifetime.
        </p>
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Organization memberships</p>
        {detail.memberships.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No organization memberships.</p>
        ) : (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {detail.memberships.map((membership) => (
              <div key={membership.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-900">{membership.organization_name}</p>
                <p className="mt-1 text-[10px] text-slate-500">{membership.role} · {membership.status}</p>
                <code className="mt-1 block truncate text-[9px] text-slate-400">{membership.organization_slug}</code>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Recent identity evidence</p>
        <div className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {detail.recent_audit.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No recent audit events for this identity.</p>
          ) : (
            detail.recent_audit.slice(0, 10).map((item) => (
              <div key={item.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={"rounded-full px-2 py-0.5 text-[9px] font-bold " + eventClass(item.event_type)}>{item.event_type}</span>
                  <span className="text-[10px] text-slate-400">{formatDate(item.created_at)}</span>
                </div>
                {item.ip_address ? <p className="mt-1 text-[10px] text-slate-500">IP {item.ip_address}</p> : null}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
