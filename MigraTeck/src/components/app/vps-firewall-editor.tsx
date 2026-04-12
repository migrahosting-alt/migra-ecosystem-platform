"use client";

import { useState, useTransition } from "react";
import { ActionButton } from "@/components/ui/button";
import { VpsSectionCard, VpsStatusBadge } from "@/components/app/vps-ui";
import type { FirewallApplyPreview, FirewallTemplate, FirewallValidationResult, CanonicalFirewallRule, CanonicalFirewallState } from "@/lib/vps/firewall/types";

type FirewallView = {
  enabled: boolean;
  providerSlug: string;
  capabilities: {
    console: boolean;
    rescue: boolean;
    firewallRead: boolean;
    firewallWrite: boolean;
    snapshots: boolean;
    backups: boolean;
    metrics: boolean;
  };
  profileId?: string | undefined;
  profileName: string;
  status: string;
  isActive: boolean;
  lastAppliedAt?: string | null | undefined;
  lastApplyJobId?: string | null | undefined;
  lastError?: string | null | undefined;
  rollbackWindowSec: number;
  rollbackPendingUntil?: string | null | undefined;
  confirmedAt?: string | null | undefined;
  driftDetectedAt?: string | null | undefined;
  defaults: {
    inbound: "ALLOW" | "DENY";
    outbound: "ALLOW" | "DENY";
  };
  antiLockoutEnabled: boolean;
  antiLockoutSatisfied: boolean;
  validation: FirewallValidationResult;
  ruleCount: number;
  rules: CanonicalFirewallRule[];
  inboundRules: CanonicalFirewallRule[];
  outboundRules: CanonicalFirewallRule[];
  templates: FirewallTemplate[];
};

type PreviewResponse = {
  diff: FirewallApplyPreview;
  validation: FirewallValidationResult;
};

function buildDraft(view: FirewallView): CanonicalFirewallState {
  return {
    profileId: view.profileId,
    profileName: view.profileName,
    status: view.status as CanonicalFirewallState["status"],
    isEnabled: view.enabled,
    isActive: view.isActive,
    inboundDefaultAction: view.defaults.inbound,
    outboundDefaultAction: view.defaults.outbound,
    antiLockoutEnabled: view.antiLockoutEnabled,
    rollbackWindowSec: view.rollbackWindowSec,
    lastAppliedAt: view.lastAppliedAt,
    lastApplyJobId: view.lastApplyJobId,
    lastError: view.lastError,
    rollbackPendingUntil: view.rollbackPendingUntil,
    confirmedAt: view.confirmedAt,
    driftDetectedAt: view.driftDetectedAt,
    rules: view.rules,
  };
}

function formatDateTime(value?: string | null) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function rulePorts(rule: CanonicalFirewallRule) {
  if (!rule.portStart && !rule.portEnd) return "Any";
  if (rule.portStart && rule.portEnd && rule.portStart !== rule.portEnd) {
    return `${rule.portStart}-${rule.portEnd}`;
  }
  return String(rule.portStart || rule.portEnd);
}

function riskBadge(riskLevel: "LOW" | "MEDIUM" | "HIGH") {
  const tone = riskLevel === "HIGH"
    ? "border-rose-200 bg-rose-50 text-rose-700"
    : riskLevel === "MEDIUM"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em] ${tone}`}>{riskLevel}</span>;
}

export function VpsFirewallEditor({ serverId, initialFirewall }: { serverId: string; initialFirewall: FirewallView }) {
  const [firewall, setFirewall] = useState(initialFirewall);
  const [draft, setDraft] = useState<CanonicalFirewallState>(() => buildDraft(initialFirewall));
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [acknowledgedHighRisk, setAcknowledgedHighRisk] = useState(false);
  const [isPending, startTransition] = useTransition();

  const activeValidation = preview?.validation || firewall.validation;
  const highRisk = preview?.diff.riskLevel === "HIGH";

  async function requestJson(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(init.headers || {}),
      },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(typeof payload.error === "string" ? payload.error : "Request failed.");
    }

    return payload;
  }

  async function reloadFirewall() {
    const payload = await requestJson(`/api/vps/servers/${serverId}/firewall`);
    setFirewall(payload);
    setDraft(buildDraft(payload));
    return payload as FirewallView;
  }

  function updateRule(index: number, patch: Partial<CanonicalFirewallRule>) {
    setDraft((current) => ({
      ...current,
      rules: current.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule),
    }));
  }

  function addRule(direction: CanonicalFirewallRule["direction"]) {
    setDraft((current) => ({
      ...current,
      rules: [
        ...current.rules,
        {
          direction,
          action: "ALLOW",
          protocol: "TCP",
          priority: current.rules.length ? Math.max(...current.rules.map((rule) => rule.priority)) + 100 : 100,
          isEnabled: true,
        },
      ],
    }));
  }

  function removeRule(index: number) {
    setDraft((current) => ({
      ...current,
      rules: current.rules.filter((_, ruleIndex) => ruleIndex !== index),
    }));
  }

  function applyTemplate(template: FirewallTemplate) {
    setDraft({
      ...template.state,
      isEnabled: true,
    });
    setMessage(`Loaded template: ${template.name}`);
    setError(null);
    setPreview(null);
  }

  function duplicateProfile() {
    setDraft((current) => ({
      ...current,
      profileName: `${current.profileName || "Firewall profile"} Copy`,
      status: "DRAFT",
      isActive: false,
    }));
    setMessage("Profile duplicated into a new draft.");
  }

  function saveDraft() {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        const payload = await requestJson(`/api/vps/servers/${serverId}/firewall`, {
          method: "PUT",
          body: JSON.stringify(draft),
        });
        setDraft(payload.state);
        setMessage("Draft saved.");
        setPreview(null);
        await reloadFirewall();
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to save draft.");
      }
    });
  }

  function previewChanges() {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        const payload = await requestJson(`/api/vps/servers/${serverId}/firewall/preview`, {
          method: "POST",
          body: JSON.stringify(draft),
        });
        setPreview(payload);
        setMessage("Preview generated.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to preview firewall changes.");
      }
    });
  }

  function applyChanges() {
    startTransition(async () => {
      try {
        if (highRisk && (!acknowledgedHighRisk || typedConfirmation !== "APPLY")) {
          setError("High-risk firewall changes require the confirmation checkbox and typing APPLY.");
          return;
        }

        setError(null);
        setMessage(null);
        await requestJson(`/api/vps/servers/${serverId}/firewall/apply`, {
          method: "POST",
          body: JSON.stringify(draft),
        });
        const next = await reloadFirewall();
        setPreview(null);
        setTypedConfirmation("");
        setAcknowledgedHighRisk(false);
        setMessage(next.rollbackPendingUntil ? "Firewall applied. Confirmation window is active." : "Firewall applied successfully.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to apply firewall profile.");
      }
    });
  }

  function rollbackChanges() {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        await requestJson(`/api/vps/servers/${serverId}/firewall/rollback`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        await reloadFirewall();
        setPreview(null);
        setMessage("Firewall rollback requested.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to roll back firewall profile.");
      }
    });
  }

  function confirmConnectivity() {
    startTransition(async () => {
      try {
        setError(null);
        setMessage(null);
        await requestJson(`/api/vps/servers/${serverId}/firewall/confirm`, {
          method: "POST",
          body: JSON.stringify({}),
        });
        await reloadFirewall();
        setMessage("Rollback window cleared and firewall connectivity confirmed.");
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Failed to confirm connectivity.");
      }
    });
  }

  const inboundRules = draft.rules.filter((rule) => rule.direction === "INBOUND");
  const outboundRules = draft.rules.filter((rule) => rule.direction === "OUTBOUND");

  return (
    <div className="space-y-6">
      <VpsSectionCard title="Firewall posture" description="Draft, validation, provider capability, and rollback state for this VPS.">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Firewall Enabled</p>
              <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{draft.isEnabled === false ? "Disabled" : "Enabled"}</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Inbound Default</p>
              <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{draft.inboundDefaultAction}</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Outbound Default</p>
              <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{draft.outboundDefaultAction}</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Active Rules</p>
              <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{draft.rules.filter((rule) => rule.isEnabled).length}</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--ink-muted)]">Anti-Lockout</p>
              <p className="mt-2 text-lg font-semibold text-[var(--ink)]">{draft.antiLockoutEnabled ? (activeValidation.antiLockoutSatisfied ? "Satisfied" : "At risk") : "Disabled"}</p>
            </div>
          </div>
          <div className="flex flex-col items-start gap-2">
            <VpsStatusBadge status={firewall.status} />
            <p className="text-sm text-[var(--ink-muted)]">Provider: {firewall.providerSlug}</p>
            <p className="text-sm text-[var(--ink-muted)]">Last applied: {formatDateTime(firewall.lastAppliedAt)}</p>
          </div>
        </div>
      </VpsSectionCard>

      {!firewall.capabilities.firewallWrite ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Provider firewall writes are unavailable for this server. The profile can be edited locally, but apply is read-only until the adapter supports mutations.
        </div>
      ) : null}
      {!firewall.enabled ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Firewall protection is currently disabled for this VPS.
        </div>
      ) : null}
      {firewall.lastError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Last apply failed: {firewall.lastError}
        </div>
      ) : null}
      {firewall.rollbackPendingUntil ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Rollback pending until {formatDateTime(firewall.rollbackPendingUntil)}. Confirm connectivity if the server remains reachable.
        </div>
      ) : null}
      {firewall.driftDetectedAt ? (
        <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          Provider drift was detected at {formatDateTime(firewall.driftDetectedAt)}. Review the current draft before the next apply.
        </div>
      ) : null}
      {message ? <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div> : null}
      {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2.2fr)_minmax(320px,1fr)]">
        <div className="space-y-6">
          <VpsSectionCard title="Profile editor" description="Stage changes locally, preview the diff, and apply only after validation is clean.">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--ink)]">Profile name</span>
                <input
                  className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  value={draft.profileName || ""}
                  onChange={(event) => setDraft((current) => ({ ...current, profileName: event.target.value }))}
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--ink)]">Rollback window (seconds)</span>
                <input
                  className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  type="number"
                  min={30}
                  max={600}
                  value={draft.rollbackWindowSec}
                  onChange={(event) => setDraft((current) => ({ ...current, rollbackWindowSec: Number(event.target.value || 120) }))}
                />
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--ink)]">Inbound default</span>
                <select
                  className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  value={draft.inboundDefaultAction}
                  onChange={(event) => setDraft((current) => ({ ...current, inboundDefaultAction: event.target.value as "ALLOW" | "DENY" }))}
                >
                  <option value="DENY">DENY</option>
                  <option value="ALLOW">ALLOW</option>
                </select>
              </label>
              <label className="space-y-2 text-sm">
                <span className="font-semibold text-[var(--ink)]">Outbound default</span>
                <select
                  className="w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                  value={draft.outboundDefaultAction}
                  onChange={(event) => setDraft((current) => ({ ...current, outboundDefaultAction: event.target.value as "ALLOW" | "DENY" }))}
                >
                  <option value="ALLOW">ALLOW</option>
                  <option value="DENY">DENY</option>
                </select>
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <label className="inline-flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={draft.isEnabled !== false}
                  onChange={(event) => setDraft((current) => ({ ...current, isEnabled: event.target.checked }))}
                />
                Firewall enabled
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-[var(--ink)]">
                <input
                  type="checkbox"
                  checked={draft.antiLockoutEnabled}
                  onChange={(event) => setDraft((current) => ({ ...current, antiLockoutEnabled: event.target.checked }))}
                />
                Anti-lockout enabled
              </label>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <ActionButton variant="secondary" onClick={() => addRule("INBOUND")} disabled={isPending}>Add Inbound Rule</ActionButton>
              <ActionButton variant="secondary" onClick={() => addRule("OUTBOUND")} disabled={isPending}>Add Outbound Rule</ActionButton>
              <ActionButton variant="secondary" onClick={duplicateProfile} disabled={isPending}>Duplicate Profile</ActionButton>
              <ActionButton variant="secondary" onClick={saveDraft} disabled={isPending}>Save Draft</ActionButton>
              <ActionButton variant="secondary" onClick={previewChanges} disabled={isPending}>Preview Changes</ActionButton>
              <ActionButton onClick={applyChanges} disabled={isPending || !firewall.capabilities.firewallWrite}>Apply Changes</ActionButton>
              <ActionButton variant="secondary" onClick={rollbackChanges} disabled={isPending || !firewall.capabilities.firewallWrite}>Rollback</ActionButton>
              {firewall.rollbackPendingUntil ? (
                <ActionButton variant="secondary" onClick={confirmConnectivity} disabled={isPending}>Confirm Connectivity</ActionButton>
              ) : null}
            </div>
          </VpsSectionCard>

          <VpsSectionCard title="Inbound rules" description="Traffic entering the server.">
            <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[var(--surface-2)] text-left text-[var(--ink-muted)]">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Priority</th>
                    <th className="px-3 py-3 font-semibold">Action</th>
                    <th className="px-3 py-3 font-semibold">Protocol</th>
                    <th className="px-3 py-3 font-semibold">Ports</th>
                    <th className="px-3 py-3 font-semibold">Source</th>
                    <th className="px-3 py-3 font-semibold">Description</th>
                    <th className="px-3 py-3 font-semibold">Enabled</th>
                    <th className="px-3 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inboundRules.map((rule) => {
                    const index = draft.rules.indexOf(rule);
                    return (
                      <tr key={rule.id || `inbound-${index}`} className="border-t border-[var(--line)] align-top">
                        <td className="px-3 py-3"><input className="w-20 rounded-lg border border-[var(--line)] px-2 py-1" type="number" value={rule.priority} onChange={(event) => updateRule(index, { priority: Number(event.target.value || 100) })} /></td>
                        <td className="px-3 py-3"><select className="rounded-lg border border-[var(--line)] px-2 py-1" value={rule.action} onChange={(event) => updateRule(index, { action: event.target.value as CanonicalFirewallRule["action"] })}><option value="ALLOW">ALLOW</option><option value="DENY">DENY</option></select></td>
                        <td className="px-3 py-3"><select className="rounded-lg border border-[var(--line)] px-2 py-1" value={rule.protocol} onChange={(event) => updateRule(index, { protocol: event.target.value as CanonicalFirewallRule["protocol"] })}><option value="TCP">TCP</option><option value="UDP">UDP</option><option value="ICMP">ICMP</option><option value="ANY">ANY</option></select></td>
                        <td className="px-3 py-3"><div className="flex gap-2"><input className="w-20 rounded-lg border border-[var(--line)] px-2 py-1" type="number" placeholder="Start" value={rule.portStart || ""} onChange={(event) => updateRule(index, { portStart: event.target.value ? Number(event.target.value) : undefined })} /><input className="w-20 rounded-lg border border-[var(--line)] px-2 py-1" type="number" placeholder="End" value={rule.portEnd || ""} onChange={(event) => updateRule(index, { portEnd: event.target.value ? Number(event.target.value) : undefined })} /></div></td>
                        <td className="px-3 py-3"><input className="w-40 rounded-lg border border-[var(--line)] px-2 py-1" value={rule.sourceCidr || ""} onChange={(event) => updateRule(index, { sourceCidr: event.target.value || undefined })} placeholder="0.0.0.0/0" /></td>
                        <td className="px-3 py-3"><input className="w-48 rounded-lg border border-[var(--line)] px-2 py-1" value={rule.description || ""} onChange={(event) => updateRule(index, { description: event.target.value || undefined })} placeholder="Description" /></td>
                        <td className="px-3 py-3"><input type="checkbox" checked={rule.isEnabled} onChange={(event) => updateRule(index, { isEnabled: event.target.checked })} /></td>
                        <td className="px-3 py-3"><ActionButton variant="ghost" className="px-2 py-1" onClick={() => removeRule(index)}>Remove</ActionButton></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </VpsSectionCard>

          <VpsSectionCard title="Outbound rules" description="Traffic leaving the server.">
            <div className="overflow-hidden rounded-2xl border border-[var(--line)]">
              <table className="min-w-full border-collapse text-sm">
                <thead className="bg-[var(--surface-2)] text-left text-[var(--ink-muted)]">
                  <tr>
                    <th className="px-3 py-3 font-semibold">Priority</th>
                    <th className="px-3 py-3 font-semibold">Action</th>
                    <th className="px-3 py-3 font-semibold">Protocol</th>
                    <th className="px-3 py-3 font-semibold">Ports</th>
                    <th className="px-3 py-3 font-semibold">Destination</th>
                    <th className="px-3 py-3 font-semibold">Description</th>
                    <th className="px-3 py-3 font-semibold">Enabled</th>
                    <th className="px-3 py-3 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {outboundRules.map((rule) => {
                    const index = draft.rules.indexOf(rule);
                    return (
                      <tr key={rule.id || `outbound-${index}`} className="border-t border-[var(--line)] align-top">
                        <td className="px-3 py-3"><input className="w-20 rounded-lg border border-[var(--line)] px-2 py-1" type="number" value={rule.priority} onChange={(event) => updateRule(index, { priority: Number(event.target.value || 100) })} /></td>
                        <td className="px-3 py-3"><select className="rounded-lg border border-[var(--line)] px-2 py-1" value={rule.action} onChange={(event) => updateRule(index, { action: event.target.value as CanonicalFirewallRule["action"] })}><option value="ALLOW">ALLOW</option><option value="DENY">DENY</option></select></td>
                        <td className="px-3 py-3"><select className="rounded-lg border border-[var(--line)] px-2 py-1" value={rule.protocol} onChange={(event) => updateRule(index, { protocol: event.target.value as CanonicalFirewallRule["protocol"] })}><option value="TCP">TCP</option><option value="UDP">UDP</option><option value="ICMP">ICMP</option><option value="ANY">ANY</option></select></td>
                        <td className="px-3 py-3"><div className="flex gap-2"><input className="w-20 rounded-lg border border-[var(--line)] px-2 py-1" type="number" placeholder="Start" value={rule.portStart || ""} onChange={(event) => updateRule(index, { portStart: event.target.value ? Number(event.target.value) : undefined })} /><input className="w-20 rounded-lg border border-[var(--line)] px-2 py-1" type="number" placeholder="End" value={rule.portEnd || ""} onChange={(event) => updateRule(index, { portEnd: event.target.value ? Number(event.target.value) : undefined })} /></div></td>
                        <td className="px-3 py-3"><input className="w-40 rounded-lg border border-[var(--line)] px-2 py-1" value={rule.destinationCidr || ""} onChange={(event) => updateRule(index, { destinationCidr: event.target.value || undefined })} placeholder="0.0.0.0/0" /></td>
                        <td className="px-3 py-3"><input className="w-48 rounded-lg border border-[var(--line)] px-2 py-1" value={rule.description || ""} onChange={(event) => updateRule(index, { description: event.target.value || undefined })} placeholder="Description" /></td>
                        <td className="px-3 py-3"><input type="checkbox" checked={rule.isEnabled} onChange={(event) => updateRule(index, { isEnabled: event.target.checked })} /></td>
                        <td className="px-3 py-3"><ActionButton variant="ghost" className="px-2 py-1" onClick={() => removeRule(index)}>Remove</ActionButton></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </VpsSectionCard>
        </div>

        <div className="space-y-6">
          <VpsSectionCard title="Validation and safety" description="Warnings, rollback posture, and provider support for this firewall profile.">
            <div className="space-y-4 text-sm">
              <div>
                <p className="font-semibold text-[var(--ink)]">Validation</p>
                {activeValidation.errors.length ? (
                  <ul className="mt-2 space-y-2 text-rose-700">
                    {activeValidation.errors.map((entry) => <li key={entry} className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2">{entry}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">Validation is clean.</p>
                )}
              </div>
              <div>
                <p className="font-semibold text-[var(--ink)]">Warnings</p>
                {activeValidation.warnings.length ? (
                  <ul className="mt-2 space-y-2 text-amber-900">
                    {activeValidation.warnings.map((entry) => <li key={entry} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2">{entry}</li>)}
                  </ul>
                ) : (
                  <p className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-[var(--ink-muted)]">No current warnings.</p>
                )}
              </div>
              <div className="grid gap-2 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                <p><span className="font-semibold text-[var(--ink)]">Provider firewall read:</span> {firewall.capabilities.firewallRead ? "Enabled" : "Unavailable"}</p>
                <p><span className="font-semibold text-[var(--ink)]">Provider firewall write:</span> {firewall.capabilities.firewallWrite ? "Enabled" : "Read-only"}</p>
                <p><span className="font-semibold text-[var(--ink)]">Rollback window:</span> {draft.rollbackWindowSec}s</p>
                <p><span className="font-semibold text-[var(--ink)]">Last confirmation:</span> {formatDateTime(firewall.confirmedAt)}</p>
              </div>
            </div>
          </VpsSectionCard>

          <VpsSectionCard title="Templates" description="Seed a draft from a known-safe starting point before previewing and applying.">
            <div className="space-y-3">
              {firewall.templates.map((template) => (
                <button
                  key={template.slug}
                  type="button"
                  className="w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-left transition hover:bg-[var(--surface-2)]"
                  onClick={() => applyTemplate(template)}
                >
                  <p className="font-semibold text-[var(--ink)]">{template.name}</p>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">{template.description}</p>
                </button>
              ))}
            </div>
          </VpsSectionCard>

          <VpsSectionCard title="Apply preview" description="Diff, warnings, and confirmation controls before mutating the provider.">
            {!preview ? (
              <p className="text-sm text-[var(--ink-muted)]">Run Preview Changes to inspect the diff and risk level.</p>
            ) : (
              <div className="space-y-4 text-sm">
                <div className="flex items-center gap-3">
                  {riskBadge(preview.diff.riskLevel)}
                  <span className="text-[var(--ink-muted)]">Added {preview.diff.added.length}, changed {preview.diff.changed.length}, removed {preview.diff.removed.length}</span>
                </div>
                <div className="space-y-2">
                  {preview.diff.warnings.map((entry) => (
                    <div key={entry} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900">{entry}</div>
                  ))}
                  {!preview.diff.warnings.length ? (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-800">No diff-specific warnings.</div>
                  ) : null}
                </div>
                <div className="rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
                  <p className="font-semibold text-[var(--ink)]">Changed rules</p>
                  <ul className="mt-2 space-y-2 text-[var(--ink-muted)]">
                    {preview.diff.added.map((rule) => <li key={`added-${rule.priority}-${rulePorts(rule)}`}>Added {rule.direction.toLowerCase()} {rule.action.toLowerCase()} {rule.protocol.toLowerCase()} {rulePorts(rule)}</li>)}
                    {preview.diff.changed.map((rule) => <li key={`changed-${rule.before.priority}-${rule.after.priority}`}>Changed {rule.before.direction.toLowerCase()} priority {rule.before.priority} to {rule.after.priority}</li>)}
                    {preview.diff.removed.map((rule) => <li key={`removed-${rule.priority}-${rulePorts(rule)}`}>Removed {rule.direction.toLowerCase()} {rule.action.toLowerCase()} {rule.protocol.toLowerCase()} {rulePorts(rule)}</li>)}
                  </ul>
                </div>
                {highRisk ? (
                  <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={acknowledgedHighRisk} onChange={(event) => setAcknowledgedHighRisk(event.target.checked)} />
                      I understand these firewall changes are high risk.
                    </label>
                    <label className="space-y-2 block">
                      <span className="font-semibold">Type APPLY to continue</span>
                      <input className="w-full rounded-xl border border-rose-200 px-3 py-2 text-sm" value={typedConfirmation} onChange={(event) => setTypedConfirmation(event.target.value)} />
                    </label>
                  </div>
                ) : null}
              </div>
            )}
          </VpsSectionCard>
        </div>
      </div>
    </div>
  );
}
