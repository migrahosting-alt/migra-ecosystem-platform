"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, StatCard } from "@migrateck/auth-ui";
import { listAdminAudit, listAdminClients, listAdminUsers, type AdminAuditLog } from "@/lib/admin-api";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminDashboardPage() {
  const [totals, setTotals] = useState({ users: 0, clients: 0, audit: 0 });
  const [recentAudit, setRecentAudit] = useState<AdminAuditLog[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      listAdminUsers({ limit: 1 }),
      listAdminClients({ limit: 1 }),
      listAdminAudit({ limit: 8 }),
    ])
      .then(([usersResponse, clientsResponse, auditResponse]) => {
        if (!usersResponse.ok || !clientsResponse.ok || !auditResponse.ok) {
          setError("Failed to load admin dashboard.");
          return;
        }

        setTotals({
          users: usersResponse.data.total,
          clients: clientsResponse.data.total,
          audit: auditResponse.data.total,
        });
        setRecentAudit(auditResponse.data.audit_logs);
      })
      .catch(() => {
        setError("Failed to load admin dashboard.");
      });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-fuchsia-200">Overview</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">Security operations dashboard</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-400">
          Watch user volume, OAuth client activity, and the latest identity events from one dark-first MigraAuth control surface.
        </p>
      </div>

      {error && (
        <Card className="border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</Card>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total users" value={totals.users} meta="Directory coverage">
          <Link href="/admin/users" className="text-sm font-semibold text-white">Open directory</Link>
        </StatCard>
        <StatCard label="OAuth clients" value={totals.clients} meta="Connected apps and tooling">
          <Link href="/admin/clients" className="text-sm font-semibold text-white">Inspect inventory</Link>
        </StatCard>
        <StatCard label="Audit events" value={totals.audit} meta="Identity event stream">
          <Link href="/admin/audit" className="text-sm font-semibold text-white">Open explorer</Link>
        </StatCard>
      </div>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Recent audit</h2>
            <p className="text-sm text-zinc-400">Latest security-relevant events recorded by MigraAuth.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={() => { window.location.href = "/admin/audit"; }}>
            Open full log
          </Button>
        </div>
        <div className="divide-y divide-white/6">
          {recentAudit.map((event) => (
            <div key={event.id} className="flex flex-col gap-2 px-5 py-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">{event.event_type}</p>
                <p className="mt-1 text-xs text-zinc-500">
                  actor {event.actor_user_id ?? event.actor_type.toLowerCase()} · target {event.target_user_id ?? "n/a"}
                </p>
              </div>
              <div className="text-xs text-zinc-500">{formatTimestamp(event.created_at)}</div>
            </div>
          ))}
          {recentAudit.length === 0 && (
            <div className="px-5 py-8 text-sm text-zinc-400">No audit events yet.</div>
          )}
        </div>
      </Card>
    </div>
  );
}
