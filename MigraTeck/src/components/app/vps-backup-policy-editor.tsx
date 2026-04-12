"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/button";
import { VpsDetailGrid, VpsSectionCard } from "@/components/app/vps-ui";

type BackupPolicyView = {
  enabled: boolean;
  region?: string | null;
  lastSyncedAt?: string | null;
  policy: {
    status: string;
    frequency: string;
    retentionCount: number;
    encrypted: boolean;
    crossRegion: boolean;
    backupWindow?: string | null;
    lastSuccessAt?: string | null;
    nextRunAt?: string | null;
  } | null;
};

type BackupFormState = {
  enabled: boolean;
  frequency: string;
  retentionCount: number;
  encrypted: boolean;
  crossRegion: boolean;
  backupWindow: string;
  region: string;
};

function toFormState(value: BackupPolicyView): BackupFormState {
  return {
    enabled: value.enabled,
    frequency: value.policy?.frequency || "daily",
    retentionCount: value.policy?.retentionCount || 7,
    encrypted: value.policy?.encrypted ?? true,
    crossRegion: value.policy?.crossRegion ?? false,
    backupWindow: value.policy?.backupWindow || "",
    region: value.region || "",
  };
}

function formatDateTime(value?: string | null) {
  if (!value) {
    return "Not scheduled";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function VpsBackupPolicyEditor({
  serverId,
  canManageBackups,
  initialState,
}: {
  serverId: string;
  canManageBackups: boolean;
  initialState: BackupPolicyView;
}) {
  const router = useRouter();
  const [backupState, setBackupState] = useState(initialState);
  const [form, setForm] = useState<BackupFormState>(() => toFormState(initialState));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      enabled?: boolean;
      region?: string | null;
      lastSyncedAt?: string | null;
      policy?: BackupPolicyView["policy"];
      jobId?: string;
      status?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Backup policy request failed.");
    }

    return payload;
  }

  async function refreshState() {
    const payload = await requestJson(`/api/vps/servers/${serverId}/backups`);
    const nextState: BackupPolicyView = {
      enabled: Boolean(payload.enabled),
      region: payload.region || null,
      lastSyncedAt: payload.lastSyncedAt || null,
      policy: payload.policy || null,
    };
    setBackupState(nextState);
    setForm(toFormState(nextState));
  }

  function savePolicy() {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        const payload = await requestJson(`/api/vps/servers/${serverId}/backups`, {
          method: "PUT",
          body: JSON.stringify({
            enabled: form.enabled,
            frequency: form.frequency.trim(),
            retentionCount: form.retentionCount,
            encrypted: form.encrypted,
            crossRegion: form.crossRegion,
            backupWindow: form.backupWindow.trim() || undefined,
            region: form.region.trim() || undefined,
          }),
        });
        await refreshState();
        router.refresh();
        setMessage(
          payload.jobId
            ? `Backup policy update submitted. Job ${payload.jobId} is ${String(payload.status || "queued").toLowerCase()}.`
            : "Backup policy updated.",
        );
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to update backup policy.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <VpsSectionCard title="Recovery posture" description="Live policy state, replication coverage, and current backup schedule.">
        <VpsDetailGrid
          items={[
            { label: "Status", value: backupState.policy?.status || (backupState.enabled ? "ACTIVE" : "DISABLED") },
            { label: "Frequency", value: backupState.policy?.frequency || "Not configured" },
            { label: "Retention", value: backupState.policy?.retentionCount ? `${backupState.policy.retentionCount} restore points` : "Not configured" },
            { label: "Encrypted", value: backupState.policy?.encrypted ? "Yes" : "No" },
            { label: "Cross-region", value: backupState.policy?.crossRegion ? "Enabled" : "Disabled" },
            { label: "Backup window", value: backupState.policy?.backupWindow || "Provider default" },
            { label: "Region", value: backupState.region || "Primary region" },
            { label: "Last success", value: formatDateTime(backupState.policy?.lastSuccessAt) },
            { label: "Next run", value: formatDateTime(backupState.policy?.nextRunAt) },
            { label: "Last sync", value: formatDateTime(backupState.lastSyncedAt) },
          ]}
        />
      </VpsSectionCard>

      <VpsSectionCard title="Policy editor" description="Change scheduling, retention, and recovery-copy settings without hardcoded plan assumptions.">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-[var(--ink)]">Frequency</span>
            <input
              className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              value={form.frequency}
              onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}
              disabled={!canManageBackups || isPending}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-[var(--ink)]">Retention count</span>
            <input
              className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              type="number"
              min={1}
              max={365}
              value={form.retentionCount}
              onChange={(event) => setForm((current) => ({ ...current, retentionCount: Math.max(1, Number(event.target.value) || 1) }))}
              disabled={!canManageBackups || isPending}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-[var(--ink)]">Backup window</span>
            <input
              className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              value={form.backupWindow}
              onChange={(event) => setForm((current) => ({ ...current, backupWindow: event.target.value }))}
              placeholder="02:00-04:00 UTC"
              disabled={!canManageBackups || isPending}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-[var(--ink)]">Replication region</span>
            <input
              className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              value={form.region}
              onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))}
              placeholder="us-east-2"
              disabled={!canManageBackups || isPending}
            />
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm font-medium text-[var(--ink)]">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              disabled={!canManageBackups || isPending}
            />
            Enable backups
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm font-medium text-[var(--ink)]">
            <input
              type="checkbox"
              checked={form.encrypted}
              onChange={(event) => setForm((current) => ({ ...current, encrypted: event.target.checked }))}
              disabled={!canManageBackups || isPending}
            />
            Encrypt backup copies
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm font-medium text-[var(--ink)]">
            <input
              type="checkbox"
              checked={form.crossRegion}
              onChange={(event) => setForm((current) => ({ ...current, crossRegion: event.target.checked }))}
              disabled={!canManageBackups || isPending}
            />
            Keep cross-region copy
          </label>
        </div>

        {!canManageBackups ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your current role can review backup posture but cannot change the policy.
          </div>
        ) : null}
        {message ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
        {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <ActionButton onClick={savePolicy} disabled={!canManageBackups || isPending || !form.frequency.trim()}>
            {isPending ? "Saving..." : "Save Backup Policy"}
          </ActionButton>
          <ActionButton variant="secondary" onClick={() => setForm(toFormState(backupState))} disabled={isPending}>
            Reset Form
          </ActionButton>
        </div>
      </VpsSectionCard>
    </div>
  );
}