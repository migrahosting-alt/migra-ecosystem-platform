"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

type ApiKeyRecord = {
  id: string;
  name: string;
  publicKeyId: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED";
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  key?: string;
};

type ApiKeyPayload = {
  organization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  keys: ApiKeyRecord[];
  availableScopes: string[];
};

const scopeLabels: Record<string, string> = {
  "platform:read": "Platform read",
  "products:read": "Products read",
  "billing:read": "Billing read",
  "billing:write": "Billing write",
  "usage:read": "Usage read",
  "usage:write": "Usage write",
  "webhooks:read": "Webhooks read",
  "webhooks:write": "Webhooks write",
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

export function ApiKeyManager() {
  const [data, setData] = useState<ApiKeyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [expiryDays, setExpiryDays] = useState("90");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["platform:read"]);
  const [revealedKey, setRevealedKey] = useState<ApiKeyRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/developer/api-keys", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load API keys");
      setData(body);
      if (Array.isArray(body.availableScopes) && body.availableScopes.includes("platform:read")) {
        setSelectedScopes((current) => current.length ? current : ["platform:read"]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load API keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeCount = useMemo(
    () => data?.keys.filter((key) => key.status === "ACTIVE").length ?? 0,
    [data],
  );

  function toggleScope(scope: string) {
    setSelectedScopes((current) =>
      current.includes(scope)
        ? current.filter((item) => item !== scope)
        : [...current, scope],
    );
  }

  async function createKey() {
    if (name.trim().length < 2 || selectedScopes.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const expiresAt = expiryDays === "never"
        ? null
        : new Date(Date.now() + Number(expiryDays) * 24 * 60 * 60 * 1000).toISOString();
      const response = await fetch("/api/platform/developer/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes: selectedScopes,
          expiresAt,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to create API key");

      const created = body.key as ApiKeyRecord;
      const safeCreated: ApiKeyRecord = {
        id: created.id,
        name: created.name,
        publicKeyId: created.publicKeyId,
        status: created.status,
        scopes: created.scopes,
        expiresAt: created.expiresAt,
        revokedAt: created.revokedAt,
        lastUsedAt: created.lastUsedAt,
        createdAt: created.createdAt,
      };
      setRevealedKey(created);
      setCopied(false);
      setName("");
      setData((current) => current
        ? { ...current, keys: [safeCreated, ...current.keys] }
        : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create API key");
    } finally {
      setCreating(false);
    }
  }

  async function copyKey() {
    if (!revealedKey?.key) return;
    await navigator.clipboard.writeText(revealedKey.key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function revoke(key: ApiKeyRecord) {
    if (!window.confirm(`Revoke ${key.name}? Applications using this key will stop working immediately.`)) {
      return;
    }

    setRevokingId(key.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/developer/api-keys/" + encodeURIComponent(key.id),
        { method: "DELETE" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to revoke API key");
      setData((current) => current
        ? {
            ...current,
            keys: current.keys.map((item) =>
              item.id === key.id
                ? { ...item, status: "REVOKED", revokedAt: new Date().toISOString() }
                : item,
            ),
          }
        : current);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to revoke API key");
    } finally {
      setRevokingId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-64 place-items-center rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" /> Loading API keys…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
        <p className="font-semibold text-rose-900">API-key workspace unavailable</p>
        <p className="mt-2 text-sm leading-6 text-rose-700">{error ?? "No organization context is available."}</p>
        <button onClick={() => void load()} className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-800">
          <RefreshCw size={15} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {revealedKey?.key ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                <ShieldCheck size={19} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-emerald-950">API key created — copy it now</h2>
                <p className="mt-1 text-sm leading-6 text-emerald-800">This is the only time MigraTeck will display the full secret.</p>
              </div>
            </div>
            <button aria-label="Dismiss secret" onClick={() => setRevealedKey(null)} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-100">
              <X size={17} />
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3 rounded-xl border border-emerald-200 bg-white p-4 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all text-sm font-semibold text-slate-900">{revealedKey.key}</code>
            <button onClick={() => void copyKey()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              {copied ? <Check size={15} /> : <Clipboard size={15} />}
              {copied ? "Copied" : "Copy key"}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.82fr_1.18fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600"><Plus size={18} /></span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">Create API key</h2>
              <p className="mt-1 text-sm text-slate-600">Issue a scoped machine credential for {data.organization.name}.</p>
            </div>
          </div>

          <label className="mt-6 block text-sm font-semibold text-slate-800">Key name</label>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Production backend"
            maxLength={80}
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
          />

          <label className="mt-5 block text-sm font-semibold text-slate-800">Expiration</label>
          <select
            value={expiryDays}
            onChange={(event) => setExpiryDays(event.target.value)}
            className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="365">1 year</option>
            <option value="never">No expiration</option>
          </select>

          <div className="mt-5">
            <p className="text-sm font-semibold text-slate-800">Scopes</p>
            <p className="mt-1 text-xs leading-5 text-slate-500">Grant only the capabilities this integration needs.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {data.availableScopes.map((scope) => {
                const selected = selectedScopes.includes(scope);
                return (
                  <label key={scope} className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${selected ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700"}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleScope(scope)} className="accent-blue-600" />
                    {scopeLabels[scope] ?? scope}
                  </label>
                );
              })}
            </div>
          </div>

          <button
            onClick={() => void createKey()}
            disabled={creating || name.trim().length < 2 || selectedScopes.length === 0}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
            {creating ? "Creating…" : "Create API key"}
          </button>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Issued credentials</h2>
              <p className="mt-1 text-sm text-slate-600">{activeCount} active · {data.keys.length} total for {data.organization.name}</p>
            </div>
            <button onClick={() => void load()} className="rounded-xl border border-slate-200 p-2.5 text-slate-600 hover:bg-slate-50" aria-label="Refresh API keys">
              <RefreshCw size={16} />
            </button>
          </div>

          {data.keys.length === 0 ? (
            <div className="grid min-h-72 place-items-center px-6 py-12 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><KeyRound size={21} /></span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">No API keys yet</h3>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Create the first scoped credential when a backend, CLI, or service needs programmatic access.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {data.keys.map((key) => (
                <article key={key.id} className="p-5">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-slate-950">{key.name}</h3>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${key.status === "ACTIVE" ? "bg-emerald-50 text-emerald-700" : key.status === "REVOKED" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"}`}>
                          {key.status}
                        </span>
                      </div>
                      <code className="mt-2 block text-xs font-semibold text-slate-500">mk_live_{key.publicKeyId}_••••••••••••</code>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {key.scopes.map((scope) => (
                          <span key={scope} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">{scope}</span>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-x-6 gap-y-1 text-xs text-slate-500 sm:grid-cols-3">
                        <span>Created: {formatDate(key.createdAt)}</span>
                        <span>Last used: {formatDate(key.lastUsedAt)}</span>
                        <span>Expires: {formatDate(key.expiresAt)}</span>
                      </div>
                    </div>
                    {key.status === "ACTIVE" ? (
                      <button
                        onClick={() => void revoke(key)}
                        disabled={revokingId === key.id}
                        className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-200 px-3.5 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        {revokingId === key.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        Revoke
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
