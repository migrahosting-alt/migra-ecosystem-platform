"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { adminUserAction, getAdminUser, type AdminUserDetail } from "@/lib/admin-api";

function formatTimestamp(value: string | null) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminUserDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = Array.isArray(params.userId) ? params.userId[0] : params.userId;
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [reason, setReason] = useState("");
  const [busyAction, setBusyAction] = useState<"lock" | "unlock" | "disable" | null>(null);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");

  useEffect(() => {
    getAdminUser(userId)
      .then((response) => {
        if (!response.ok) {
          setError("Failed to load user.");
          return;
        }
        setData(response.data);
      })
      .catch(() => {
        setError("Failed to load user.");
      });
  }, [userId]);

  async function runAction(action: "lock" | "unlock" | "disable") {
    if (!reason.trim()) {
      setError("A reason is required for admin actions.");
      return;
    }

    setBusyAction(action);
    setError("");
    setFlash("");

    try {
      const response = await adminUserAction(userId, action, reason.trim());
      if (!response.ok) {
        setError(`Failed to ${action} user.`);
        return;
      }

      const refreshed = await getAdminUser(userId);
      if (refreshed.ok) {
        setData(refreshed.data);
      }
      setFlash(response.data.message);
      setReason("");
    } catch {
      setError(`Failed to ${action} user.`);
    } finally {
      setBusyAction(null);
    }
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading user…</div>
    );
  }

  return (
    <div>
      <div className="border-b border-slate-200 pb-6">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">User Detail</p>
        <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{data.user.display_name || data.user.email}</h2>
        <p className="mt-2 text-sm text-slate-600">{data.user.email}</p>
      </div>

      {error && <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
      {flash && <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{flash}</div>}

      <div className="mt-8 grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-slate-950">Account state</h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><span className="block text-xs uppercase tracking-wide text-slate-500">Status</span><span className="mt-2 block text-base font-semibold text-slate-950">{data.user.status}</span></div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><span className="block text-xs uppercase tracking-wide text-slate-500">Verified</span><span className="mt-2 block text-base font-semibold text-slate-950">{data.user.email_verified ? "Yes" : "No"}</span></div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><span className="block text-xs uppercase tracking-wide text-slate-500">Created</span><span className="mt-2 block text-base font-semibold text-slate-950">{formatTimestamp(data.user.created_at)}</span></div>
              <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><span className="block text-xs uppercase tracking-wide text-slate-500">Last Login</span><span className="mt-2 block text-base font-semibold text-slate-950">{formatTimestamp(data.user.last_login_at)}</span></div>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-slate-950">Organization memberships</h3>
            <div className="mt-4 divide-y divide-slate-100">
              {data.memberships.map((membership) => (
                <div key={membership.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <p className="font-medium text-slate-950">{membership.organization_name}</p>
                    <p className="text-slate-500">{membership.organization_slug}</p>
                  </div>
                  <div className="text-right text-slate-600">
                    <p>{membership.role}</p>
                    <p className="text-xs">{membership.status}</p>
                  </div>
                </div>
              ))}
              {data.memberships.length === 0 && <div className="py-4 text-sm text-slate-500">No organization memberships.</div>}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-slate-950">Active sessions</h3>
            <div className="mt-4 divide-y divide-slate-100">
              {data.sessions.map((session) => (
                <div key={session.id} className="py-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-950">{session.device_name || session.user_agent || "Session"}</p>
                  <p className="mt-1 text-xs text-slate-500">{session.ip_address || "Unknown IP"} · last seen {formatTimestamp(session.last_seen_at)}</p>
                </div>
              ))}
              {data.sessions.length === 0 && <div className="py-4 text-sm text-slate-500">No active sessions.</div>}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
            <h3 className="text-lg font-semibold text-slate-950">Administrative actions</h3>
            <p className="mt-2 text-sm text-slate-600">Provide a reason before locking, unlocking, or disabling this account.</p>
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Operator reason"
            />
            <div className="mt-4 grid gap-3">
              <button onClick={() => runAction("lock")} disabled={busyAction !== null} className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">{busyAction === "lock" ? "Locking…" : "Lock user"}</button>
              <button onClick={() => runAction("unlock")} disabled={busyAction !== null} className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50">{busyAction === "unlock" ? "Unlocking…" : "Unlock user"}</button>
              <button onClick={() => runAction("disable")} disabled={busyAction !== null} className="rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50">{busyAction === "disable" ? "Disabling…" : "Disable user"}</button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-semibold text-slate-950">Recent audit</h3>
            <div className="mt-4 divide-y divide-slate-100">
              {data.recent_audit.map((event) => (
                <div key={event.id} className="py-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-950">{event.event_type}</p>
                  <p className="mt-1 text-xs text-slate-500">{formatTimestamp(event.created_at)} · actor {event.actor_user_id ?? event.actor_type.toLowerCase()}</p>
                </div>
              ))}
              {data.recent_audit.length === 0 && <div className="py-4 text-sm text-slate-500">No recent audit events.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}