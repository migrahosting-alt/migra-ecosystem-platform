"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clipboard,
  Edit3,
  Eye,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  Webhook,
  X,
} from "lucide-react";

type EventCatalogItem = {
  event: string;
  category: string;
  readiness: "live" | "contract";
  description: string;
};

type WebhookEndpoint = {
  id: string;
  url: string;
  events: string[];
  status: "ACTIVE" | "PAUSED" | "DISABLED";
  description: string | null;
  failCount: number;
  lastDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type WebhookPayload = {
  organization: {
    id: string;
    name: string;
    slug: string;
    role: string;
  };
  endpoints: WebhookEndpoint[];
  eventCatalog: EventCatalogItem[];
};

type Delivery = {
  id: string;
  endpointId: string;
  eventType: string;
  status: "PENDING" | "DELIVERED" | "FAILED" | "EXPIRED";
  attempts: number;
  maxAttempts: number;
  lastAttemptAt: string | null;
  nextRetryAt: string | null;
  httpStatus: number | null;
  responseBody: string | null;
  duration: number | null;
  createdAt: string;
  url: string;
};

type EditorState = {
  mode: "create" | "edit";
  endpointId: string | null;
  url: string;
  description: string;
  events: string[];
};

const emptyEditor: EditorState = {
  mode: "create",
  endpointId: null,
  url: "",
  description: "",
  events: ["api_key.created", "api_key.revoked"],
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  return new Date(value).toLocaleString();
}

function statusClass(status: string) {
  if (status === "ACTIVE" || status === "DELIVERED") return "bg-emerald-50 text-emerald-700";
  if (status === "PAUSED" || status === "PENDING") return "bg-amber-50 text-amber-700";
  if (status === "FAILED" || status === "DISABLED") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export function WebhookManager() {
  const [data, setData] = useState<WebhookPayload | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [query, setQuery] = useState("");
  const [deliveryFilter, setDeliveryFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [deliveryLoading, setDeliveryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busyEndpoint, setBusyEndpoint] = useState<string | null>(null);
  const [busyDelivery, setBusyDelivery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingSecret, setSigningSecret] = useState<{ endpointId: string; secret: string; reason: "created" | "rotated" } | null>(null);
  const [copied, setCopied] = useState(false);
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);

  const loadEndpoints = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/developer/webhooks", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load webhook endpoints");
      setData(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load webhook endpoints");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDeliveries = useCallback(async (endpointId?: string) => {
    setDeliveryLoading(true);
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (endpointId) params.set("endpointId", endpointId);
      const response = await fetch("/api/platform/developer/webhooks/deliveries?" + params.toString(), {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to load webhook deliveries");
      setDeliveries(body.deliveries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load webhook deliveries");
    } finally {
      setDeliveryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEndpoints();
    void loadDeliveries();
  }, [loadEndpoints, loadDeliveries]);

  const metrics = useMemo(() => {
    const endpoints = data?.endpoints ?? [];
    return {
      active: endpoints.filter((item) => item.status === "ACTIVE").length,
      paused: endpoints.filter((item) => item.status === "PAUSED").length,
      unhealthy: endpoints.filter((item) => item.status === "DISABLED" || item.failCount > 0).length,
    };
  }, [data]);

  const filteredEndpoints = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!data || !normalized) return data?.endpoints ?? [];
    return data.endpoints.filter((endpoint) =>
      [endpoint.url, endpoint.description ?? "", endpoint.status, ...endpoint.events]
        .some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [data, query]);

  function toggleEvent(event: string) {
    setEditor((current) => ({
      ...current,
      events: current.events.includes(event)
        ? current.events.filter((item) => item !== event)
        : [...current.events, event],
    }));
  }

  function editEndpoint(endpoint: WebhookEndpoint) {
    setEditor({
      mode: "edit",
      endpointId: endpoint.id,
      url: endpoint.url,
      description: endpoint.description ?? "",
      events: endpoint.events,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetEditor() {
    setEditor(emptyEditor);
  }

  async function saveEndpoint() {
    if (!editor.url.trim() || editor.events.length === 0) {
      setError("Webhook URL and at least one live event subscription are required.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const create = editor.mode === "create";
      const endpoint = create
        ? "/api/platform/developer/webhooks"
        : "/api/platform/developer/webhooks/" + encodeURIComponent(editor.endpointId!);
      const response = await fetch(endpoint, {
        method: create ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: editor.url.trim(),
          description: editor.description.trim() || null,
          events: editor.events,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to save webhook endpoint");

      if (create && body.signingSecret) {
        setSigningSecret({
          endpointId: body.endpoint?.id ?? "new-endpoint",
          secret: body.signingSecret,
          reason: "created",
        });
        setCopied(false);
      }

      await loadEndpoints();
      resetEditor();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save webhook endpoint");
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(endpoint: WebhookEndpoint, status: "ACTIVE" | "PAUSED") {
    setBusyEndpoint(endpoint.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/developer/webhooks/" + encodeURIComponent(endpoint.id),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to change webhook state");
      await loadEndpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change webhook state");
    } finally {
      setBusyEndpoint(null);
    }
  }

  async function disableEndpoint(endpoint: WebhookEndpoint) {
    if (!window.confirm("Disable this endpoint? Delivery history will be retained, but no new deliveries will be sent.")) return;
    setBusyEndpoint(endpoint.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/developer/webhooks/" + encodeURIComponent(endpoint.id),
        { method: "DELETE" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to disable webhook endpoint");
      await loadEndpoints();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to disable webhook endpoint");
    } finally {
      setBusyEndpoint(null);
    }
  }

  async function rotateSecret(endpoint: WebhookEndpoint) {
    if (!window.confirm("Rotate this signing secret? The previous secret becomes invalid immediately.")) return;
    setBusyEndpoint(endpoint.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/developer/webhooks/" + encodeURIComponent(endpoint.id) + "/rotate-secret",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to rotate signing secret");
      setSigningSecret({ endpointId: endpoint.id, secret: body.signingSecret, reason: "rotated" });
      setCopied(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to rotate signing secret");
    } finally {
      setBusyEndpoint(null);
    }
  }

  async function sendTest(endpoint: WebhookEndpoint) {
    setBusyEndpoint(endpoint.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/developer/webhooks/" + encodeURIComponent(endpoint.id) + "/test",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to queue test webhook");
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      await loadDeliveries(deliveryFilter || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to queue test webhook");
    } finally {
      setBusyEndpoint(null);
    }
  }

  async function replayDelivery(delivery: Delivery) {
    setBusyDelivery(delivery.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/developer/webhooks/deliveries/" + encodeURIComponent(delivery.id) + "/replay",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Unable to replay delivery");
      await new Promise((resolve) => window.setTimeout(resolve, 800));
      await loadDeliveries(deliveryFilter || undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to replay delivery");
    } finally {
      setBusyDelivery(null);
    }
  }

  async function copySecret() {
    if (!signingSecret) return;
    await navigator.clipboard.writeText(signingSecret.secret);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function filterDeliveries(endpointId: string) {
    setDeliveryFilter(endpointId);
    await loadDeliveries(endpointId || undefined);
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" /> Loading webhook workspace…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">Webhook workspace unavailable</h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">{error ?? "No organization context is available."}</p>
        <button onClick={() => void loadEndpoints()} className="mt-4 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800">
          Retry
        </button>
      </section>
    );
  }

  const liveEvents = data.eventCatalog.filter((item) => item.readiness === "live");
  const contractEvents = data.eventCatalog.filter((item) => item.readiness === "contract");

  return (
    <div className="space-y-6">
      {signingSecret ? (
        <section className="rounded-3xl border border-emerald-200 bg-[linear-gradient(135deg,#ecfdf5,#effcf8)] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-semibold text-emerald-950">
                Signing secret {signingSecret.reason === "created" ? "created" : "rotated"} — copy it now
              </h2>
              <p className="mt-1 text-sm leading-6 text-emerald-800">
                The secret is encrypted at rest and will not be shown again after you dismiss it.
              </p>
            </div>
            <button onClick={() => setSigningSecret(null)} className="rounded-lg p-2 text-emerald-700 hover:bg-emerald-100" aria-label="Dismiss signing secret">
              <X size={17} />
            </button>
          </div>
          <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-emerald-200 bg-white p-4 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 break-all text-sm font-semibold text-slate-900">{signingSecret.secret}</code>
            <button onClick={() => void copySecret()} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white">
              {copied ? <Check size={15} /> : <Clipboard size={15} />}
              {copied ? "Copied" : "Copy secret"}
            </button>
          </div>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-800">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Active endpoints</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{metrics.active}</p>
          <p className="mt-1 text-sm text-slate-600">{data.endpoints.length} registered</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Paused</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{metrics.paused}</p>
          <p className="mt-1 text-sm text-slate-600">delivery intentionally suspended</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Needs attention</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{metrics.unhealthy}</p>
          <p className="mt-1 text-sm text-slate-600">disabled or carrying failures</p>
        </div>
      </section>

      <div className="grid gap-6 2xl:grid-cols-[0.82fr_1.18fr]">
        <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600">
                {editor.mode === "create" ? "New endpoint" : "Endpoint configuration"}
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                {editor.mode === "create" ? "Create webhook endpoint" : "Edit endpoint"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                HTTPS only. Private and internal network destinations are blocked by the delivery worker.
              </p>
            </div>
            {editor.mode === "edit" ? (
              <button onClick={resetEditor} className="rounded-xl border border-slate-200 p-2 text-slate-500 hover:bg-slate-50" aria-label="Close endpoint editor">
                <X size={16} />
              </button>
            ) : null}
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            <div>
              <label className="text-sm font-semibold text-slate-800">Endpoint URL</label>
              <input
                value={editor.url}
                onChange={(event) => setEditor((current) => ({ ...current, url: event.target.value }))}
                placeholder="https://api.example.com/migrateck/webhooks"
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800">Description</label>
              <textarea
                value={editor.description}
                onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
                rows={3}
                maxLength={500}
                placeholder="What system receives these events?"
                className="mt-2 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Live event subscriptions</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">Only events with a confirmed producer path are selectable right now.</p>
              <div className="mt-3 space-y-2">
                {liveEvents.map((item) => {
                  const selected = editor.events.includes(item.event);
                  return (
                    <label key={item.event} className={"flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition " + (selected ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white")}>
                      <input type="checkbox" checked={selected} onChange={() => toggleEvent(item.event)} className="mt-1 accent-blue-600" />
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <code className="text-xs font-semibold text-slate-900">{item.event}</code>
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-emerald-700">Live</span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-500">{item.description}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="text-sm font-semibold text-slate-800">Defined contracts — producer integration pending</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {contractEvents.map((item) => (
                  <div key={item.event} className="rounded-xl border border-slate-200 bg-slate-50 p-3 opacity-75">
                    <div className="flex items-center gap-2">
                      <code className="truncate text-[11px] font-semibold text-slate-700">{item.event}</code>
                      <span className="shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[8px] font-bold uppercase text-slate-600">Contract</span>
                    </div>
                    <p className="mt-1 text-[11px] leading-5 text-slate-500">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                onClick={() => void saveEndpoint()}
                disabled={saving}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : editor.mode === "create" ? <Plus size={16} /> : <Check size={16} />}
                {saving ? "Saving…" : editor.mode === "create" ? "Create endpoint" : "Save endpoint"}
              </button>
              {editor.mode === "edit" ? (
                <button onClick={resetEditor} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
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
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Registered endpoints</p>
                <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">{data.organization.name}</h2>
              </div>
              <button onClick={() => void loadEndpoints()} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
            <div className="relative mt-4">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search URL, event, state..."
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
          </div>

          {filteredEndpoints.length === 0 ? (
            <div className="grid min-h-80 place-items-center px-6 py-12 text-center">
              <div>
                <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500"><Webhook size={21} /></span>
                <h3 className="mt-4 text-sm font-semibold text-slate-900">{data.endpoints.length ? "No endpoint matches" : "No webhook endpoints yet"}</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Create an HTTPS endpoint when an external system needs signed MigraTeck event delivery.</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {filteredEndpoints.map((endpoint) => {
                const busy = busyEndpoint === endpoint.id;
                return (
                  <article key={endpoint.id} className="p-5 sm:p-6">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start gap-3">
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-50 text-violet-600"><Webhook size={19} /></span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] " + statusClass(endpoint.status)}>{endpoint.status}</span>
                            {endpoint.failCount > 0 ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700">
                                <ShieldAlert size={10} /> {endpoint.failCount} consecutive failure{endpoint.failCount === 1 ? "" : "s"}
                              </span>
                            ) : null}
                          </div>
                          <code className="mt-2 block break-all text-xs font-semibold text-slate-800">{endpoint.url}</code>
                          {endpoint.description ? <p className="mt-2 text-sm leading-6 text-slate-600">{endpoint.description}</p> : null}
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-1.5">
                        {endpoint.events.map((event) => (
                          <span key={event} className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-medium text-slate-600">{event}</span>
                        ))}
                      </div>

                      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600 sm:grid-cols-3">
                        <div><span className="block font-semibold text-slate-800">Last delivery</span><span className="mt-1 block">{formatDate(endpoint.lastDeliveryAt)}</span></div>
                        <div><span className="block font-semibold text-slate-800">Created</span><span className="mt-1 block">{formatDate(endpoint.createdAt)}</span></div>
                        <div><span className="block font-semibold text-slate-800">Endpoint ID</span><code className="mt-1 block truncate">{endpoint.id}</code></div>
                      </div>

                      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                        <button onClick={() => editEndpoint(endpoint)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><Edit3 size={14} /> Edit</button>
                        {endpoint.status === "ACTIVE" ? (
                          <button onClick={() => void sendTest(endpoint)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 px-3.5 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Test</button>
                        ) : null}
                        <button onClick={() => void rotateSecret(endpoint)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 px-3.5 py-2 text-sm font-semibold text-violet-700 hover:bg-violet-50 disabled:opacity-50"><RotateCw size={14} /> Rotate secret</button>
                        {endpoint.status === "ACTIVE" ? (
                          <button onClick={() => void updateStatus(endpoint, "PAUSED")} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 px-3.5 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"><Pause size={14} /> Pause</button>
                        ) : (
                          <button onClick={() => void updateStatus(endpoint, "ACTIVE")} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 px-3.5 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"><Play size={14} /> Reactivate</button>
                        )}
                        {endpoint.status !== "DISABLED" ? (
                          <button onClick={() => void disableEndpoint(endpoint)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-3.5 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"><Trash2 size={14} /> Disable</button>
                        ) : null}
                        <button onClick={() => void filterDeliveries(endpoint.id)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Eye size={14} /> Deliveries</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Delivery evidence</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">Recent deliveries</h2>
            <p className="mt-1 text-sm text-slate-600">HTTP result, attempts, latency, retry state, and replay controls.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {deliveryFilter ? (
              <button onClick={() => void filterDeliveries("")} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">Show all</button>
            ) : null}
            <button onClick={() => void loadDeliveries(deliveryFilter || undefined)} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">
              {deliveryLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Refresh
            </button>
          </div>
        </div>

        {deliveries.length === 0 ? (
          <div className="grid min-h-48 place-items-center p-8 text-center text-sm text-slate-500">
            No webhook deliveries have been recorded yet.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {deliveries.map((delivery) => {
              const expanded = expandedDelivery === delivery.id;
              const busy = busyDelivery === delivery.id;
              return (
                <article key={delivery.id} className="p-5 sm:p-6">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={"rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] " + statusClass(delivery.status)}>{delivery.status}</span>
                        <code className="text-xs font-semibold text-slate-800">{delivery.eventType}</code>
                        {delivery.httpStatus !== null ? <span className="text-xs font-semibold text-slate-500">HTTP {delivery.httpStatus}</span> : null}
                      </div>
                      <code className="mt-2 block break-all text-[11px] text-slate-500">{delivery.url}</code>
                      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500">
                        <span>{delivery.attempts}/{delivery.maxAttempts} attempts</span>
                        <span>{delivery.duration !== null ? delivery.duration + " ms" : "No duration yet"}</span>
                        <span>{formatDate(delivery.createdAt)}</span>
                        {delivery.nextRetryAt ? <span>Retry {formatDate(delivery.nextRetryAt)}</span> : null}
                      </div>
                      {expanded && delivery.responseBody ? (
                        <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-200 bg-slate-950 p-3 text-[11px] leading-5 text-slate-200">{delivery.responseBody}</pre>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {delivery.responseBody ? (
                        <button onClick={() => setExpandedDelivery(expanded ? null : delivery.id)} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">{expanded ? "Hide response" : "View response"}</button>
                      ) : null}
                      {delivery.status !== "PENDING" ? (
                        <button onClick={() => void replayDelivery(delivery)} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                          {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Replay
                        </button>
                      ) : null}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
