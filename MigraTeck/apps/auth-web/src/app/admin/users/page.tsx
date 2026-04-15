"use client";

import Link from "next/link";
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
  StatusBadge,
} from "@migrateck/auth-ui";
import { listAdminUsers, type AdminUserRow } from "@/lib/admin-api";

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function AdminUsersPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadUsers(nextQuery = query, nextStatus = status) {
    setLoading(true);
    setError("");

    try {
      const response = await listAdminUsers({ q: nextQuery || undefined, status: nextStatus || undefined, limit: 50 });
      if (!response.ok) {
        setError("Failed to load users.");
        return;
      }

      setUsers(response.data.users);
      setTotal(response.data.total);
    } catch {
      setError("Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    loadUsers();
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-fuchsia-200">Users</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-white">User directory</h1>
        <p className="mt-3 text-sm text-zinc-400">Search active accounts, review locked users, and open a detailed operator view.</p>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
        <Input
          id="user-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search email or display name"
          wrapperClassName="md:col-span-1"
        />
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="h-11 rounded-2xl border border-white/10 bg-black/20 px-3 text-sm text-zinc-200 outline-none focus:border-[var(--brand-accent)] focus:ring-2 focus:ring-[rgb(var(--ring)/0.25)]"
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="ACTIVE">Active</option>
          <option value="LOCKED">Locked</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <button type="submit" className="rounded-2xl bg-[linear-gradient(135deg,var(--brand-start),var(--brand-end))] px-4 py-2.5 text-sm font-semibold text-white">Filter</button>
      </form>

      {error ? <Card className="border-rose-400/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{error}</Card> : null}

      <DataTableShell>
        <DataTableToolbar>
          <span className="text-sm text-zinc-400">{total} users</span>
          <span className="text-sm text-zinc-500">{loading ? "Refreshing..." : "Latest directory snapshot"}</span>
        </DataTableToolbar>
        <div className="overflow-x-auto">
          <DataTable>
            <DataTableHead>
              <tr>
                <th className="px-5 py-3">User</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3">Verification</th>
                <th className="px-5 py-3">Last login</th>
              </tr>
            </DataTableHead>
            <tbody>
              {users.map((user) => (
                <DataTableRow key={user.id}>
                  <DataTableCell>
                    <Link href={`/admin/users/${user.id}`} className="block">
                      <p className="font-semibold text-white">{user.display_name || user.email}</p>
                      <p className="mt-1 text-xs text-zinc-500">{user.email}</p>
                    </Link>
                  </DataTableCell>
                  <DataTableCell><StatusBadge status={user.status} /></DataTableCell>
                  <DataTableCell>
                    <StatusBadge status={user.email_verified ? "VERIFIED" : "PENDING"} />
                  </DataTableCell>
                  <DataTableCell className="text-zinc-400">Last login {formatDate(user.last_login_at)}</DataTableCell>
                </DataTableRow>
              ))}
            </tbody>
          </DataTable>
          {!loading && users.length === 0 ? (
            <div className="px-5 py-8 text-sm text-zinc-400">No users match the current filter.</div>
          ) : null}
        </div>
      </DataTableShell>
    </div>
  );
}
