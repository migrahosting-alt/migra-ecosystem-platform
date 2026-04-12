"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/button";
import { VpsEmptyState, VpsSectionCard } from "@/components/app/vps-ui";

type SnapshotItem = {
  id: string;
  name: string;
  note?: string | null;
  status: string;
  sizeGb?: number | null;
  createdBy?: string | null;
  createdAt: string;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildJobMessage(action: string, payload: { jobId?: string; status?: string }) {
  if (payload.jobId) {
    return `${action} submitted. Job ${payload.jobId} is ${String(payload.status || "queued").toLowerCase()}.`;
  }

  return `${action} submitted.`;
}

export function VpsSnapshotManager({
  serverId,
  canManageSnapshots,
  initialSnapshots,
}: {
  serverId: string;
  canManageSnapshots: boolean;
  initialSnapshots: SnapshotItem[];
}) {
  const router = useRouter();
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [snapshotName, setSnapshotName] = useState("");
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
      snapshots?: SnapshotItem[];
      jobId?: string;
      status?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error || "Snapshot request failed.");
    }

    return payload;
  }

  async function refreshSnapshots() {
    const payload = await requestJson(`/api/vps/servers/${serverId}/snapshots`);
    setSnapshots(payload.snapshots || []);
  }

  function createSnapshot() {
    startTransition(async () => {
      try {
        const name = snapshotName.trim();
        if (!name) {
          setError("Enter a snapshot name.");
          return;
        }

        setError(null);
        setMessage(null);
        const payload = await requestJson(`/api/vps/servers/${serverId}/snapshots`, {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        setSnapshotName("");
        await refreshSnapshots();
        router.refresh();
        setMessage(buildJobMessage("Snapshot creation", payload));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to create snapshot.");
      }
    });
  }

  function restoreSnapshot(snapshot: SnapshotItem) {
    if (!window.confirm(`Restore snapshot \"${snapshot.name}\"? This can overwrite the current disk state.`)) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        const payload = await requestJson(`/api/vps/servers/${serverId}/snapshots/${snapshot.id}/restore`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        await refreshSnapshots();
        router.refresh();
        setMessage(buildJobMessage(`Restore for ${snapshot.name}`, payload));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to restore snapshot.");
      }
    });
  }

  function deleteSnapshot(snapshot: SnapshotItem) {
    if (!window.confirm(`Delete snapshot \"${snapshot.name}\"? This cannot be undone.`)) {
      return;
    }

    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        const payload = await requestJson(`/api/vps/servers/${serverId}/snapshots/${snapshot.id}`, {
          method: "DELETE",
        });
        await refreshSnapshots();
        router.refresh();
        setMessage(buildJobMessage(`Deletion for ${snapshot.name}`, payload));
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to delete snapshot.");
      }
    });
  }

  return (
    <div className="space-y-6">
      <VpsSectionCard title="Snapshot operations" description="Create checkpoints and run restore or delete actions with audited job tracking.">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="space-y-2 text-sm">
            <span className="font-semibold text-[var(--ink)]">New snapshot name</span>
            <input
              className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
              value={snapshotName}
              onChange={(event) => setSnapshotName(event.target.value)}
              placeholder="pre-upgrade-checkpoint"
              disabled={!canManageSnapshots || isPending}
            />
          </label>
          <ActionButton onClick={createSnapshot} disabled={!canManageSnapshots || isPending || !snapshotName.trim()}>
            {isPending ? "Submitting..." : "Create Snapshot"}
          </ActionButton>
        </div>

        {!canManageSnapshots ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Your current role can review snapshots but cannot create, restore, or delete them.
          </div>
        ) : null}
        {message ? <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
        {error ? <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
      </VpsSectionCard>

      <VpsSectionCard title="Snapshot inventory" description="Point-in-time restore anchors with current provider sync state.">
        {!snapshots.length ? (
          <VpsEmptyState
            title="No snapshots yet"
            description="Create a checkpoint before rebuilds, firewall changes, or major operating system work."
          />
        ) : (
          <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
            <table className="min-w-full border-collapse text-sm">
              <thead className="bg-[var(--surface-2)] text-left text-[var(--ink-muted)]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Name</th>
                  <th className="px-4 py-3 font-semibold">Created</th>
                  <th className="px-4 py-3 font-semibold">Size</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Created by</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {snapshots.map((snapshot) => (
                  <tr key={snapshot.id} className="border-t border-[var(--line)] align-top">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-[var(--ink)]">{snapshot.name}</p>
                      {snapshot.note ? <p className="mt-1 text-xs text-[var(--ink-muted)]">{snapshot.note}</p> : null}
                    </td>
                    <td className="px-4 py-4 text-[var(--ink-muted)]">{formatDateTime(snapshot.createdAt)}</td>
                    <td className="px-4 py-4 text-[var(--ink-muted)]">{snapshot.sizeGb ? `${snapshot.sizeGb} GB` : "Pending"}</td>
                    <td className="px-4 py-4 font-semibold text-[var(--ink)]">{snapshot.status}</td>
                    <td className="px-4 py-4 text-[var(--ink-muted)]">{snapshot.createdBy || "SYSTEM"}</td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        <ActionButton
                          variant="secondary"
                          onClick={() => restoreSnapshot(snapshot)}
                          disabled={!canManageSnapshots || isPending || snapshot.status !== "READY"}
                        >
                          Restore
                        </ActionButton>
                        <ActionButton
                          variant="ghost"
                          onClick={() => deleteSnapshot(snapshot)}
                          disabled={!canManageSnapshots || isPending || snapshot.status === "RESTORING" || snapshot.status === "DELETING"}
                        >
                          Delete
                        </ActionButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </VpsSectionCard>
    </div>
  );
}