"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/button";

interface PlatformConfigFormProps {
  initialConfig: {
    allowPublicSignup: boolean;
    allowOrgCreate: boolean;
    waitlistMode: boolean;
    maintenanceMode: boolean;
    freezeProvisioning: boolean;
    pauseProvisioningWorker: boolean;
    pauseEntitlementExpiryWorker: boolean;
    updatedAt: string;
  };
}

export function PlatformConfigForm({ initialConfig }: PlatformConfigFormProps) {
  const [allowPublicSignup, setAllowPublicSignup] = useState(initialConfig.allowPublicSignup);
  const [allowOrgCreate, setAllowOrgCreate] = useState(initialConfig.allowOrgCreate);
  const [waitlistMode, setWaitlistMode] = useState(initialConfig.waitlistMode);
  const [maintenanceMode, setMaintenanceMode] = useState(initialConfig.maintenanceMode);
  const [freezeProvisioning, setFreezeProvisioning] = useState(initialConfig.freezeProvisioning);
  const [pauseProvisioningWorker, setPauseProvisioningWorker] = useState(initialConfig.pauseProvisioningWorker);
  const [pauseEntitlementExpiryWorker, setPauseEntitlementExpiryWorker] = useState(initialConfig.pauseEntitlementExpiryWorker);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [updatedAt, setUpdatedAt] = useState(initialConfig.updatedAt);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function saveConfig() {
    setSaving(true);
    setError(null);
    setMessage(null);

    const patchPayload = {
      allowPublicSignup,
      allowOrgCreate,
      waitlistMode,
      maintenanceMode,
      freezeProvisioning,
      pauseProvisioningWorker,
      pauseEntitlementExpiryWorker,
    };

    const intentResponse = await fetch("/api/security/intents", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "platform:config:update",
        payload: patchPayload,
        reason: reason || undefined,
        stepUp: {
          ...(password ? { password } : {}),
          ...(totpCode ? { totpCode } : {}),
        },
      }),
    });

    const intentPayload = (await intentResponse.json().catch(() => null)) as
      | { error?: string; intentId?: string }
      | null;

    if (!intentResponse.ok || !intentPayload?.intentId) {
      setSaving(false);
      setError("Tier-2 confirmation failed.");
      return;
    }

    const response = await fetch("/api/platform/config", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...patchPayload,
        intentId: intentPayload.intentId,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; config?: { updatedAt: string } }
      | null;

    setSaving(false);

    if (!response.ok) {
      setError(payload?.error || "Unable to save platform config.");
      return;
    }

    setUpdatedAt(payload?.config?.updatedAt || new Date().toISOString());
    setMessage("Platform settings saved.");
  }

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-5">
      <h2 className="text-lg font-bold">Platform switches</h2>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Control signup, org creation, waitlist behavior, and emergency lockdown switches.
      </p>
      <div className="mt-4 space-y-3">
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--ink)]">Allow public signup</span>
          <input
            type="checkbox"
            checked={allowPublicSignup}
            onChange={(event) => setAllowPublicSignup(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--ink)]">Allow organization creation</span>
          <input type="checkbox" checked={allowOrgCreate} onChange={(event) => setAllowOrgCreate(event.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--ink)]">Waitlist mode</span>
          <input type="checkbox" checked={waitlistMode} onChange={(event) => setWaitlistMode(event.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--ink)]">Maintenance mode</span>
          <input
            type="checkbox"
            checked={maintenanceMode}
            onChange={(event) => setMaintenanceMode(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--ink)]">Freeze provisioning</span>
          <input
            type="checkbox"
            checked={freezeProvisioning}
            onChange={(event) => setFreezeProvisioning(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--ink)]">Pause provisioning worker</span>
          <input
            type="checkbox"
            checked={pauseProvisioningWorker}
            onChange={(event) => setPauseProvisioningWorker(event.target.checked)}
          />
        </label>
        <label className="flex items-center justify-between gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm">
          <span className="font-semibold text-[var(--ink)]">Pause entitlement expiry worker</span>
          <input
            type="checkbox"
            checked={pauseEntitlementExpiryWorker}
            onChange={(event) => setPauseEntitlementExpiryWorker(event.target.checked)}
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Change reason (Tier-2)</span>
          <input value={reason} onChange={(event) => setReason(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">Password (step-up)</span>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[var(--ink-muted)]">TOTP code (step-up)</span>
          <input value={totpCode} onChange={(event) => setTotpCode(event.target.value)} className="w-full rounded-xl border border-[var(--line)] px-3 py-2" />
        </label>
      </div>
      <p className="mt-4 text-xs text-[var(--ink-muted)]">Last updated: {new Date(updatedAt).toISOString()}</p>
      <div className="mt-4 flex items-center gap-3">
        <ActionButton onClick={saveConfig} disabled={saving}>
          {saving ? "Saving..." : "Save settings"}
        </ActionButton>
        {message ? <span className="text-sm text-green-700">{message}</span> : null}
        {error ? <span className="text-sm text-red-600">{error}</span> : null}
      </div>
    </article>
  );
}
