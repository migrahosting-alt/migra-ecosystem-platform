"use client";

import { useCallback, useEffect, useState } from "react";
import { SectionCard } from "../../components/SectionCard";

type Staff = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  department: string | null;
  status: string;
};
type Mailbox = {
  id: string;
  address: string;
  label: string | null;
  domain: string | null;
  brand: string | null;
  active: boolean;
};
type Grant = {
  id: string;
  subjectType: "user" | "role";
  subjectValue: string;
  canView: boolean;
  canSend: boolean;
  canReply: boolean;
  canManageSettings: boolean;
  canAssign: boolean;
  canViewAttachments: boolean;
  canDeleteArchive: boolean;
};

const MM = "/console/mail/api/mm";
const STAFF = "/console/mail/api/staff";

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const CAP_FIELDS: Array<{ key: keyof Grant; label: string }> = [
  { key: "canView", label: "View" },
  { key: "canSend", label: "Send" },
  { key: "canReply", label: "Reply" },
  { key: "canViewAttachments", label: "Attachments" },
  { key: "canAssign", label: "Assign" },
  { key: "canManageSettings", label: "Settings" },
  { key: "canDeleteArchive", label: "Delete/Archive" },
];

export function MailAdminClient() {
  const [staff, setStaff] = useState<Staff[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, m] = await Promise.all([
        call<{ staff: Staff[]; roles: string[] }>(STAFF),
        call<{ mailboxes: Mailbox[]; roles: string[] }>(`${MM}/admin/mailboxes`),
      ]);
      setStaff(s.staff);
      setRoles(s.roles || m.roles);
      setMailboxes(m.mailboxes);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadGrants = useCallback(async (id: string) => {
    try {
      const { grants } = await call<{ grants: Grant[] }>(`${MM}/admin/mailboxes/${id}/grants`);
      setGrants(grants);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (selected) void loadGrants(selected);
    else setGrants([]);
  }, [selected, loadGrants]);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <StaffSection
        staff={staff}
        roles={roles}
        busy={busy}
        onAdd={(body) =>
          wrap(async () => {
            await call(STAFF, { method: "POST", body: JSON.stringify(body) });
            await refresh();
          })
        }
        onDelete={(email) =>
          wrap(async () => {
            await call(`${STAFF}?email=${encodeURIComponent(email)}`, { method: "DELETE" });
            await refresh();
          })
        }
      />

      <MailboxSection
        mailboxes={mailboxes}
        selected={selected}
        busy={busy}
        onSelect={setSelected}
        onAdd={(body) =>
          wrap(async () => {
            await call(`${MM}/admin/mailboxes`, { method: "POST", body: JSON.stringify(body) });
            await refresh();
          })
        }
        onDeactivate={(id) =>
          wrap(async () => {
            await call(`${MM}/admin/mailboxes/${id}`, { method: "DELETE" });
            if (selected === id) setSelected(null);
            await refresh();
          })
        }
      />

      {selected && (
        <GrantSection
          grants={grants}
          staff={staff}
          roles={roles}
          busy={busy}
          onUpsert={(body) =>
            wrap(async () => {
              await call(`${MM}/admin/mailboxes/${selected}/grants`, {
                method: "PUT",
                body: JSON.stringify(body),
              });
              await loadGrants(selected);
            })
          }
          onRemove={(grantId) =>
            wrap(async () => {
              await call(`${MM}/admin/grants/${grantId}`, { method: "DELETE" });
              await loadGrants(selected);
            })
          }
        />
      )}
    </div>
  );
}

/* ------------------------------- staff ------------------------------------ */

function StaffSection({
  staff,
  roles,
  busy,
  onAdd,
  onDelete,
}: {
  staff: Staff[];
  roles: string[];
  busy: boolean;
  onAdd: (b: Record<string, string>) => void;
  onDelete: (email: string) => void;
}) {
  const [form, setForm] = useState({ email: "", name: "", role: "support", department: "", password: "" });
  return (
    <SectionCard title="Staff" subtitle="People who can be granted mailbox access">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1">Email</th>
              <th className="px-2 py-1">Name</th>
              <th className="px-2 py-1">Role</th>
              <th className="px-2 py-1">Dept</th>
              <th className="px-2 py-1">Status</th>
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-2 py-3 text-slate-500">
                  No staff yet.
                </td>
              </tr>
            ) : (
              staff.map((s) => (
                <tr key={s.id} className="border-t border-white/5 text-slate-200">
                  <td className="px-2 py-2">{s.email}</td>
                  <td className="px-2 py-2">{s.name || "—"}</td>
                  <td className="px-2 py-2">{s.role}</td>
                  <td className="px-2 py-2">{s.department || "—"}</td>
                  <td className="px-2 py-2">{s.status}</td>
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onDelete(s.email)}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-6">
        <input
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="email@migrahosting.com"
          className={inputCls + " md:col-span-2"}
        />
        <input
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
          placeholder="Name"
          className={inputCls}
        />
        <select
          value={form.role}
          onChange={(e) => setForm({ ...form, role: e.target.value })}
          className={inputCls}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input
          value={form.department}
          onChange={(e) => setForm({ ...form, department: e.target.value })}
          placeholder="Dept"
          className={inputCls}
        />
        <input
          value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })}
          placeholder="Password"
          type="password"
          className={inputCls}
        />
      </div>
      <button
        type="button"
        disabled={busy || !form.email.includes("@")}
        onClick={() => {
          onAdd(form);
          setForm({ email: "", name: "", role: "support", department: "", password: "" });
        }}
        className={btnCls + " mt-2"}
      >
        Add / update staff
      </button>
    </SectionCard>
  );
}

/* ------------------------------ mailboxes --------------------------------- */

function MailboxSection({
  mailboxes,
  selected,
  busy,
  onSelect,
  onAdd,
  onDeactivate,
}: {
  mailboxes: Mailbox[];
  selected: string | null;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: (b: Record<string, string>) => void;
  onDeactivate: (id: string) => void;
}) {
  const [form, setForm] = useState({ address: "", label: "", brand: "" });
  return (
    <SectionCard title="Mailboxes" subtitle="Ecosystem mailboxes available to the panel">
      <ul className="space-y-1">
        {mailboxes.length === 0 ? (
          <li className="text-sm text-slate-500">No mailboxes registered yet.</li>
        ) : (
          mailboxes.map((m) => (
            <li
              key={m.id}
              className={[
                "flex items-center justify-between rounded-lg border px-3 py-2",
                selected === m.id ? "border-fuchsia-400/40 bg-white/5" : "border-white/10",
              ].join(" ")}
            >
              <button type="button" onClick={() => onSelect(m.id)} className="text-left">
                <span className="block text-sm font-medium text-white">{m.label || m.address}</span>
                <span className="block text-[11px] text-slate-500">
                  {m.address} {m.brand ? `· ${m.brand}` : ""} {m.active ? "" : "· inactive"}
                </span>
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeactivate(m.id)}
                className="text-xs text-red-300 hover:text-red-200"
              >
                Deactivate
              </button>
            </li>
          ))
        )}
      </ul>
      <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-4">
        <input
          value={form.address}
          onChange={(e) => setForm({ ...form, address: e.target.value })}
          placeholder="support@migrahosting.com"
          className={inputCls + " md:col-span-2"}
        />
        <input
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
          placeholder="Label (Support)"
          className={inputCls}
        />
        <input
          value={form.brand}
          onChange={(e) => setForm({ ...form, brand: e.target.value })}
          placeholder="Brand/Dept"
          className={inputCls}
        />
      </div>
      <button
        type="button"
        disabled={busy || !form.address.includes("@")}
        onClick={() => {
          onAdd(form);
          setForm({ address: "", label: "", brand: "" });
        }}
        className={btnCls + " mt-2"}
      >
        Register mailbox
      </button>
    </SectionCard>
  );
}

/* -------------------------------- grants ---------------------------------- */

function GrantSection({
  grants,
  staff,
  roles,
  busy,
  onUpsert,
  onRemove,
}: {
  grants: Grant[];
  staff: Staff[];
  roles: string[];
  busy: boolean;
  onUpsert: (b: Record<string, unknown>) => void;
  onRemove: (grantId: string) => void;
}) {
  const [subjectType, setSubjectType] = useState<"user" | "role">("user");
  const [subjectValue, setSubjectValue] = useState("");
  const [caps, setCaps] = useState<Record<string, boolean>>({
    canView: true,
    canViewAttachments: true,
    canReply: false,
    canSend: false,
    canAssign: false,
    canManageSettings: false,
    canDeleteArchive: false,
  });

  return (
    <SectionCard title="Permissions" subtitle="Who can use the selected mailbox, and how">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
              <th className="px-2 py-1">Subject</th>
              {CAP_FIELDS.map((c) => (
                <th key={c.key} className="px-2 py-1">
                  {c.label}
                </th>
              ))}
              <th className="px-2 py-1" />
            </tr>
          </thead>
          <tbody>
            {grants.length === 0 ? (
              <tr>
                <td colSpan={CAP_FIELDS.length + 2} className="px-2 py-3 text-slate-500">
                  No grants yet — nobody but Super Admins can see this mailbox.
                </td>
              </tr>
            ) : (
              grants.map((g) => (
                <tr key={g.id} className="border-t border-white/5 text-slate-200">
                  <td className="px-2 py-2">
                    <span className="text-[11px] uppercase text-slate-500">{g.subjectType}</span>{" "}
                    {g.subjectValue}
                  </td>
                  {CAP_FIELDS.map((c) => (
                    <td key={c.key} className="px-2 py-2">
                      {g[c.key] ? "✓" : "—"}
                    </td>
                  ))}
                  <td className="px-2 py-2 text-right">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => onRemove(g.id)}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.target.value as "user" | "role");
              setSubjectValue("");
            }}
            className={inputCls}
          >
            <option value="user">User</option>
            <option value="role">Role</option>
          </select>
          <select
            value={subjectValue}
            onChange={(e) => setSubjectValue(e.target.value)}
            className={inputCls + " min-w-[16rem]"}
          >
            <option value="">Select {subjectType}…</option>
            {(subjectType === "user" ? staff.map((s) => s.email) : roles).map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-3">
          {CAP_FIELDS.map((c) => (
            <label key={c.key} className="flex items-center gap-1.5 text-xs text-slate-300">
              <input
                type="checkbox"
                checked={Boolean(caps[c.key as string])}
                onChange={(e) => setCaps({ ...caps, [c.key as string]: e.target.checked })}
              />
              {c.label}
            </label>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || !subjectValue}
          onClick={() => onUpsert({ subjectType, subjectValue, ...caps })}
          className={btnCls}
        >
          Save grant
        </button>
      </div>
    </SectionCard>
  );
}

const inputCls =
  "rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/40";
const btnCls =
  "rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-fuchsia-500 disabled:opacity-50";
