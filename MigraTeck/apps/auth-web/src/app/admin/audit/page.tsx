"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Card,
  DataTable,
  DataTableCell,
  DataTableHead,
  DataTableRow,
  DataTableShell,
  DataTableToolbar,
  Input,
} from "@migrateck/auth-ui";
import { listAdminAudit, type AdminAuditLog } from "@/lib/admin-api";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AdminAuditPage() {
  const [eventType, setEventType] = useState("");
  const [events, setEvents] = useState<AdminAuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  async function loadAudit(nextEventType = eventType) {
    setError("");
    try {
      const response = await listAdminAudit({ event_type: nextEventType || undefined, limit: 100 });
      if (!response.ok) {
        setError("Failed to load audit logs.");
        return;
      }
      setEvents(response.data.audit_logs);
      setTotal(response.data.total);
    } catch {
      setError("Failed to load audit logs.");
    }
  }

  useEffect(() => {
    loadAudit();
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    loadAudit();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-fuchsia-200">Audit explorer</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">Security event stream</h1>
        <p className="mt-3 text-sm text-zinc-400">Review account actions, token events, and client operations emitted by MigraAuth.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
        <Input id="audit-search" value={eventType} onChange={(event) => setEventType(event.target.value)} placeholder="Filter by event type, e.g. LOGIN_SUCCESS" />
        <button type="submit" className="rounded-2xl bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] px-4 py-2.5 text-sm font-semibold text-white">Filter</button>
      </form>

      {error ? <Card className="border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</Card> : null}

      <DataTableShell>
        <DataTableToolbar>
          <span className="text-sm text-zinc-400">{total} events</span>
          <span className="text-sm text-zinc-500">Dense but readable audit view</span>
        </DataTableToolbar>
        <div className="overflow-x-auto">
          <DataTable>
            <DataTableHead>
              <tr>
                <th className="px-5 py-3">Timestamp</th>
                <th className="px-5 py-3">Action</th>
                <th className="px-5 py-3">Actor</th>
                <th className="px-5 py-3">Context</th>
              </tr>
            </DataTableHead>
            <tbody>
              {events.map((event) => (
                <DataTableRow key={event.id}>
                  <DataTableCell className="text-zinc-400">{formatTimestamp(event.created_at)}</DataTableCell>
                  <DataTableCell>
                    <p className="font-semibold text-white">{event.event_type}</p>
                  </DataTableCell>
                  <DataTableCell className="text-zinc-300">
                    {event.actor_user_id ?? event.actor_type.toLowerCase()}
                  </DataTableCell>
                  <DataTableCell className="text-zinc-500">
                    target {event.target_user_id ?? "n/a"} · client {event.client_id ?? "n/a"}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
          {events.length === 0 ? <div className="px-5 py-8 text-sm text-zinc-400">No audit events match the current filter.</div> : null}
        </div>
      </DataTableShell>
    </div>
  );
}
