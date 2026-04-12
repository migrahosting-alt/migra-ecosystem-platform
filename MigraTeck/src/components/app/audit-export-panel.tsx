"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface AuditExportPanelProps {
  orgId: string;
}

export function AuditExportPanel({ orgId }: AuditExportPanelProps) {
  const [format, setFormat] = useState<"csv" | "json">("csv");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function downloadExport() {
    const params = new URLSearchParams();
    params.set("orgId", orgId);
    params.set("format", format);

    if (from) {
      params.set("from", new Date(from).toISOString());
    }

    if (to) {
      params.set("to", new Date(to).toISOString());
    }

    window.location.assign(`/api/audit/export?${params.toString()}`);
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <h2 className="text-lg font-bold">Export audit data</h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">Download JSON or CSV evidence scoped to a selected date range.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Format</span>
          <select value={format} onChange={(event) => setFormat(event.target.value as "csv" | "json")} className="w-full rounded-xl border border-[var(--line)] px-3 py-2">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">From</span>
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">To</span>
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <div className="flex items-end">
          <ActionButton className="w-full" onClick={downloadExport}>
            Download export
          </ActionButton>
        </div>
      </div>
    </article>
  );
}
