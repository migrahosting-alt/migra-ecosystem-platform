"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Link2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Unplug,
  Wrench,
} from "lucide-react";

type OperatorAction =
  | "monitor"
  | "connect"
  | "reconnect"
  | "provider_setup"
  | "integration_required"
  | "refresh"
  | "sync";

type SocialConnectionRow = {
  id: string;
  orgId: string;
  orgName: string | null;
  platform: string;
  handle: string;
  profileType: string;
  publishMode: string;
  status: string;
  connected: boolean;
  externalAccountBound: boolean;
  tokenExpiresAt: string | null;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  health: {
    state: string;
    summary: string;
    recommendedAction: string;
    operatorAction: OperatorAction;
    canAutoRefresh: boolean;
    tokenExpired: boolean;
    tokenExpiresSoon: boolean;
    verificationStale: boolean;
    missingAccountBinding: boolean;
    providerSetupRequired: boolean;
    needsAttention: boolean;
    expiresInHours: number | null;
  };
  oauth: {
    supported: boolean;
    configured: boolean;
    providerLabel: string | null;
    usesPkce: boolean;
  };
};

type SocialPayload = {
  authority: {
    canManage: boolean;
  };
  generatedAt: string;
  encryptionReady: boolean;
  summary: {
    total: number;
    healthy: number;
    needsAttention: number;
    reconnectRequired: number;
    connectRequired: number;
    providerSetupRequired: number;
    integrationRequired: number;
    refreshRequired: number;
    syncRequired: number;
  };
  rows: SocialConnectionRow[];
};

function formatDate(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function platformLabel(row: SocialConnectionRow) {
  return row.oauth.providerLabel ?? row.platform.replaceAll("_", " ");
}

function actionLabel(action: OperatorAction) {
  switch (action) {
    case "monitor":
      return "Healthy";
    case "connect":
      return "Connect";
    case "reconnect":
      return "Reconnect";
    case "provider_setup":
      return "Provider setup";
    case "integration_required":
      return "Connector required";
    case "refresh":
      return "Token refresh";
    case "sync":
      return "Profile sync";
  }
}

function actionClass(action: OperatorAction) {
  if (action === "monitor") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (action === "integration_required") {
    return "border-violet-200 bg-violet-50 text-violet-800";
  }
  if (action === "provider_setup") {
    return "border-cyan-200 bg-cyan-50 text-cyan-800";
  }
  return "border-amber-200 bg-amber-50 text-amber-900";
}

function providerGuidance(row: SocialConnectionRow) {
  if (row.platform === "facebook") {
    return "Meta authorization exists, but no publishable Facebook Page is visible. Create or assign the Page to the authorized Meta user/business, grant Page publishing access, then reconnect.";
  }
  if (row.platform === "instagram") {
    return "Meta authorization exists, but no Instagram Business/Creator account is linked to an accessible Facebook Page. Complete that Meta linkage, then reconnect.";
  }
  if (row.platform === "google_business") {
    return "Google Business Profile is tracked in legacy connection data, but this managed control plane does not yet implement its OAuth connector. No reconnect button is exposed.";
  }
  if (row.platform === "pinterest") {
    return "Pinterest is tracked in legacy connection data, but this managed control plane does not yet implement its OAuth connector. No reconnect button is exposed.";
  }
  if (row.health.operatorAction === "reconnect") {
    return "The stored authorization is expired or invalid. A new provider authorization is required before managed publishing can resume.";
  }
  if (row.health.operatorAction === "connect") {
    return "No active OAuth credential is stored. Complete provider authorization to establish this connection.";
  }
  if (row.health.operatorAction === "refresh") {
    return "The managed worker can refresh this authorization server-side. No operator reconnect is required yet.";
  }
  if (row.health.operatorAction === "sync") {
    return "Authorization is present; the managed worker is responsible for refreshing the provider profile evidence.";
  }
  return "Provider authorization and profile evidence are healthy. The managed worker will continue monitoring this connection.";
}

function Metric({
  label,
  value,
  detail,
  alert = false,
}: {
  label: string;
  value: number | string;
  detail: string;
  alert?: boolean;
}) {
  return (
    <article
      className={
        "rounded-2xl border bg-white p-4 shadow-sm " +
        (alert ? "border-amber-200" : "border-slate-200")
      }
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.13em] text-slate-400">
        {label}
      </p>
      <p
        className={
          "mt-2 text-2xl font-semibold tracking-tight " +
          (alert ? "text-amber-800" : "text-slate-950")
        }
      >
        {value}
      </p>
      <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

export function SocialConnectionsWorkspace() {
  const searchParams = useSearchParams();
  const [data, setData] = useState<SocialPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/platform/social/connections", {
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to load social connection health");
      }
      setData(body as SocialPayload);
    } catch (loadError) {
      setData(null);
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load social connection health",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const oauthResult = searchParams.get("oauth");
  const oauthPlatform = searchParams.get("platform");
  const oauthMessage = searchParams.get("message");

  const resultBanner = useMemo(() => {
    if (!oauthResult) return null;
    if (oauthResult === "connected") {
      return {
        className: "border-emerald-200 bg-emerald-50 text-emerald-900",
        title: (oauthPlatform ?? "Provider") + " connected",
        detail:
          oauthMessage ??
          "The OAuth authorization and provider profile were verified.",
      };
    }
    if (oauthResult === "attention") {
      return {
        className: "border-cyan-200 bg-cyan-50 text-cyan-900",
        title: (oauthPlatform ?? "Provider") + " needs provider setup",
        detail:
          oauthMessage ??
          "Authorization succeeded, but provider-side account setup still needs attention.",
      };
    }
    return {
      className: "border-rose-200 bg-rose-50 text-rose-900",
      title: (oauthPlatform ?? "Provider") + " connection failed",
      detail:
        oauthMessage ??
        "Authorization did not complete. Review provider configuration and try again.",
    };
  }, [oauthMessage, oauthPlatform, oauthResult]);

  async function beginOauth(row: SocialConnectionRow) {
    if (!data?.authority.canManage || !row.oauth.supported || !row.oauth.configured) {
      return;
    }
    setStartingId(row.id);
    setError(null);
    try {
      const response = await fetch(
        "/api/platform/social/connections/" +
          encodeURIComponent(row.id) +
          "/oauth/start",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Unable to start OAuth authorization");
      }
      if (typeof body.authorizeUrl !== "string" || !body.authorizeUrl) {
        throw new Error("Provider authorization URL was not returned");
      }
      window.location.assign(body.authorizeUrl);
    } catch (startError) {
      setError(
        startError instanceof Error
          ? startError.message
          : "Unable to start OAuth authorization",
      );
      setStartingId(null);
    }
  }

  if (loading && !data) {
    return (
      <div className="grid min-h-72 place-items-center rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 size={18} className="animate-spin text-blue-600" />
          Loading social provider evidence…
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <section className="rounded-3xl border border-rose-200 bg-rose-50 p-6">
        <h2 className="font-semibold text-rose-950">
          Social connection authority unavailable
        </h2>
        <p className="mt-2 text-sm leading-6 text-rose-800">
          {error ?? "The Platform social connection API is unavailable."}
        </p>
        <button
          type="button"
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
      {resultBanner ? (
        <section
          className={
            "rounded-2xl border px-4 py-3 text-sm " + resultBanner.className
          }
        >
          <p className="font-semibold">{resultBanner.title}</p>
          <p className="mt-1 leading-6 opacity-90">{resultBanner.detail}</p>
        </section>
      ) : null}

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric
          label="Connections"
          value={data.summary.total}
          detail="non-paused OAuth records"
        />
        <Metric
          label="Healthy"
          value={data.summary.healthy}
          detail="monitor only"
        />
        <Metric
          label="Reconnect"
          value={data.summary.reconnectRequired}
          detail="expired or invalid grants"
          alert={data.summary.reconnectRequired > 0}
        />
        <Metric
          label="Provider setup"
          value={data.summary.providerSetupRequired}
          detail="authorized but not publishable"
          alert={data.summary.providerSetupRequired > 0}
        />
        <Metric
          label="Connector gap"
          value={data.summary.integrationRequired}
          detail="managed OAuth not implemented"
          alert={data.summary.integrationRequired > 0}
        />
        <Metric
          label="Credential vault"
          value={data.encryptionReady ? "Ready" : "Blocked"}
          detail="AES-GCM server-side storage"
          alert={!data.encryptionReady}
        />
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              Managed provider authority
            </p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
              Connection recovery queue
            </h2>
            <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
              Provider tokens never render here. Reconnect starts a new audited
              OAuth authorization; unsupported connectors remain blocked instead
              of accepting manual token entry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            Refresh evidence
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {data.rows.map((row) => {
            const action = row.health.operatorAction;
            const canAuthorize =
              data.authority.canManage &&
              row.oauth.supported &&
              row.oauth.configured &&
              ["connect", "reconnect", "provider_setup"].includes(action);
            const buttonLabel =
              action === "connect"
                ? "Connect provider"
                : action === "provider_setup"
                  ? "Reconnect after setup"
                  : "Reconnect provider";

            return (
              <article key={row.id} className="p-5 sm:p-6">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-950">
                        {platformLabel(row)}
                      </h3>
                      <span
                        className={
                          "rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.1em] " +
                          actionClass(action)
                        }
                      >
                        {actionLabel(action)}
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-slate-600">
                        {row.publishMode}
                      </span>
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {row.handle || "No provider handle"}
                      {row.orgName ? " · " + row.orgName : ""}
                    </p>
                    <p className="mt-2 max-w-4xl text-xs leading-5 text-slate-600">
                      {providerGuidance(row)}
                    </p>

                    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                          Authorization
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-800">
                          {row.connected ? "Encrypted credential" : "Not connected"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                          Account binding
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-800">
                          {row.externalAccountBound ? "Bound" : "Not bound"}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                          Token expiry
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-800">
                          {formatDate(row.tokenExpiresAt)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[9px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                          Verified
                        </p>
                        <p className="mt-1 text-xs font-semibold text-slate-800">
                          {formatDate(row.lastVerifiedAt)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="w-full shrink-0 xl:w-64">
                    {action === "integration_required" ? (
                      <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
                        <div className="flex items-start gap-2 text-violet-800">
                          <Wrench size={15} className="mt-0.5 shrink-0" />
                          <p className="text-xs leading-5">
                            Connector implementation is required before this
                            provider can be authorized here.
                          </p>
                        </div>
                      </div>
                    ) : action === "monitor" ? (
                      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-start gap-2 text-emerald-800">
                          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
                          <p className="text-xs leading-5">
                            No operator action is required. Managed monitoring is
                            active.
                          </p>
                        </div>
                      </div>
                    ) : action === "refresh" || action === "sync" ? (
                      <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                        <div className="flex items-start gap-2 text-blue-800">
                          <RotateCcw size={15} className="mt-0.5 shrink-0" />
                          <p className="text-xs leading-5">
                            The managed worker owns this maintenance action; no
                            manual token operation is needed.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        disabled={!canAuthorize || startingId === row.id}
                        onClick={() => void beginOauth(row)}
                        title={
                          !data.authority.canManage
                            ? "platform.social.manage is required"
                            : !row.oauth.configured
                              ? "OAuth client or encrypted credential storage is not configured"
                              : undefined
                        }
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                      >
                        {startingId === row.id ? (
                          <Loader2 size={15} className="animate-spin" />
                        ) : (
                          <Link2 size={15} />
                        )}
                        {buttonLabel}
                      </button>
                    )}

                    {!row.oauth.supported ? (
                      <p className="mt-2 text-[10px] leading-5 text-slate-500">
                        Managed OAuth support: not implemented.
                      </p>
                    ) : !row.oauth.configured ? (
                      <p className="mt-2 text-[10px] leading-5 text-amber-700">
                        OAuth client configuration is incomplete; authorization
                        remains fail-closed.
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 text-[11px] text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>
            Evidence generated {new Date(data.generatedAt).toLocaleString()}
          </span>
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={12} />
            OAuth state is encrypted and time-bounded · credentials never render
          </span>
        </div>
      </section>

      {!data.authority.canManage ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3 text-amber-900">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold">Read-only social authority</p>
              <p className="mt-1 text-xs leading-5">
                platform.social.manage is required to initiate OAuth connection
                or reconnection. Health evidence remains visible.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <Unplug size={16} className="mt-0.5 shrink-0 text-slate-500" />
          <div>
            <p className="text-sm font-semibold text-slate-900">
              No manual-token recovery path
            </p>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              Expired or invalid grants must be replaced through the provider's
              authorization screen. The control plane never accepts pasted
              access tokens or exposes encrypted credential material.
            </p>
          </div>
          <ExternalLink size={13} className="ml-auto shrink-0 text-slate-300" />
        </div>
      </section>
    </div>
  );
}
