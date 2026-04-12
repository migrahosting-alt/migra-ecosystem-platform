"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VpsFleetProviderStatus } from "@/lib/vps/types";

const buttonBase = "inline-flex h-9 items-center justify-center rounded-lg border px-4 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:opacity-50";

const tones = {
  primary: "border-transparent bg-indigo-600 text-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] hover:bg-indigo-700",
  neutral: "border-slate-200/60 bg-white text-slate-700 shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-slate-300 hover:text-slate-900",
  muted: "border-slate-200/60 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-700",
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
    <div className="w-full lg:max-w-[620px]">
      <div className="flex flex-col gap-2 lg:items-end">
        <div id="vps-fleet-actions" className="flex flex-wrap justify-start gap-2 lg:justify-end">
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
        </div>
        <button
          className={`${buttonClass(showProviderGuide ? "neutral" : "muted")} w-full sm:w-auto`}
          onClick={() => setShowProviderGuide((current) => !current)}
        >
          Connect provider
        </button>
      </div>

      {showProviderGuide ? (
        <div className="mt-3 rounded-xl border border-slate-200/60 bg-white px-4 py-3 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_32px_rgba(0,0,0,0.04)]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">Provider onboarding</p>
              <p className="mt-1 text-[13px] font-semibold text-slate-800">Connect runtime credentials, then import or sync inventory.</p>
            </div>
            <a href="#vps-provider-fabric" className="text-[11px] font-medium text-indigo-600">
              Review providers
            </a>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {providers.map((provider) => (
              <div key={provider.slug} className="rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-semibold text-slate-800">{provider.label}</p>
                  <span className={`inline-flex rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${provider.configured ? "border-emerald-200/60 bg-emerald-50 text-emerald-600" : "border-slate-200 bg-slate-50 text-slate-400"}`}>
                    {provider.configured ? "Ready" : "Missing"}
                  </span>
                </div>
                <p className="mt-1 text-[11px] leading-4 text-slate-400">{provider.detail}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-4 text-slate-400">
            Runtime ready unlocks live sync, provider reconciliation, and lifecycle actions.
          </p>
        </div>
      ) : null}

      {message ? <p className="mt-2 text-[12px] text-slate-500 lg:text-right">{message}</p> : null}
    </div>
  );
}