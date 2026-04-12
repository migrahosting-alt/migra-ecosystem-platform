"use client";

import { startTransition, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ActionButton } from "@/components/ui/button";
import { authFetch } from "@/lib/auth/client-token";
import type { DriveOperationPolicy } from "@/lib/drive/drive-operation-policy";
import type { DriveRecentEvent } from "@/lib/drive/drive-recent-events";
import type { DriveTenantSummary } from "@/lib/drive/drive-tenant-summary";
import type { DriveTenantCapabilities } from "@/lib/drive/drive-tenant-types";

const GIB_IN_BYTES = 1024 * 1024 * 1024;

interface DriveWorkspaceFile {
  id: string;
  fileName: string;
  parentPath: string | null;
  mimeType: string;
  sizeBytes: string;
  status: "PENDING_UPLOAD" | "ACTIVE";
  createdAt: string;
  updatedAt: string;
  uploadedAt: string | null;
}

interface DriveWorkspaceBootstrap {
  tenant: {
    status: string;
    planCode: string;
    storageQuotaGb: number;
    storageUsedBytes: string;
    restrictionReason: string | null;
    disableReason: string | null;
  };
  capabilities: DriveTenantCapabilities;
  operationPolicy: DriveOperationPolicy;
  tenantSummary: DriveTenantSummary | null;
  recentEvents: DriveRecentEvent[];
}

interface DriveWorkspaceBlockState {
  title: string;
  description: string;
}

interface DriveWorkspaceProps {
  orgName: string;
  testOverrides?: {
    state?: string | null;
    empty?: boolean;
  };
}

function formatBytes(value: string | number): string {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB", "TB"];
  let unitIndex = 0;
  let amount = bytes;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "Not yet recorded";
}

function getStatusClass(status: string): string {
  if (status === "ACTIVE") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  if (status === "RESTRICTED") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  if (status === "PENDING_UPLOAD") {
    return "border-sky-200 bg-sky-50 text-sky-700";
  }

  return "border-slate-200 bg-slate-100 text-slate-700";
}

function readError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return fallback;
}

function getLifecycleReasonMessage(reason: string | null) {
  if (reason === "billing_past_due") {
    return "Billing is past due. MigraDrive stays available in read-only mode until billing is restored.";
  }

  if (reason === "quota_exceeded_after_downgrade") {
    return "Usage exceeds the current plan quota after a downgrade. Remove data or restore quota to re-enable write actions.";
  }

  if (reason === "billing_canceled") {
    return "The MigraDrive subscription was canceled. Access remains blocked until service is restored.";
  }

  return reason ? `Lifecycle policy: ${reason}.` : null;
}

function getWorkspaceBlockState(errorCode: string, tenantLifecycleReason?: string | null): DriveWorkspaceBlockState | null {
  if (errorCode === "tenant_pending") {
    return {
      title: "Provisioning in progress",
      description: "MigraDrive is still being provisioned for this organization. Retry after the tenant activation flow completes.",
    };
  }

  if (errorCode === "tenant_disabled") {
    return {
      title: "Access disabled",
      description:
        getLifecycleReasonMessage(tenantLifecycleReason || null)
        || "MigraDrive access is currently disabled for this organization.",
    };
  }

  return null;
}

function getMockWorkspaceBlockState(mockState: string | null | undefined): DriveWorkspaceBlockState | null {
  if (mockState === "PENDING") {
    return {
      title: "Setup in progress",
      description: "MigraDrive provisioning is still in progress for this organization.",
    };
  }

  if (mockState === "DISABLED") {
    return {
      title: "Account disabled",
      description: "MigraDrive access is currently disabled for this organization.",
    };
  }

  return null;
}

function getWorkspaceErrorMessage(errorCode: string, fallback: string, tenantLifecycleReason?: string | null) {
  if (errorCode === "tenant_access_denied") {
    return "This action is currently blocked by the tenant capability policy.";
  }

  if (errorCode === "file_not_found") {
    return "The file is no longer available. Refresh the workspace and try again.";
  }

  if (errorCode === "mock_storage_disabled" || errorCode === "mock_storage_production_disabled") {
    return "Mock storage is not available in this environment.";
  }

  return getWorkspaceBlockState(errorCode, tenantLifecycleReason)?.description || fallback;
}

function getStorageUsage(input: DriveWorkspaceBootstrap | null) {
  if (!input) {
    return {
      usedBytes: 0,
      quotaBytes: 0,
      usagePercent: 0,
      isNearLimit: false,
      isOverQuota: false,
    };
  }

  const usedBytes = Number(input.tenantSummary?.storageUsedBytes || input.tenant.storageUsedBytes || 0);
  const quotaBytes = (input.tenantSummary?.storageQuotaGb || input.tenant.storageQuotaGb || 0) * GIB_IN_BYTES;
  const usagePercent = quotaBytes > 0 ? (usedBytes / quotaBytes) * 100 : 0;

  return {
    usedBytes,
    quotaBytes,
    usagePercent,
    isNearLimit: usagePercent >= 85,
    isOverQuota: usagePercent >= 100,
  };
}

function getTestAdjustedBootstrap(
  bootstrap: DriveWorkspaceBootstrap | null,
  overrides: DriveWorkspaceProps["testOverrides"],
) {
  if (!bootstrap || !overrides?.state || overrides.state !== "RESTRICTED") {
    return bootstrap;
  }

  return {
    ...bootstrap,
    tenant: {
      ...bootstrap.tenant,
      status: "RESTRICTED",
      restrictionReason: bootstrap.tenant.restrictionReason || "quota_exceeded_after_downgrade",
    },
    capabilities: {
      ...bootstrap.capabilities,
      canUpload: false,
      canDelete: false,
      canShare: false,
      readOnlyMode: true,
    },
  };
}

export function MigraDriveWorkspace({ orgName, testOverrides }: DriveWorkspaceProps) {
  const [bootstrap, setBootstrap] = useState<DriveWorkspaceBootstrap | null>(null);
  const [files, setFiles] = useState<DriveWorkspaceFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyFileId, setBusyFileId] = useState<string | null>(null);
  const [blockState, setBlockState] = useState<DriveWorkspaceBlockState | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const searchParams = useSearchParams();
  const requestedMockState = searchParams.get("mockState");
  const requestedMockEmpty = searchParams.get("mockEmpty") === "true";
  const effectiveTestOverrides = {
    state: testOverrides?.state ?? requestedMockState,
    empty: Boolean(testOverrides?.empty || requestedMockEmpty),
  };

  async function loadWorkspace(mode: "initial" | "refresh" = "initial") {
    if (mode === "initial") {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    setError(null);

    try {
      const [bootstrapResponse, filesResponse] = await Promise.all([
        authFetch("/api/v1/drive/bootstrap", { cache: "no-store" }),
        authFetch("/api/v1/drive/files", { cache: "no-store" }),
      ]);

      const bootstrapPayload = (await bootstrapResponse.json().catch(() => null)) as
        | { data?: DriveWorkspaceBootstrap; error?: string; tenantLifecycleReason?: string | null }
        | null;
      const filesPayload = (await filesResponse.json().catch(() => null)) as
        | { data?: DriveWorkspaceFile[]; error?: string; tenantLifecycleReason?: string | null }
        | null;

      const bootstrapErrorCode = bootstrapPayload?.error || "";
      const bootstrapBlockState = getWorkspaceBlockState(
        bootstrapErrorCode,
        bootstrapPayload?.tenantLifecycleReason,
      );
      if (!bootstrapResponse.ok && bootstrapBlockState) {
        startTransition(() => {
          setBootstrap(null);
          setFiles([]);
          setBlockState(bootstrapBlockState);
        });
        return;
      }

      if (!bootstrapResponse.ok) {
        throw new Error(
          getWorkspaceErrorMessage(
            bootstrapErrorCode,
            "Unable to load MigraDrive bootstrap.",
            bootstrapPayload?.tenantLifecycleReason,
          ),
        );
      }

      if (!filesResponse.ok) {
        throw new Error(
          getWorkspaceErrorMessage(
            filesPayload?.error || "",
            "Unable to load MigraDrive files.",
            filesPayload?.tenantLifecycleReason,
          ),
        );
      }

      startTransition(() => {
        setBootstrap(getTestAdjustedBootstrap(bootstrapPayload?.data || null, effectiveTestOverrides));
        setFiles(effectiveTestOverrides.empty ? [] : filesPayload?.data || []);
        setBlockState(null);
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load MigraDrive workspace.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadWorkspace();
  }, [effectiveTestOverrides.empty, effectiveTestOverrides.state]);

  async function handleUploadSelection(fileList: FileList | null) {
    const file = fileList?.item(0);
    if (!file) {
      return;
    }

    setBusyFileId("upload");
    setError(null);
    setNotice(null);

    try {
      const initResponse = await authFetch("/api/v1/drive/files", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          parentPath: null,
        }),
      });
      const initPayload = (await initResponse.json().catch(() => null)) as
        | { data?: { file?: { id: string }; uploadUrl?: string }; error?: string }
        | null;

      if (!initResponse.ok || !initPayload?.data?.file?.id || !initPayload?.data?.uploadUrl) {
        throw new Error(getWorkspaceErrorMessage(initPayload?.error || "", "Unable to initiate an upload."));
      }

      const uploadResponse = await fetch(initPayload.data.uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Upload transfer failed before finalization.");
      }

      const finalizeResponse = await authFetch(`/api/v1/drive/files/${initPayload.data.file.id}/finalize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const finalizePayload = (await finalizeResponse.json().catch(() => null)) as { error?: string } | null;

      if (!finalizeResponse.ok) {
        throw new Error(getWorkspaceErrorMessage(finalizePayload?.error || "", "Unable to finalize the upload."));
      }

      setNotice(`Uploaded ${file.name}.`);
      await loadWorkspace("refresh");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to upload file.");
    } finally {
      setBusyFileId(null);
      if (uploadInputRef.current) {
        uploadInputRef.current.value = "";
      }
    }
  }

  async function handleDownload(fileId: string) {
    setBusyFileId(fileId);
    setError(null);

    try {
      const response = await authFetch(`/api/v1/drive/files/${fileId}/download`, { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { signedUrl?: string }; error?: string }
        | null;

      if (!response.ok || !payload?.data?.signedUrl) {
        throw new Error(getWorkspaceErrorMessage(payload?.error || "", "Unable to issue a download URL."));
      }

      window.open(payload.data.signedUrl, "_blank", "noopener,noreferrer");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to issue a download URL.");
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleShare(fileId: string) {
    setBusyFileId(fileId);
    setError(null);
    setNotice(null);

    try {
      const response = await authFetch(`/api/v1/drive/files/${fileId}/share`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: { shareUrl?: string }; error?: string }
        | null;

      if (!response.ok || !payload?.data?.shareUrl) {
        throw new Error(getWorkspaceErrorMessage(payload?.error || "", "Unable to issue a share link."));
      }

      await navigator.clipboard.writeText(payload.data.shareUrl).catch(() => undefined);
      setNotice("Share link issued and copied to the clipboard.");
      await loadWorkspace("refresh");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to issue a share link.");
    } finally {
      setBusyFileId(null);
    }
  }

  async function handleRemove(file: DriveWorkspaceFile) {
    const confirmed = window.confirm(
      file.status === "PENDING_UPLOAD"
        ? `Cancel pending upload for ${file.fileName}?`
        : `Delete ${file.fileName}?`,
    );

    if (!confirmed) {
      return;
    }

    setBusyFileId(file.id);
    setError(null);
    setNotice(null);

    try {
      const response = await authFetch(`/api/v1/drive/files/${file.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        throw new Error(getWorkspaceErrorMessage(payload?.error || "", "Unable to update file state."));
      }

      setNotice(file.status === "PENDING_UPLOAD" ? "Pending upload canceled." : "File deleted.");
      await loadWorkspace("refresh");
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update file state.");
    } finally {
      setBusyFileId(null);
    }
  }

  const activeBootstrap = getTestAdjustedBootstrap(bootstrap, effectiveTestOverrides);
  const summary = activeBootstrap?.tenantSummary;
  const showInitialSkeleton = loading && !bootstrap;
  const storageUsage = getStorageUsage(activeBootstrap);
  const usagePercentLabel = `${Math.max(0, Math.min(storageUsage.usagePercent, 999)).toFixed(storageUsage.usagePercent >= 10 ? 0 : 1)}%`;
  const restrictionMessage = activeBootstrap ? getLifecycleReasonMessage(activeBootstrap.tenant.restrictionReason) : null;
  const activeBlockState = getMockWorkspaceBlockState(effectiveTestOverrides.state) || blockState;

  return (
    <section className="space-y-6">
      <article className="rounded-2xl border border-[var(--line)] bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Dedicated workspace</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">MigraDrive</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--ink-muted)]">
              Live tenant bootstrap, operational policy, recent activity, and file inventory for {orgName}.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {activeBootstrap ? (
              <span data-testid="tenant-status" className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusClass(activeBootstrap.tenant.status)}`}>
                {activeBootstrap.tenant.status}
              </span>
            ) : null}
            <input
              ref={uploadInputRef}
              data-testid="upload-input"
              type="file"
              className="hidden"
              onChange={(event) => void handleUploadSelection(event.target.files)}
            />
            <ActionButton
              data-testid="upload-btn"
              variant="secondary"
              disabled={
                refreshing
                || loading
                || busyFileId === "upload"
                || !activeBootstrap
                || !activeBootstrap.capabilities.canUpload
              }
              onClick={() => uploadInputRef.current?.click()}
            >
              {busyFileId === "upload" ? "Uploading..." : "Upload"}
            </ActionButton>
            <ActionButton variant="secondary" disabled={refreshing || loading} onClick={() => void loadWorkspace("refresh")}>
              {refreshing ? "Refreshing..." : "Refresh"}
            </ActionButton>
          </div>
        </div>

        {activeBootstrap?.capabilities.readOnlyMode ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Read-only mode is active. Downloads remain available, while write actions follow the capability policy for this tenant state.
          </div>
        ) : null}
        {activeBootstrap?.tenant.status === "RESTRICTED" && restrictionMessage ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            {restrictionMessage}
          </div>
        ) : null}
        {storageUsage.isOverQuota ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
            Storage usage is above quota. Write actions should remain restricted until usage is reduced or quota is restored.
          </div>
        ) : storageUsage.isNearLimit ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Storage usage is approaching quota. Monitor active and pending uploads closely.
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">{error}</div>
        ) : null}
      </article>

      {showInitialSkeleton ? (
        <article className="rounded-2xl border border-[var(--line)] bg-white p-6 text-sm text-[var(--ink-muted)]">
          Loading MigraDrive workspace...
        </article>
      ) : null}

      {activeBlockState ? (
        <article data-testid={`drive-blocked-${(effectiveTestOverrides.state || requestedMockState || "state").toLowerCase()}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-6">
          <h2 className="text-xl font-bold text-amber-950">{activeBlockState.title}</h2>
          <p className="mt-2 text-sm text-amber-900">{activeBlockState.description}</p>
          <div className="mt-4">
            <ActionButton variant="secondary" onClick={() => void loadWorkspace("refresh")}>
              Retry workspace load
            </ActionButton>
          </div>
        </article>
      ) : null}

      {activeBootstrap && !activeBlockState ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Storage used</p>
              <p className="mt-2 text-2xl font-black tracking-tight">{formatBytes(summary?.storageUsedBytes || activeBootstrap.tenant.storageUsedBytes)}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">of {summary?.storageQuotaGb || activeBootstrap.tenant.storageQuotaGb} GiB quota</p>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div
                  className={`h-full rounded-full ${storageUsage.isOverQuota ? "bg-rose-500" : storageUsage.isNearLimit ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.max(4, Math.min(storageUsage.usagePercent, 100))}%` }}
                />
              </div>
              <p className="mt-2 text-xs font-medium text-[var(--ink-muted)]">{usagePercentLabel} of quota consumed</p>
            </article>
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">File inventory</p>
              <p className="mt-2 text-2xl font-black tracking-tight">{summary?.activeFileCount || 0}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">active files</p>
            </article>
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Pending state</p>
              <p className="mt-2 text-2xl font-black tracking-tight">{summary?.pendingUploadCount || 0}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                live pending uploads · {summary?.stalePendingUploadCount || 0} stale pending
              </p>
            </article>
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">Maintenance</p>
              <p className="mt-2 text-base font-bold text-[var(--ink)]">{formatTimestamp(summary?.lastCleanupAt || null)}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">last stale-upload cleanup</p>
            </article>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.3fr_0.9fr]">
            <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
              <h2 className="text-xl font-bold">Files</h2>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                Active and pending objects surfaced directly from the file routes.
              </p>

              <div className="mt-4 space-y-3">
                {files.length === 0 ? (
                  <div data-testid="drive-empty-state" className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                    No active or pending files are available for this tenant yet.
                  </div>
                ) : (
                  files.map((file) => {
                    const isBusy = busyFileId === file.id;
                    const canDeleteActive = file.status === "ACTIVE" && Boolean(activeBootstrap.capabilities.canDelete);
                    const canCancelPending =
                      file.status === "PENDING_UPLOAD" && activeBootstrap.operationPolicy.supportsPendingUploadCancel;

                    return (
                      <div key={file.id} data-testid="file-row" className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-base font-bold text-[var(--ink)]">{file.fileName}</h3>
                              <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${getStatusClass(file.status)}`}>
                                {file.status}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-[var(--ink-muted)]">
                              {file.parentPath || "Root"} · {formatBytes(file.sizeBytes)} · {file.mimeType}
                            </p>
                            <p className="mt-1 text-xs text-[var(--ink-muted)]">
                              Updated {formatTimestamp(file.updatedAt)}
                              {file.uploadedAt ? ` · Uploaded ${formatTimestamp(file.uploadedAt)}` : ""}
                            </p>
                            {activeBootstrap.capabilities.readOnlyMode && file.status === "ACTIVE" ? (
                              <p className="mt-2 text-xs font-medium text-amber-800">
                                Write actions are restricted for this tenant state.
                              </p>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {file.status === "ACTIVE" && activeBootstrap.capabilities.canDownload ? (
                              <ActionButton data-testid="download-btn" variant="secondary" disabled={isBusy} onClick={() => void handleDownload(file.id)}>
                                Download
                              </ActionButton>
                            ) : null}
                            {file.status === "ACTIVE" && activeBootstrap.capabilities.canShare ? (
                              <ActionButton data-testid="share-btn" variant="secondary" disabled={isBusy} onClick={() => void handleShare(file.id)}>
                                Share
                              </ActionButton>
                            ) : null}
                            {canDeleteActive || canCancelPending ? (
                              <ActionButton data-testid={canCancelPending ? "cancel-btn" : "delete-btn"} disabled={isBusy} onClick={() => void handleRemove(file)}>
                                {isBusy ? "Working..." : canCancelPending ? "Cancel Pending" : "Delete"}
                              </ActionButton>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </article>

            <div className="space-y-4">
              <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
                <h2 className="text-xl font-bold">Policy</h2>
                <div className="mt-4 space-y-3 text-sm text-[var(--ink-muted)]">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide">Plan</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{activeBootstrap.tenant.planCode}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide">Single upload limit</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">{formatBytes(activeBootstrap.operationPolicy.maxSingleUploadBytes)}</p>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide">Cleanup mode</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                      {activeBootstrap.operationPolicy.cleanupMode} · {activeBootstrap.operationPolicy.pendingUploadStaleAfterHours}h stale threshold
                    </p>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide">Capabilities</p>
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                      Download {activeBootstrap.capabilities.canDownload ? "on" : "off"} · Share {activeBootstrap.capabilities.canShare ? "on" : "off"} · Delete {activeBootstrap.capabilities.canDelete ? "on" : "off"} · Upload {activeBootstrap.capabilities.canUpload ? "on" : "off"}
                    </p>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
                <h2 className="text-xl font-bold">Recent activity</h2>
                <div className="mt-4 space-y-3">
                  {activeBootstrap.recentEvents.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] px-4 py-6 text-sm text-[var(--ink-muted)]">
                      No recent drive activity has been recorded yet.
                    </div>
                  ) : (
                    activeBootstrap.recentEvents.map((event) => (
                      <div key={`${event.action}-${event.occurredAt}-${event.resourceId || "none"}`} className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3">
                        <p className="text-sm font-semibold text-[var(--ink)]">{event.summary}</p>
                        <p className="mt-1 text-xs text-[var(--ink-muted)]">{formatTimestamp(event.occurredAt)}</p>
                      </div>
                    ))
                  )}
                </div>
              </article>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}