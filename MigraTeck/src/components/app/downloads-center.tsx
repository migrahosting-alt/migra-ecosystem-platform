"use client";

import { ProductKey } from "@prisma/client";
import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface DownloadRow {
  id: string;
  name: string;
  product: ProductKey;
  version: string;
  sha256: string;
  sizeBytes: string;
  entitled: boolean;
  entitlementStatus: string;
  reason: string | null;
}

interface DownloadsCenterProps {
  orgName: string;
  artifacts: DownloadRow[];
}

function formatSize(input: string): string {
  const size = Number(input);
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function DownloadsCenter({ orgName, artifacts }: DownloadsCenterProps) {
  const [busyArtifactId, setBusyArtifactId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startDownload(artifactId: string) {
    setBusyArtifactId(artifactId);
    setError(null);

    const response = await fetch(`/api/downloads/${artifactId}/sign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const payload = (await response.json().catch(() => null)) as { error?: string; signedUrl?: string } | null;
    setBusyArtifactId(null);

    if (!response.ok || !payload?.signedUrl) {
      setError(payload?.error || "Unable to issue download URL.");
      return;
    }

    window.location.assign(payload.signedUrl);
  }

  const grouped = artifacts.reduce(
    (accumulator, artifact) => {
      if (!accumulator[artifact.product]) {
        accumulator[artifact.product] = [];
      }
      accumulator[artifact.product].push(artifact);
      return accumulator;
    },
    {} as Record<ProductKey, DownloadRow[]>,
  );

  return (
    <section className="space-y-5">
      <h1 className="text-3xl font-black tracking-tight">Downloads</h1>
      <p className="text-sm text-[var(--ink-muted)]">Artifacts available to {orgName} based on entitlement and policy context.</p>
      {error ? <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <div className="space-y-4">
        {Object.keys(grouped).length === 0 ? (
          <p className="rounded-2xl border border-[var(--line)] bg-white p-4 text-sm text-[var(--ink-muted)]">
            No active artifacts are published yet.
          </p>
        ) : null}
        {(Object.entries(grouped) as [ProductKey, DownloadRow[]][]).map(([product, rows]) => (
          <article key={product} className="rounded-2xl border border-[var(--line)] bg-white p-5">
            <h2 className="text-lg font-bold">{product}</h2>
            <div className="mt-3 space-y-3">
              {rows.map((artifact) => (
                <div key={artifact.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[var(--ink)]">{artifact.name}</p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        Version {artifact.version} · {formatSize(artifact.sizeBytes)}
                      </p>
                      <p className="mt-1 text-xs font-mono text-[var(--ink-muted)]">SHA256: {artifact.sha256}</p>
                    </div>
                    {artifact.entitled ? (
                      <ActionButton
                        disabled={busyArtifactId === artifact.id}
                        onClick={() => void startDownload(artifact.id)}
                      >
                        {busyArtifactId === artifact.id ? "Signing..." : "Download"}
                      </ActionButton>
                    ) : (
                      <span className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">
                        Not entitled
                      </span>
                    )}
                  </div>
                  {!artifact.entitled ? (
                    <p className="mt-2 text-xs text-amber-800">
                      Access status: {artifact.entitlementStatus}
                      {artifact.reason ? ` (${artifact.reason})` : ""}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
