"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

type ConsoleSessionState = {
  supported: boolean;
  launchUrl?: string;
  expiresAt?: string;
  message?: string;
  mode: "FULL" | "VIEW_ONLY";
};

export function VpsConsoleLauncher({
  serverId,
  disabled = false,
}: {
  serverId: string;
  disabled?: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<ConsoleSessionState | null>(null);

  async function launchConsole() {
    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch(`/api/vps/servers/${serverId}/console/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: "{}",
      });
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        session?: ConsoleSessionState;
      } | null;

      if (!response.ok) {
        setSession(null);
        setMessage(payload?.error || "Unable to create console session.");
        return;
      }

      if (!payload?.session?.supported) {
        setSession(payload?.session || null);
        setMessage(payload?.session?.message || "Console session is unavailable for this provider or server.");
        return;
      }

      setSession(payload.session);
      setMessage(
        payload.session.expiresAt
          ? `Console session ready until ${new Date(payload.session.expiresAt).toLocaleTimeString()}.`
          : "Console session ready.",
      );

      if (payload.session.launchUrl) {
        window.open(payload.session.launchUrl, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create console session.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        className="rounded-xl border border-[var(--line)] bg-white px-4 py-2 text-sm font-semibold text-[var(--ink)] transition hover:bg-[var(--surface-2)] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || loading}
        onClick={() => void launchConsole()}
      >
        {loading ? "Launching..." : "Launch Console Session"}
      </button>
      {message ? <p className="text-sm text-[var(--ink-muted)]">{message}</p> : null}
      {session ? (
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Session status: {session.supported ? "Ready" : "Unavailable"}</p>
            <span className="rounded-full border border-[var(--line)] bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--ink-muted)]">
              {session.mode === "VIEW_ONLY" ? "View Only" : "Interactive"}
            </span>
          </div>
          {session.expiresAt ? (
            <p className="mt-2 text-xs text-[var(--ink-muted)]">Expires {new Date(session.expiresAt).toLocaleString()}</p>
          ) : null}
          {session.message ? <p className="mt-2 text-sm text-[var(--ink-muted)]">{session.message}</p> : null}
          {session.launchUrl ? (
            <div className="mt-3 space-y-2">
              <p className="break-all text-xs text-[var(--ink-muted)]">Launch URL: {session.launchUrl}</p>
              <ActionButton variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.open(session.launchUrl, "_blank", "noopener,noreferrer")}>
                Open Session
              </ActionButton>
            </div>
          ) : null}
          {session.launchUrl ? (
            <p className="mt-2 text-xs text-[var(--ink-muted)]">If the browser blocks the new tab, use the direct launch URL above.</p>
          ) : null}
        </div>
      ) : null}
      {session?.launchUrl ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
          <ActionButton variant="secondary" className="px-3 py-1.5 text-xs" onClick={() => window.open(session.launchUrl, "_blank", "noopener,noreferrer")}>
            Open Again
          </ActionButton>
        </div>
      ) : null}
    </div>
  );
}
