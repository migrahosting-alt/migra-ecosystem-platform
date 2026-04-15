"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import {
  deactivateDeveloperClient,
  formatLines,
  getDeveloperClient,
  parseLines,
  rotateDeveloperClientSecret,
  updateDeveloperClient,
  type OAuthClientView,
} from "@/lib/clients-api";

type EditorState = {
  client_name: string;
  description: string;
  redirect_uris: string;
  post_logout_redirect_uris: string;
  allowed_scopes: string;
  requires_pkce: boolean;
  is_active: boolean;
};

function toEditorState(client: OAuthClientView): EditorState {
  return {
    client_name: client.client_name,
    description: client.description ?? "",
    redirect_uris: formatLines(client.redirect_uris),
    post_logout_redirect_uris: formatLines(client.post_logout_redirect_uris),
    allowed_scopes: formatLines(client.allowed_scopes),
    requires_pkce: client.requires_pkce,
    is_active: client.is_active,
  };
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DeveloperAppDetailPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = Array.isArray(params.clientId) ? params.clientId[0] : params.clientId;

  const [client, setClient] = useState<OAuthClientView | null>(null);
  const [form, setForm] = useState<EditorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [latestSecret, setLatestSecret] = useState<string | null>(null);

  useEffect(() => {
    getDeveloperClient(clientId)
      .then((response) => {
        if (!response.ok) {
          setError("Failed to load OAuth app.");
          return;
        }

        setClient(response.data.client);
        setForm(toEditorState(response.data.client));
      })
      .catch(() => {
        setError("Failed to load OAuth app.");
      })
      .finally(() => {
        setLoading(false);
      });
  }, [clientId]);

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    if (!form) {
      return;
    }

    setSaving(true);
    setError("");
    setFlash("");

    try {
      const response = await updateDeveloperClient(clientId, {
        client_name: form.client_name,
        description: form.description || null,
        redirect_uris: parseLines(form.redirect_uris),
        post_logout_redirect_uris: parseLines(form.post_logout_redirect_uris),
        allowed_scopes: parseLines(form.allowed_scopes),
        requires_pkce: form.requires_pkce,
        is_active: form.is_active,
      });

      if (!response.ok) {
        setError("Failed to save changes.");
        return;
      }

      setClient(response.data.client);
      setForm(toEditorState(response.data.client));
      setFlash("Saved changes.");
    } catch {
      setError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRotateSecret() {
    setRotating(true);
    setError("");
    setFlash("");

    try {
      const response = await rotateDeveloperClientSecret(clientId);
      if (!response.ok) {
        setError("Failed to rotate client secret.");
        return;
      }

      setClient(response.data.client);
      setForm(toEditorState(response.data.client));
      setLatestSecret(response.data.client_secret);
      setFlash("Rotated client secret.");
    } catch {
      setError("Failed to rotate client secret.");
    } finally {
      setRotating(false);
    }
  }

  async function handleDeactivate() {
    setDeactivating(true);
    setError("");
    setFlash("");

    try {
      const response = await deactivateDeveloperClient(clientId);
      if (!response.ok) {
        setError("Failed to deactivate client.");
        return;
      }

      setClient((current) => current ? { ...current, is_active: false } : current);
      setForm((current) => current ? { ...current, is_active: false } : current);
      setFlash("Client deactivated.");
    } catch {
      setError("Failed to deactivate client.");
    } finally {
      setDeactivating(false);
    }
  }

  if (loading || !client || !form) {
    return (
      <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200/80 bg-white/90 p-8 shadow-xl shadow-slate-200/60 backdrop-blur">
        <div className="h-52 animate-pulse rounded-2xl bg-slate-100" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-200/60 backdrop-blur sm:p-8">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">Developer Console</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{client.client_name}</h1>
          <p className="mt-2 break-all font-mono text-sm text-slate-500">{client.client_id}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            href="/developers/apps"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Back to apps
          </Link>
          <button
            type="button"
            onClick={handleRotateSecret}
            disabled={rotating}
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {rotating ? "Rotating…" : "Rotate secret"}
          </button>
          <button
            type="button"
            onClick={handleDeactivate}
            disabled={deactivating || !client.is_active}
            className="inline-flex items-center justify-center rounded-xl bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {deactivating ? "Deactivating…" : client.is_active ? "Deactivate" : "Inactive"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {flash && (
        <div className="mt-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          {flash}
        </div>
      )}

      {latestSecret && (
        <div className="mt-6 rounded-2xl border border-sky-200 bg-sky-50 p-5">
          <p className="text-sm font-semibold text-sky-900">New client secret</p>
          <p className="mt-1 text-sm text-sky-800">Copy this now. It will not be shown again.</p>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-100">{latestSecret}</pre>
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <form onSubmit={handleSave} className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          <div>
            <label className="block text-sm font-medium text-slate-700">App name</label>
            <input
              value={form.client_name}
              onChange={(event) => setForm((current) => current ? { ...current, client_name: event.target.value } : current)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={form.description}
              rows={4}
              onChange={(event) => setForm((current) => current ? { ...current, description: event.target.value } : current)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Redirect URIs</label>
            <textarea
              value={form.redirect_uris}
              rows={5}
              onChange={(event) => setForm((current) => current ? { ...current, redirect_uris: event.target.value } : current)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Post-logout redirect URIs</label>
            <textarea
              value={form.post_logout_redirect_uris}
              rows={4}
              onChange={(event) => setForm((current) => current ? { ...current, post_logout_redirect_uris: event.target.value } : current)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Allowed scopes</label>
            <textarea
              value={form.allowed_scopes}
              rows={4}
              onChange={(event) => setForm((current) => current ? { ...current, allowed_scopes: event.target.value } : current)}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.requires_pkce}
              onChange={(event) => setForm((current) => current ? { ...current, requires_pkce: event.target.checked } : current)}
              className="mt-0.5"
            />
            <span>Require PKCE for authorization code exchange.</span>
          </label>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(event) => setForm((current) => current ? { ...current, is_active: event.target.checked } : current)}
              className="mt-0.5"
            />
            <span>Keep this client active for new authorization and token requests.</span>
          </label>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>

        <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">Client metadata</p>
            <div className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-4">
                <span>Type</span>
                <span className="font-medium text-slate-900">{client.client_type}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Auth method</span>
                <span className="font-medium text-slate-900">{client.token_auth_method}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Ownership</span>
                <span className="font-medium text-slate-900">
                  {client.owner_organization ? client.owner_organization.name : "Personal workspace"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Created</span>
                <span className="font-medium text-slate-900">{formatTimestamp(client.created_at)}</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <span>Updated</span>
                <span className="font-medium text-slate-900">{formatTimestamp(client.updated_at)}</span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">Operational notes</p>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>Client secrets are only shown once on create or rotate.</li>
              <li>Inactive clients can be re-enabled by saving with Active turned back on.</li>
              <li>Redirect URIs are exact-match and should include every environment explicitly.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}