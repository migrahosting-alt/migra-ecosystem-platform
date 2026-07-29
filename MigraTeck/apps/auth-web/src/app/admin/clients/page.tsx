"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge, Card, Input, StatusBadge } from "@migrateck/auth-ui";
import { listAdminClients, type AdminClientRow } from "@/lib/admin-api";

function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type ClientsResult =
  | { ok: true; clients: AdminClientRow[]; total: number }
  | { ok: false; error: string };

/** Lives outside the component so the effect body contains no setState call of its own. */
async function fetchClients(query: string, isActive: string): Promise<ClientsResult> {
  try {
    const response = await listAdminClients({
      q: query || undefined,
      is_active: isActive === "" ? undefined : isActive === "true",
      limit: 50,
    });
    if (!response.ok) return { ok: false, error: "Failed to load clients." };
    return { ok: true, clients: response.data.clients, total: response.data.total };
  } catch {
    return { ok: false, error: "Failed to load clients." };
  }
}

export default function AdminClientsPage() {
  const [query, setQuery] = useState("");
  const [isActive, setIsActive] = useState("");
  const [clients, setClients] = useState<AdminClientRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");

  function applyClients(result: ClientsResult) {
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setClients(result.clients);
    setTotal(result.total);
    setError("");
  }

  useEffect(() => {
    // Guarded so a response landing after unmount is dropped rather than setting state.
    let cancelled = false;
    fetchClients("", "").then((result) => {
      if (!cancelled) applyClients(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    applyClients(await fetchClients(query, isActive));
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-fuchsia-200">OAuth clients</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">Client inventory</h1>
        <p className="mt-3 text-sm text-zinc-400">Inspect first-party and developer-owned clients across the platform.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <Input id="client-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search client id or name" />
        <select value={isActive} onChange={(event) => setIsActive(event.target.value)} className="h-11 rounded-2xl border border-white/10 bg-black/20 px-3 text-sm text-zinc-200 outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[rgb(var(--ring)/0.25)]">
          <option value="">All states</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        <button type="submit" className="rounded-2xl bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] px-4 py-2.5 text-sm font-semibold text-white">Filter</button>
      </form>

      {error ? <Card className="border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</Card> : null}

      <Card className="overflow-hidden">
        <div className="border-b border-white/10 px-5 py-4 text-sm text-zinc-400">{total} clients</div>
        <div className="divide-y divide-white/6">
          {clients.map((client) => (
            <div key={client.id} className="px-5 py-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">{client.client_name}</p>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-500">{client.client_id}</p>
                  <p className="mt-2 text-sm text-zinc-400">{client.description || "No description provided."}</p>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <StatusBadge status={client.is_active ? "ACTIVE" : "DISABLED"} />
                  <Badge>{client.client_type}</Badge>
                  <Badge tone="info">{client.token_auth_method}</Badge>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
                <span>{client.owner_organization ? `Org: ${client.owner_organization.name}` : client.owner_user_id ? "Personal owner" : "Platform-owned"}</span>
                <span>{client.allowed_scopes.length} scopes</span>
                <span>Updated {formatDate(client.updated_at)}</span>
              </div>
            </div>
          ))}
          {clients.length === 0 && <div className="px-5 py-8 text-sm text-zinc-400">No OAuth clients match the current filter.</div>}
        </div>
      </Card>
    </div>
  );
}
