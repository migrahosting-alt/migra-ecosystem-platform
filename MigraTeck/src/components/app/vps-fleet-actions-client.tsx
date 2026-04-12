"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VpsFleetProviderStatus } from "@/lib/vps/types";

const buttonBase = "rounded-full border px-5 py-2.5 text-sm font-semibold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50";

const tones = {
  primary: "border-teal-700 bg-teal-700 text-white hover:bg-teal-800",
  neutral: "border-slate-300 bg-white text-slate-900 hover:bg-slate-50",
  muted: "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200",
} as const;

function buttonClass(tone: keyof typeof tones) {
  return `${buttonBase} ${tones[tone]}`;
}

function formatFleetMessage(label: string, payload?: {
  totalImported?: number;
  okCount?: number;
  providers?: Array<{ ok: boolean; error?: string }>;
} | null) {
  if (!payload) {
    return `${label} completed.`;
  }

  if (payload.okCount === 0) {
    return payload.providers?.find((provider) => provider.error)?.error || `${label} failed.`;
  }

  if ((payload.totalImported || 0) === 0) {
    return `${label} completed. No provider inventory was discovered.`;
  }

  return `${label} completed. ${payload.totalImported} ${payload.totalImported === 1 ? "server" : "servers"} reconciled.`;
}

export function VpsFleetActionsClient({
  canManage,
  canImportFromProviders,
  deployHref,
  providers,
}: {
  canManage: boolean;
  canImportFromProviders: boolean;
  deployHref: string;
  providers: VpsFleetProviderStatus[];
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showProviderGuide, setShowProviderGuide] = useState(false);

  async function runFleetAction(label: string) {
    setBusyAction(label);
    setMessage(null);

    try {
      const response = await fetch("/api/vps/servers/sync", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        totalImported?: number;
        okCount?: number;
        providers?: Array<{ ok: boolean; error?: string }>;
      } | null;

      if (!response.ok) {
        setMessage(payload?.error || `${label} failed.`);
        return;
      }

      setMessage(formatFleetMessage(label, payload));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="w-full max-w-[620px] space-y-3 lg:text-right">
      <div id="vps-fleet-actions" className="flex flex-wrap justify-start gap-3 lg:justify-end">
        <Link href={deployHref} className={buttonClass("primary")}>
          Deploy
        </Link>
        <button
          className={buttonClass("neutral")}
          disabled={!canManage || !canImportFromProviders || busyAction !== null}
          onClick={() => void runFleetAction("Import")}
        >
          {busyAction === "Import" ? "Importing..." : "Import"}
        </button>
        <button
          className={buttonClass("neutral")}
          disabled={!canManage || !canImportFromProviders || busyAction !== null}
          onClick={() => void runFleetAction("Sync")}
        >
          {busyAction === "Sync" ? "Syncing..." : "Sync now"}
        </button>
        <button
          className={buttonClass(showProviderGuide ? "primary" : "muted")}
          onClick={() => setShowProviderGuide((current) => !current)}
        >
          Connect provider
        </button>
      </div>

      {showProviderGuide ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">Provider onboarding</p>
              <p className="mt-1 text-sm font-semibold text-[var(--ink)]">Connect runtime credentials to turn this workspace into a live control plane.</p>
            </div>
            <a href="#vps-provider-fabric" className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--brand-600)]">
              Review providers
            </a>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {providers.map((provider) => (
              <div key={provider.slug} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[var(--ink)]">{provider.label}</p>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ${provider.configured ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-700"}`}>
                    {provider.configured ? "Ready" : "Missing"}
                  </span>
                </div>
                <p className="mt-2 text-xs leading-5 text-[var(--ink-muted)]">{provider.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-[var(--ink-muted)]">
            After credentials are available, use Import or Sync to reconcile provider inventory into the fleet.
          </p>
        </div>
      ) : null}

      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
    </div>
  );
}