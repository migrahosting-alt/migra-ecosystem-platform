"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Clipboard,
  Code2,
  Edit3,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Loader2,
  LockKeyhole,
  Plus,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";

type OAuthClient = {
  id: string;
  client_id: string;
  client_name: string;
  description: string | null;
  client_type: "web" | "spa" | "native" | "service";
  redirect_uris: string[];
  post_logout_redirect_uris: string[];
  allowed_scopes: string[];
  requires_pkce: boolean;
  token_auth_method: "none" | "client_secret_basic" | "client_secret_post";
  is_first_party: boolean;
  is_active: boolean;
  owner_user_id: string | null;
  owner_org_id: string | null;
  owner_organization: { id: string; name: string; slug: string } | null;
  created_at: string;
  updated_at: string;
};

type OAuthPayload = {
  organization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  clients: OAuthClient[];
  supportedScopes: string[];
  supportedClientTypes: string[];
  supportedTokenAuthMethods: string[];
  serviceGrantAvailable: boolean;
};

type SecretReveal = {
  clientName: string;
  clientId: string;
  secret: string;
  reason: "created" | "rotated";
};

type EditorState = {
  mode: "create" | "edit";
  clientId: string | null;
  name: string;
  description: string;
  clientType: "web" | "spa" | "native";
  tokenAuthMethod: "none" | "client_secret_basic" | "client_secret_post";
  redirectUris: string;
  postLogoutRedirectUris: string;
  scopes: string[];
};

const emptyEditor: EditorState = {
  mode: "create",
  clientId: null,
  name: "",
  description: "",
  clientType: "web",
  tokenAuthMethod: "client_secret_basic",
  redirectUris: "",
  postLogoutRedirectUris: "",
  scopes: ["openid", "profile", "email"],
};

const scopeLabels: Record<string, string> = {
  openid: "OpenID identity",
  profile: "Profile",
  email: "Email",
  offline_access: "Refresh tokens",
  "orgs:read": "Organizations",
};

function parseLines(value: string): string[] {
  return [...new Set(value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
}

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function clientTypeLabel(type: OAuthClient["client_type"]) {
  if (type === "spa") return "SPA";
  if (type === "native") return "Native";
  if (type === "service") return "Service";
  return "Web";
}

function typeIcon(type: OAuthClient["client_type"]) {
  if (type === "native") return Smartphone;
  if (type === "spa") return Code2;
  return ExternalLink;
}

export function OAuthClientManager() {
  const [data, setData] = useState<OAuthPayload | null>(null);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyClient, setBusyClient] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secretReveal, setSecretReveal] = useState<SecretReveal | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/developer/oauth-clients", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load OAuth applications");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load OAuth applications");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredClients = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!data || !normalized) return data?.clients ?? [];
    return data.clients.filter((client) =>
      [
        client.client_name,
        client.client_id,
        client.description ?? "",
        client.client_type,
        ...client.allowed_scopes,
      ].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [data, query]);

  const metrics = useMemo(() => {
    const clients = data?.clients ?? [];
    return {
      active: clients.filter((client) => client.is_active).length,
      publicClients: clients.filter((client) => client.token_auth_method === "none").length,
      confidential: clients.filter((client) => client.token_auth_method !== "none").length,
    };
  }, [data]);

  function resetEditor() {
    setEditor(emptyEditor);
  }

  function selectType(type: "web" | "spa" | "native") {
    setEditor((current) => ({
      ...current,
      clientType: type,
      tokenAuthMethod:
        type === "spa" || type === "native"
          ? "none"
          : current.tokenAuthMethod === "none"
            ? "client_secret_basic"
            : current.tokenAuthMethod,
    }));
  }

  function editClient(client: OAuthClient) {
    setEditor({
      mode: "edit",
      clientId: client.client_id,
      name: client.client_name,
      description: client.description ?? "",
      clientType: client.client_type === "service" ? "web" : client.client_type,
      tokenAuthMethod: client.token_auth_method,
      redirectUris: client.redirect_uris.join("\n"),
      postLogoutRedirectUris: client.post_logout_redirect_uris.join("\n"),
      scopes: client.allowed_scopes,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleScope(scope: string) {
    if (scope === "openid") return;
    setEditor((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((item) => item !== scope)
        : [...current.scopes, scope],
    }));
  }

  async function save() {
    const redirectUris = parseLines(editor.redirectUris);
    if (editor.name.trim().length < 1 || redirectUris.length === 0 || editor.scopes.length === 0) {
      setError("Name, at least one redirect URI, and at least one scope are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const create = editor.mode === "create";
      const endpoint = create
        ? "/api/platform/developer/oauth-clients"
        : "/api/platform/developer/oauth-clients/" + encodeURIComponent(editor.clientId!);
      const body = create
        ? {
            client_name: editor.name.trim(),
            description: editor.description.trim() || undefined,
            client_type: editor.clientType,
            token_auth_method: editor.tokenAuthMethod,
            redirect_uris: redirectUris,
            post_logout_redirect_uris: parseLines(editor.postLogoutRedirectUris),
            allowed_scopes: editor.scopes,
            requires_pkce: true,
          }
        : {
            client_name: editor.name.trim(),
            description: editor.description.trim() || null,
            redirect_uris: redirectUris,
            post_logout_redirect_uris: parseLines(editor.postLogoutRedirectUris),
            allowed_scopes: editor.scopes,
            requires_pkce: true,
          };

      const response = await fetch(endpoint, {
        method: create ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save OAuth application");

      if (create && result.client_secret) {
        setSecretReveal({
          clientName: result.client.client_name,
          clientId: result.client.client_id,
          secret: result.client_secret,
          reason: "created",
        });
      }

      await load();
      resetEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save OAuth application");
    } finally {
      setSaving(false);
    }
  }

  async function rotateSecret(client: OAuthClient) {
    if (!window.confirm(
      "Rotate the client secret for " + client.client_name + "? The previous secret will stop working immediately.",
    )) return;

    setBusyClient(client.client_id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/developer/oauth-clients/" +
          encodeURIComponent(client.client_id) +
          "/rotate-secret",
        { method: "POST" },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to rotate client secret");
      setSecretReveal({
        clientName: client.client_name,
        clientId: client.client_id,
        secret: result.client_secret,
        reason: "rotated",
      });
      setCopied(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rotate client secret");
    } finally {
      setBusyClient(null);
    }
  }

  async function setActive(client: OAuthClient, active: boolean) {
    const message = active
      ? "Reactivate " + client.client_name + "?"
      : "Deactivate " + client.client_name + "? Existing authorization requests for this client will be refused.";
    if (!window.confirm(message)) return;

    setBusyClient(client.client_id);
    setError(null);
    try {
      const endpoint = "/api/platform/developer/oauth-clients/" + encodeURIComponent(client.client_id);
      const response = active
        ? await fetch(endpoint, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_active: true }),
          })
        : await fetch(endpoint, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to change application state");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change application state");
    } finally {
      setBusyClient(null);
    }
  }

  async function copySecret() {
    if (!secretReveal) return;
    await navigator.clipboard.writeText(secretReveal.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading OAuth workspace…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">OAuth workspace unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">{error ?? "No organization context is available."}</p>
        <button
          onClick={() => void load()}
          className="mt-4 inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800"
        >
          <RefreshCw size={15} /> Retry
        </button>
      </section>
    );
  }

  return (
    <div className="space-y-6">
      {secretReveal ? (
        <section className="rounded-3xl border border-emerald-200 bg-[linear-gradient(135deg,#ecfdf5,#f0fdfa)] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700">
                <LockKeyhole size={18} />
              </span>
              <div>
                <h2 className="font-semibold text-emerald-950">
                  Client secret {secretReveal.reason === "created" ? "issued" : "rotated"} — copy it now
                </h2>
                <p className="mt-1 text-sm leading-6 text-emerald-800">
                  MigraAuth stores only the secret hash. This value cannot be recovered after you dismiss it.
                </p>
              </div>
            </div>
            <button
              onClick={() => setSecretReveal(null)}
              className="rounded-lg p-2 text-emerald-700 transition hover:bg-emerald-100"
              aria-label="Dismiss client secret"
            >
              <X size={17} />
            </button>
          </div>
          <div className="mt-4 grid gap-3 rounded-2xl border border-emerald-200 bg-white p-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Client ID</p>
              <code className="mt-1 block break-all text-sm font-semibold text-slate-900">{secretReveal.clientId}</code>
            </div>
            <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Client secret</p>
                <code className="mt-1 block break-all text-sm font-semibold text-slate-900">{secretReveal.secret}</code>
              </div>
              <button
                onClick={() => void copySecret()}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
              >
                {copied ? <Check size={15} /> : <Clipboard size={15} />}
                {copied ? "Copied" : "Copy secret"}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">
          {error}
        </div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Active apps</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{metrics.active}</p>
          <p className="mt-1 text-sm text-slate-600">of {data.clients.length} registered</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Public clients</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{metrics.publicClients}</p>
          <p className="mt-1 text-sm text-slate-600">SPA / native, no reusable secret</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Confidential clients</p>
          <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{metrics.confidential}</p>
          <p className="mt-1 text-sm text-slate-600">server-side secret authentication</p>
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-[0.82fr_1.18fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                {editor.mode === "create" ? "New integration" : "Configuration"}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                {editor.mode === "create" ? "Register OAuth application" : "Edit " + editor.name}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {editor.mode === "create"
                  ? "Register only callback origins this application actually owns."
                  : "Client type and authentication mode stay fixed after registration."}
              </p>
            </div>
            {editor.mode === "edit" ? (
              <button
                onClick={resetEditor}
                className="rounded-xl border border-slate-200 p-2 text-slate-500 transition hover:bg-slate-50"
                aria-label="Close editor"
              >
                <X size={16} />
              </button>
            ) : null}
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            {editor.mode === "edit" ? (
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-400">Client ID</p>
                <code className="mt-1 block break-all text-sm font-semibold text-slate-800">{editor.clientId}</code>
              </div>
            ) : null}

            <div>
              <label className="text-sm font-semibold text-slate-800">Application name</label>
              <input
                value={editor.name}
                onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
                placeholder="MigraMail Web"
                maxLength={120}
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Description</label>
              <textarea
                value={editor.description}
                onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
                placeholder="What this application uses MigraAuth for."
                maxLength={500}
                rows={3}
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Application type</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {(["web", "spa", "native"] as const).map((type) => {
                  const selected = editor.clientType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      disabled={editor.mode === "edit"}
                      onClick={() => selectType(type)}
                      className={
                        "rounded-xl border px-3 py-3 text-sm font-semibold transition " +
                        (selected
                          ? "border-blue-300 bg-blue-50 text-blue-800"
                          : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50") +
                        (editor.mode === "edit" ? " cursor-not-allowed opacity-70" : "")
                      }
                    >
                      {clientTypeLabel(type)}
                    </button>
                  );
                })}
              </div>
              {!data.serviceGrantAvailable ? (
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Service clients remain gated until the client_credentials grant is implemented.
                </p>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Client authentication</label>
              <select
                value={editor.tokenAuthMethod}
                disabled={editor.mode === "edit" || editor.clientType === "spa" || editor.clientType === "native"}
                onChange={(event) =>
                  setEditor((current) => ({
                    ...current,
                    tokenAuthMethod: event.target.value as EditorState["tokenAuthMethod"],
                  }))
                }
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="none">Public client — no secret</option>
                <option value="client_secret_basic">Confidential — HTTP Basic secret</option>
                <option value="client_secret_post">Confidential — POST body secret</option>
              </select>
              <div className="mt-2 flex items-center gap-2 text-xs font-medium text-emerald-700">
                <ShieldCheck size={14} /> PKCE is required for all new applications.
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Redirect URIs</label>
              <p className="mt-1 text-xs leading-5 text-slate-500">One exact callback URI per line. Wildcards are not accepted.</p>
              <textarea
                value={editor.redirectUris}
                onChange={(event) => setEditor((current) => ({ ...current, redirectUris: event.target.value }))}
                placeholder={"https://app.example.com/auth/callback\nhttps://staging.example.com/auth/callback"}
                rows={4}
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 font-mono text-xs leading-6 text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Post-logout redirect URIs</label>
              <p className="mt-1 text-xs leading-5 text-slate-500">Optional destinations after a completed logout.</p>
              <textarea
                value={editor.postLogoutRedirectUris}
                onChange={(event) => setEditor((current) => ({ ...current, postLogoutRedirectUris: event.target.value }))}
                placeholder="https://app.example.com/"
                rows={3}
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 font-mono text-xs leading-6 text-slate-900 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Scopes</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {data.supportedScopes.map((scope) => {
                  const selected = editor.scopes.includes(scope);
                  return (
                    <label
                      key={scope}
                      className={
                        "flex cursor-pointer items-start gap-2 rounded-xl border px-3 py-2.5 text-sm transition " +
                        (selected ? "border-blue-200 bg-blue-50 text-blue-900" : "border-slate-200 bg-white text-slate-700")
                      }
                    >
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={scope === "openid"}
                        onChange={() => toggleScope(scope)}
                        className="mt-0.5 accent-blue-600"
                      />
                      <span>
                        <span className="block font-medium">{scopeLabels[scope] ?? scope}</span>
                        <code className="mt-0.5 block text-[10px] text-slate-500">{scope}</code>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => void save()}
                disabled={saving}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : editor.mode === "create" ? <Plus size={16} /> : <Check size={16} />}
                {saving ? "Saving…" : editor.mode === "create" ? "Register application" : "Save configuration"}
              </button>
              {editor.mode === "edit" ? (
                <button
                  onClick={resetEditor}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Registered applications</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{data.organization.name}</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Organization role: <span className="font-semibold text-slate-800">{data.organization.role}</span>
                </p>
              </div>
              <button
                onClick={() => void load()}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 transition hover:bg-slate-50"
              >
                <RefreshCw size={15} /> Refresh
              </button>
            </div>

            <div className="relative mt-4">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search apps, client IDs, scopes..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
          </div>

          {filteredClients.length === 0 ? (
            <div className="grid min-h-80 place-items-center px-6 py-12 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
                  <Fingerprint size={21} />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">
                  {data.clients.length === 0 ? "No OAuth applications yet" : "No applications match your search"}
                </h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">
                  {data.clients.length === 0
                    ? "Register the first application when a MigraTeck product or integration needs MigraAuth sign-in."
                    : "Try a different application name, client ID, or scope."}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredClients.map((client) => {
                const Icon = typeIcon(client.client_type);
                const confidential = client.token_auth_method !== "none";
                const busy = busyClient === client.client_id;
                return (
                  <article key={client.client_id} className="p-5 sm:p-6">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                          <Icon size={19} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-semibold text-slate-950">{client.client_name}</h3>
                            <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] " + (client.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>
                              {client.is_active ? "Active" : "Inactive"}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">
                              {clientTypeLabel(client.client_type)}
                            </span>
                          </div>
                          {client.description ? (
                            <p className="mt-1 text-sm leading-6 text-slate-600">{client.description}</p>
                          ) : null}
                          <code className="mt-2 block break-all text-xs font-semibold text-slate-500">{client.client_id}</code>
                        </div>
                        <ChevronRight size={17} className="mt-3 hidden text-slate-300 sm:block" />
                      </div>

                      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Authentication</p>
                          <p className="mt-1 text-sm font-semibold text-slate-800">
                            {confidential ? "Confidential client" : "Public client"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">{client.token_auth_method}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">PKCE</p>
                          <p className="mt-1 text-sm font-semibold text-emerald-700">
                            {client.requires_pkce ? "Required" : "Not required"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">Updated {formatDate(client.updated_at)}</p>
                        </div>
                      </div>

                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Redirect boundaries</p>
                        <div className="mt-2 space-y-1.5">
                          {client.redirect_uris.slice(0, 3).map((uri) => (
                            <code key={uri} className="block break-all rounded-lg bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600">{uri}</code>
                          ))}
                          {client.redirect_uris.length > 3 ? (
                            <p className="text-xs font-medium text-slate-500">+{client.redirect_uris.length - 3} more</p>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {client.allowed_scopes.map((scope) => (
                          <span key={scope} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600">
                            {scope}
                          </span>
                        ))}
                      </div>

                      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:flex-wrap">
                        <button
                          onClick={() => editClient(client)}
                          disabled={busy}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                        >
                          <Edit3 size={14} /> Edit
                        </button>
                        {confidential && client.is_active ? (
                          <button
                            onClick={() => void rotateSecret(client)}
                            disabled={busy}
                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-violet-200 px-3.5 py-2 text-sm font-semibold text-violet-700 transition hover:bg-violet-50 disabled:opacity-50"
                          >
                            {busy ? <Loader2 size={14} className="animate-spin" /> : <RotateCw size={14} />}
                            Rotate secret
                          </button>
                        ) : null}
                        <button
                          onClick={() => void setActive(client, !client.is_active)}
                          disabled={busy}
                          className={
                            "inline-flex items-center justify-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition disabled:opacity-50 " +
                            (client.is_active
                              ? "border-rose-200 text-rose-700 hover:bg-rose-50"
                              : "border-emerald-200 text-emerald-700 hover:bg-emerald-50")
                          }
                        >
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <Power size={14} />}
                          {client.is_active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
