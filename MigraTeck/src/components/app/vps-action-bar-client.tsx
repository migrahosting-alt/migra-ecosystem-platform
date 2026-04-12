"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { VpsSupportedImage } from "@/lib/vps/images";

const buttonBase =
  "rounded-xl border px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

const tones = {
  neutral: "border-[var(--line)] bg-white text-[var(--ink)] hover:bg-[var(--surface-2)]",
  caution: "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100",
  danger: "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100",
} as const;

function buttonClass(tone: keyof typeof tones) {
  return `${buttonBase} ${tones[tone]}`;
}

type ActionResultStatus = "FAILED" | "QUEUED" | "RUNNING" | "SUCCEEDED";

function isUserFacingMessage(message: string | undefined) {
  return Boolean(message && /[\s.]/.test(message));
}

function formatActionMessage(
  label: string,
  result?: { message?: string; status?: ActionResultStatus } | null,
) {
  if (isUserFacingMessage(result?.message)) {
    return result?.message as string;
  }

  switch (result?.status) {
    case "FAILED":
      return `${label} failed.`;
    case "SUCCEEDED":
      return `${label} completed.`;
    case "RUNNING":
    case "QUEUED":
      return `${label} queued.`;
    default:
      return `${label} queued.`;
  }
}

export function VpsActionBarClient({
  serverId,
  serverName,
  currentImageSlug,
  currentOsName,
  availableImages,
  powerState,
  canPowerControl,
  canSync,
  canReboot,
  canRescue,
  canRebuild,
  rebuildEnabled,
}: {
  serverId: string;
  serverName: string;
  currentImageSlug: string;
  currentOsName: string;
  availableImages: VpsSupportedImage[];
  powerState: "ON" | "OFF" | "UNKNOWN";
  canPowerControl: boolean;
  canSync: boolean;
  canReboot: boolean;
  canRescue: boolean;
  canRebuild: boolean;
  rebuildEnabled: boolean;
}) {
  const router = useRouter();
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showRebuildForm, setShowRebuildForm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [selectedImageSlug, setSelectedImageSlug] = useState(
    availableImages.some((image) => image.slug === currentImageSlug)
      ? currentImageSlug
      : (availableImages.find((image) => image.highlighted)?.slug || availableImages[0]?.slug || ""),
  );
  const [rebuildReason, setRebuildReason] = useState("");

  const selectedImage = availableImages.find((image) => image.slug === selectedImageSlug);

  async function runAction(label: string, url: string, body?: Record<string, unknown>) {
    setBusyAction(label);
    setMessage(null);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : "{}",
      });

      const payload = (await response.json().catch(() => null)) as {
        error?: string;
        status?: ActionResultStatus;
        message?: string;
        jobId?: string;
        result?: {
          message?: string;
          status?: ActionResultStatus;
        };
      } | null;

      if (!response.ok) {
        setMessage(payload?.error || `${label} failed.`);
        return;
      }

      setMessage(formatActionMessage(label, payload?.result || (payload ? { message: payload.message, status: payload.status } : null)));
      if (label === "Rebuild") {
        setShowRebuildForm(false);
        setConfirmText("");
        setRebuildReason("");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `${label} failed.`);
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          className={buttonClass("caution")}
          disabled={!canReboot || busyAction !== null}
          onClick={() => void runAction("Reboot", `/api/vps/servers/${serverId}/power/reboot`)}
        >
          {busyAction === "Reboot" ? "Rebooting..." : "Reboot"}
        </button>
        <button
          className={buttonClass("danger")}
          disabled={!canPowerControl || busyAction !== null}
          onClick={() => void runAction(powerState === "ON" ? "Power Off" : "Power On", `/api/vps/servers/${serverId}/power/${powerState === "ON" ? "off" : "on"}`)}
        >
          {busyAction === "Power Off" || busyAction === "Power On" ? "Updating..." : powerState === "ON" ? "Power Off" : "Power On"}
        </button>
        <button
          className={buttonClass("caution")}
          disabled={!canRescue || busyAction !== null}
          onClick={() => void runAction("Rescue", `/api/vps/servers/${serverId}/rescue/${powerState === "ON" ? "enable" : "enable"}`)}
        >
          {busyAction === "Rescue" ? "Updating..." : "Rescue Mode"}
        </button>
        <button
          className={buttonClass("neutral")}
          disabled={!canRescue || busyAction !== null}
          onClick={() => void runAction("Exit Rescue", `/api/vps/servers/${serverId}/rescue/disable`)}
        >
          {busyAction === "Exit Rescue" ? "Updating..." : "Exit Rescue"}
        </button>
        <button
          className={buttonClass("danger")}
          disabled={!canRebuild || !rebuildEnabled || busyAction !== null}
          onClick={() => setShowRebuildForm((current) => !current)}
        >
          {busyAction === "Rebuild" ? "Rebuilding..." : showRebuildForm ? "Close Rebuild" : "Rebuild Server"}
        </button>
        <button
          className={buttonClass("neutral")}
          disabled={!canSync || busyAction !== null}
          onClick={() => void runAction("Sync", `/api/vps/servers/${serverId}/sync`)}
        >
          {busyAction === "Sync" ? "Syncing..." : "Sync"}
        </button>
      </div>
      {showRebuildForm ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">Rebuild with a selected operating system image</p>
              <p className="mt-1 text-sm text-rose-800">This reinstalls the server OS and should only be used after taking a snapshot or confirming the workload can be rebuilt safely.</p>
            </div>
            <span className="rounded-full border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] text-rose-700">
              Destructive Action
            </span>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">Operating system image</span>
                <select
                  value={selectedImageSlug}
                  onChange={(event) => setSelectedImageSlug(event.target.value)}
                  disabled={busyAction !== null || availableImages.length === 0}
                  className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none"
                >
                  {availableImages.map((image) => (
                    <option key={image.slug} value={image.slug}>{image.name}</option>
                  ))}
                </select>
              </label>

              {selectedImage ? (
                <div className="rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-[var(--ink)]">
                  <p className="font-semibold">{selectedImage.name}</p>
                  <p className="mt-1 text-[var(--ink-muted)]">{selectedImage.description}</p>
                  <p className="mt-2 text-xs uppercase tracking-[0.12em] text-[var(--ink-muted)]">
                    Family: {selectedImage.family} · Default login: {selectedImage.defaultUsername}
                  </p>
                </div>
              ) : null}

              <label className="block">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">Reason for reinstall</span>
                <textarea
                  value={rebuildReason}
                  onChange={(event) => setRebuildReason(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Example: Client requested Debian 13 before first production login."
                  disabled={busyAction !== null}
                  className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none"
                />
              </label>
            </div>

            <div className="space-y-3 rounded-xl border border-rose-200 bg-white px-4 py-3 text-sm text-[var(--ink)]">
              <p className="font-semibold">Current install</p>
              <p>{currentOsName} ({currentImageSlug})</p>
              <label className="block pt-2">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-[0.12em] text-rose-700">Type server name to confirm</span>
                <input
                  value={confirmText}
                  onChange={(event) => setConfirmText(event.target.value)}
                  placeholder={serverName}
                  disabled={busyAction !== null}
                  className="w-full rounded-xl border border-rose-200 bg-white px-3 py-2 text-sm text-[var(--ink)] outline-none"
                />
              </label>
              <button
                className={buttonClass("danger")}
                disabled={busyAction !== null || !selectedImageSlug || confirmText.trim() !== serverName}
                onClick={() => void runAction("Rebuild", `/api/vps/servers/${serverId}/rebuild`, {
                  confirmText: confirmText.trim(),
                  imageSlug: selectedImageSlug,
                  ...(rebuildReason.trim() ? { reason: rebuildReason.trim() } : {}),
                })}
              >
                {busyAction === "Rebuild" ? "Rebuilding..." : `Rebuild to ${selectedImage?.name || "Selected Image"}`}
              </button>
              <p className="text-xs text-[var(--ink-muted)]">The rebuild request is audited with the selected image and reason so the support trail matches the actual client request.</p>
            </div>
          </div>
        </div>
      ) : null}
      {message ? (
        <p className="text-sm text-[var(--ink-muted)]">{message}</p>
      ) : null}
    </div>
  );
}
