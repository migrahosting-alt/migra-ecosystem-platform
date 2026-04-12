"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/button";
import { VpsDetailGrid } from "@/components/app/vps-ui";

type BackupPolicyView = {
  enabled: boolean;
  region?: string | null | undefined;
  lastSyncedAt?: string | null | undefined;
  policy: {
    status: string;
    frequency: string;
    retentionCount: number;
    encrypted: boolean;
    crossRegion: boolean;
    backupWindow?: string | null | undefined;
    lastSuccessAt?: string | null | undefined;
    nextRunAt?: string | null | undefined;
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

  const summaryCards = [
    {
      label: "Policy state",
      value: backupState.policy?.status || (backupState.enabled ? "ACTIVE" : "DISABLED"),
      helper: backupState.enabled ? "Managed recovery policy is attached to this server." : "Managed backups are currently disabled.",
    },
    {
      label: "Retention",
      value: backupState.policy?.retentionCount ? `${backupState.policy.retentionCount} points` : "Not configured",
      helper: backupState.policy?.frequency || "No frequency configured",
    },
    {
      label: "Last success",
      value: formatDateTime(backupState.policy?.lastSuccessAt),
      helper: `Next run ${formatDateTime(backupState.policy?.nextRunAt)}`,
    },
    {
      label: "Replication",
      value: backupState.policy?.crossRegion ? "Cross-region enabled" : "Primary region only",
      helper: backupState.region || "Primary region",
    },
  ];

  return (
    <div className="space-y-4 pb-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map((card) => (
          <article key={card.label} className="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-[0_14px_30px_rgba(15,23,42,0.05)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">{card.label}</p>
            <p className="mt-2 text-xl font-semibold tracking-tight text-slate-950">{card.value}</p>
            <p className="mt-3 text-sm leading-6 text-slate-500">{card.helper}</p>
          </article>
        ))}
      </section>

      <div className="grid grid-cols-12 gap-4 xl:items-start">
        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] xl:col-span-5">
          <div className="mb-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Recovery posture</p>
            <h2 className="mt-1 text-[28px] font-semibold tracking-tight text-slate-950">Backup Inventory</h2>
          </div>
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
        </section>

        <section className="col-span-12 rounded-[28px] border border-slate-200 bg-white px-5 py-5 shadow-[0_18px_42px_rgba(15,23,42,0.06)] xl:col-span-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Policy editor</p>
              <h2 className="mt-1 text-[32px] font-semibold tracking-tight text-slate-950">Recovery Control Surface</h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                Change scheduling, retention, encryption, and copy placement without relying on plan-specific assumptions.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-slate-900">Frequency</span>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={form.frequency}
              onChange={(event) => setForm((current) => ({ ...current, frequency: event.target.value }))}
              disabled={!canManageBackups || isPending}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-slate-900">Retention count</span>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              type="number"
              min={1}
              max={365}
              value={form.retentionCount}
              onChange={(event) => setForm((current) => ({ ...current, retentionCount: Math.max(1, Number(event.target.value) || 1) }))}
              disabled={!canManageBackups || isPending}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-slate-900">Backup window</span>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={form.backupWindow}
              onChange={(event) => setForm((current) => ({ ...current, backupWindow: event.target.value }))}
              placeholder="02:00-04:00 UTC"
              disabled={!canManageBackups || isPending}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-slate-900">Replication region</span>
            <input
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              value={form.region}
              onChange={(event) => setForm((current) => ({ ...current, region: event.target.value }))}
              placeholder="us-east-2"
              disabled={!canManageBackups || isPending}
            />
          </label>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
              disabled={!canManageBackups || isPending}
            />
            Enable backups
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.encrypted}
              onChange={(event) => setForm((current) => ({ ...current, encrypted: event.target.checked }))}
              disabled={!canManageBackups || isPending}
            />
            Encrypt backup copies
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-900">
            <input
              type="checkbox"
              checked={form.crossRegion}
              onChange={(event) => setForm((current) => ({ ...current, crossRegion: event.target.checked }))}
              disabled={!canManageBackups || isPending}
            />
            Keep cross-region copy
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
            <div>
              {!canManageBackups ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
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
            </div>

            <aside className="rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Operator guidance</p>
              <div className="mt-3 space-y-3 text-sm leading-6 text-slate-600">
                <p>Keep retention high enough to cover both operator error and delayed incident discovery windows.</p>
                <p>Use encryption for any customer-bearing workload and enable cross-region copies when regional resilience matters.</p>
                <p>Prefer an explicit backup window for noisy workloads so backup I/O stays predictable during peak hours.</p>
              </div>
            </aside>
          </div>
        </section>
      </div>
    </div>
  );
}