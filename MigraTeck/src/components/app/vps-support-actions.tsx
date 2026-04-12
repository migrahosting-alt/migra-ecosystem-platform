"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/button";

type CreatedTicket = {
  id: string;
  externalTicketId?: string | null;
  title?: string | null;
  category?: string | null;
  priority?: string | null;
  status: string;
  url?: string | null;
  createdAt: string;
  updatedAt: string;
};

export function VpsSupportActions({
  serverId,
  canOpenSupport,
  diagnosticsEnabled,
  supportPortalUrl,
}: {
  serverId: string;
  canOpenSupport: boolean;
  diagnosticsEnabled: boolean;
  supportPortalUrl?: string | null;
}) {
  const [title, setTitle] = useState("Need help with this server");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("normal");
  const [details, setDetails] = useState("");
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createdTicket, setCreatedTicket] = useState<CreatedTicket | null>(null);
  const [isPending, startTransition] = useTransition();

  async function requestJson(path: string, init?: RequestInit) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init?.headers || {}),
      },
    });

    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
      ticket?: CreatedTicket;
      supportPortalUrl?: string | null;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Support request failed.");
    }

    return payload;
  }

  function downloadDiagnostics() {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);

        const response = await fetch(`/api/vps/servers/${serverId}/support/diagnostics`, {
          method: "GET",
          cache: "no-store",
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error || "Unable to export diagnostics bundle.");
        }

        const payload = await response.json();
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `vps-${serverId}-diagnostics.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setMessage("Diagnostics bundle downloaded.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to export diagnostics bundle.");
      }
    });
  }

  function createSupportRequest() {
    startTransition(async () => {
      try {
        if (!title.trim() || !details.trim()) {
          setError("Enter a request title and details before submitting.");
          return;
        }

        setError(null);
        setMessage(null);

        const payload = await requestJson(`/api/vps/servers/${serverId}/support`, {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            category,
            priority,
            details: details.trim(),
            includeDiagnostics,
          }),
        });

        setCreatedTicket(payload.ticket || null);
        setDetails("");
        setMessage(payload.ticket?.url
          ? "Support request created and linked to the external support portal."
          : "Support request created and attached to this VPS.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to create support request.");
      }
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
      <div className="flex flex-wrap gap-3">
        {diagnosticsEnabled ? (
          <ActionButton variant="secondary" onClick={downloadDiagnostics} disabled={isPending}>
            {isPending ? "Working..." : "Download Diagnostics JSON"}
          </ActionButton>
        ) : null}
        {supportPortalUrl ? (
          <ActionButton variant="secondary" onClick={() => window.open(supportPortalUrl, "_blank", "noopener,noreferrer")} disabled={isPending}>
            Open Support Portal
          </ActionButton>
        ) : null}
      </div>

      {!canOpenSupport ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Your current role can review diagnostics but cannot create new support requests for this VPS.
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-[var(--ink)]">Request title</span>
              <input
                className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-[var(--ink)]">Category</span>
              <select
                className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="general">General</option>
                <option value="console">Console / access</option>
                <option value="networking">Networking</option>
                <option value="firewall">Firewall</option>
                <option value="performance">Performance</option>
                <option value="backup">Backup / restore</option>
                <option value="billing">Billing</option>
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="font-semibold text-[var(--ink)]">Priority</span>
              <select
                className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                value={priority}
                onChange={(event) => setPriority(event.target.value)}
              >
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
            <label className="inline-flex items-center gap-2 self-end text-sm text-[var(--ink)]">
              <input
                type="checkbox"
                checked={includeDiagnostics}
                onChange={(event) => setIncludeDiagnostics(event.target.checked)}
              />
              Attach diagnostics summary to request metadata
            </label>
          </div>

          <label className="space-y-2 text-sm">
            <span className="font-semibold text-[var(--ink)]">Details</span>
            <textarea
              className="min-h-32 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              value={details}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Describe the issue, expected behavior, and any recent actions taken on this server."
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <ActionButton onClick={createSupportRequest} disabled={isPending}>
              {isPending ? "Submitting..." : "Create Support Request"}
            </ActionButton>
          </div>
        </div>
      )}

      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      {createdTicket ? (
        <div className="rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-[var(--ink)]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{createdTicket.title || "Support request"}</p>
            <span className="text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">{createdTicket.status}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {createdTicket.externalTicketId || createdTicket.id} · {new Date(createdTicket.createdAt).toLocaleString()}
          </p>
          {createdTicket.url ? (
            <div className="mt-3">
              <ActionButton variant="secondary" onClick={() => window.open(createdTicket.url || "", "_blank", "noopener,noreferrer")}>
                Open Linked Ticket Portal
              </ActionButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}