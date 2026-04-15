"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  createDeveloperClient,
  listOrganizations,
  parseLines,
  type ClientMutationPayload,
  type OrganizationSummary,
} from "@/lib/clients-api";

type FormState = {
  client_name: string;
  description: string;
  client_type: ClientMutationPayload["client_type"];
  redirect_uris: string;
  post_logout_redirect_uris: string;
  allowed_scopes: string;
  requires_pkce: boolean;
  token_auth_method: NonNullable<ClientMutationPayload["token_auth_method"]>;
  owner_org_id: string;
};

const initialState: FormState = {
  client_name: "",
  description: "",
  client_type: "web",
  redirect_uris: "http://localhost:3000/auth/callback",
  post_logout_redirect_uris: "http://localhost:3000",
  allowed_scopes: "openid\nprofile\nemail",
  requires_pkce: true,
  token_auth_method: "none",
  owner_org_id: "",
};

export default function NewDeveloperAppPage() {
  const [form, setForm] = useState<FormState>(initialState);
  const [organizations, setOrganizations] = useState<OrganizationSummary[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdSecret, setCreatedSecret] = useState<string | null>(null);
  const [createdClientId, setCreatedClientId] = useState<string | null>(null);

  useEffect(() => {
    listOrganizations().then((response) => {
      if (response.ok) {
        setOrganizations(response.data.organizations);
      }
    }).catch(() => {});
  }, []);

  const authMethodOptions = useMemo(
    () => [
      { value: "none", label: "Public client with PKCE" },
      { value: "client_secret_basic", label: "Confidential client (Basic auth)" },
      { value: "client_secret_post", label: "Confidential client (POST body secret)" },
    ],
    [],
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    setCreatedSecret(null);

    const payload: ClientMutationPayload = {
      client_name: form.client_name,
      description: form.description || undefined,
      client_type: form.client_type,
      redirect_uris: parseLines(form.redirect_uris),
      post_logout_redirect_uris: parseLines(form.post_logout_redirect_uris),
      allowed_scopes: parseLines(form.allowed_scopes),
      requires_pkce: form.requires_pkce,
      token_auth_method: form.token_auth_method,
      owner_org_id: form.owner_org_id || undefined,
    };

    try {
      const response = await createDeveloperClient(payload);
      if (!response.ok) {
        setError("Failed to create OAuth app.");
        return;
      }

      setCreatedSecret(response.data.client_secret);
      setCreatedClientId(response.data.client.client_id);
      setForm(initialState);
    } catch {
      setError("Failed to create OAuth app.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl rounded-[28px] border border-slate-200/80 bg-white/90 p-6 shadow-xl shadow-slate-200/60 backdrop-blur sm:p-8">
      <div className="flex flex-col gap-3 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-sky-700">Developer Console</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Create OAuth App</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Register a client, define its scopes and callback URLs, and choose whether it belongs
            to your personal workspace or an organization.
          </p>
        </div>
        <Link
          href="/developers/apps"
          className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Back to apps
        </Link>
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {createdClientId && (
        <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
          <p className="text-sm font-semibold text-emerald-900">OAuth app created</p>
          <p className="mt-1 text-sm text-emerald-800">Client ID: <span className="font-mono">{createdClientId}</span></p>
          {createdSecret && (
            <>
              <p className="mt-4 text-sm text-emerald-900">Copy this client secret now. MigraAuth only shows it once.</p>
              <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 text-sm text-slate-100">{createdSecret}</pre>
            </>
          )}
          <div className="mt-4 flex gap-3">
            <Link
              href={`/developers/apps/${createdClientId}`}
              className="inline-flex items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              Open detail view
            </Link>
            <Link
              href="/developers/apps"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-white"
            >
              View all apps
            </Link>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
          <div>
            <label className="block text-sm font-medium text-slate-700">App name</label>
            <input
              value={form.client_name}
              onChange={(event) => setForm((current) => ({ ...current, client_name: event.target.value }))}
              required
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="MigraBuilder Web"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Description</label>
            <textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={4}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              placeholder="Explain what this app does and who it is for."
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="block text-sm font-medium text-slate-700">Client type</label>
              <select
                value={form.client_type}
                onChange={(event) => setForm((current) => ({ ...current, client_type: event.target.value as FormState["client_type"] }))}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="web">Web</option>
                <option value="spa">SPA</option>
                <option value="native">Native</option>
                <option value="service">Service</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700">Ownership scope</label>
              <select
                value={form.owner_org_id}
                onChange={(event) => setForm((current) => ({ ...current, owner_org_id: event.target.value }))}
                className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="">Personal workspace</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name} ({organization.role})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Redirect URIs</label>
            <textarea
              value={form.redirect_uris}
              onChange={(event) => setForm((current) => ({ ...current, redirect_uris: event.target.value }))}
              rows={5}
              required
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <p className="mt-2 text-xs text-slate-500">One URI per line. Exact matches only.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Post-logout redirect URIs</label>
            <textarea
              value={form.post_logout_redirect_uris}
              onChange={(event) => setForm((current) => ({ ...current, post_logout_redirect_uris: event.target.value }))}
              rows={4}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Allowed scopes</label>
            <textarea
              value={form.allowed_scopes}
              onChange={(event) => setForm((current) => ({ ...current, allowed_scopes: event.target.value }))}
              rows={4}
              className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 font-mono text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>

        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5">
          <div>
            <p className="text-sm font-semibold text-slate-900">Security posture</p>
            <p className="mt-1 text-sm text-slate-600">
              Choose whether this client is public with PKCE or confidential with a secret.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700">Token auth method</label>
            <div className="mt-3 space-y-2">
              {authMethodOptions.map((option) => (
                <label key={option.value} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="token-auth-method"
                    value={option.value}
                    checked={form.token_auth_method === option.value}
                    onChange={(event) => setForm((current) => ({ ...current, token_auth_method: event.target.value as FormState["token_auth_method"] }))}
                    className="mt-0.5"
                  />
                  <span>{option.label}</span>
                </label>
              ))}
            </div>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.requires_pkce}
              onChange={(event) => setForm((current) => ({ ...current, requires_pkce: event.target.checked }))}
              className="mt-0.5"
            />
            <span>
              Require PKCE. Keep this enabled for browser and native flows unless you have a narrow
              internal-service reason to disable it.
            </span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex w-full items-center justify-center rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {submitting ? "Creating app…" : "Create OAuth app"}
          </button>
        </div>
      </form>
    </div>
  );
}