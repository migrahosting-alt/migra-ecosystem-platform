// Intelligent Provider Router — Slice 5: pure view-model (no `vscode` import).
//
// Transforms server-authoritative provider/policy/budget/usage state into display
// data for the extension UI. It computes NO routing/pricing/budget/consent — it
// only formats what the server returned, and it never surfaces credential values,
// raw endpoints, prompts, tokens, or paths.
//
// © MigraTeck LLC.

import type { PolicyDef, PolicyId, ProviderView, BudgetResponse, UsageResponse } from '../services/providerRouterClient.js';

export type Tone = 'ok' | 'warn' | 'error' | 'info' | 'muted';

// ── Policy selector ──────────────────────────────────────────────────────────

export interface PolicyPickItem {
  id: PolicyId;
  label: string;
  description: string;
  picked: boolean;
}

/** QuickPick items for the execution-policy selector. `Custom` is marked
 * inspection-only (no server mutation API yet) rather than inventing client
 * behavior. */
export function policyPickItems(policies: PolicyDef[], current: PolicyId): PolicyPickItem[] {
  return policies.map((p) => ({
    id: p.id,
    label: p.id === current ? `● ${p.displayName}` : `○ ${p.displayName}`,
    description: p.id === 'custom' ? `${p.description} (inspection-only)` : p.description,
    picked: p.id === current,
  }));
}

/** The status-bar label for the active policy. */
export function policyStatusLabel(policies: PolicyDef[], current: PolicyId): string {
  const def = policies.find((p) => p.id === current);
  return `MigraPilot: ${def?.displayName ?? current}`;
}

/** Requested-vs-effective display. Never a silent substitution — when they differ
 * the reason is shown. */
export function policyEffectiveNote(requested?: string, effective?: string, reason?: string): string | undefined {
  if (!requested || !effective || requested === effective) return undefined;
  return `Requested policy: ${requested} · Effective policy: ${effective}${reason ? ` · Reason: ${reason}` : ''}`;
}

// ── Provider status rows (read-only; no credential values / raw endpoints) ─────

export interface ProviderRow {
  name: string;
  type: 'Local' | 'Cloud';
  tone: Tone;
  health: string;
  enabled: boolean;
  model?: string;
  capabilities: string;
  note?: string;
}

function healthTone(status: ProviderView['health']['status'], enabled: boolean): Tone {
  if (!enabled || status === 'disabled') return 'muted';
  if (status === 'healthy') return 'ok';
  if (status === 'degraded') return 'warn';
  if (status === 'unreachable') return 'error';
  return 'info';
}

export function providerRows(providers: ProviderView[]): ProviderRow[] {
  return providers.map((p) => {
    const caps = Object.entries(p.effectiveCapabilities ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .join(', ');
    let note: string | undefined;
    if (p.kind === 'cloud' && !p.enabled) note = 'Disabled';
    else if (p.kind === 'cloud' && !p.hasCredential) note = 'Credential not configured';
    else if (p.kind === 'cloud') note = 'Consent and budget required';
    return {
      name: p.displayName,
      type: p.kind === 'cloud' ? 'Cloud' : 'Local',
      tone: healthTone(p.health.status, p.enabled),
      health: p.enabled ? p.health.status : 'disabled',
      enabled: p.enabled,
      model: p.models[0]?.id,
      capabilities: caps || '—',
      note,
    };
  });
}

// ── Budget + usage rows ────────────────────────────────────────────────────────

export interface BudgetRow {
  label: string;
  value: string;
  tone: Tone;
}

/** Money formatting that NEVER renders an unknown as `$0.00`. */
export function usd(amount: number | undefined, status?: 'actual' | 'calculated' | 'estimated' | 'unknown'): string {
  if (status === 'unknown' || amount === undefined) return 'cost unknown';
  const label = status && status !== 'actual' ? ` (${status})` : '';
  return `$${amount.toFixed(2)}${label}`;
}

export function budgetRows(budget: BudgetResponse | undefined, usage: UsageResponse | undefined): BudgetRow[] {
  const rows: BudgetRow[] = [];
  if (!budget || !budget.enabled) {
    rows.push({ label: 'Cloud spending', value: 'disabled', tone: 'muted' });
  } else {
    for (const s of budget.scopes) {
      const usedFrac = s.hardLimitUsd > 0 ? (s.spentUsd + s.reservedUsd) / s.hardLimitUsd : 0;
      const tone: Tone = usedFrac >= 1 ? 'error' : usedFrac >= s.warningThreshold ? 'warn' : 'ok';
      rows.push({ label: `${s.kind} ${s.key === 'global' ? '' : s.key}`.trim(), value: `$${s.spentUsd.toFixed(2)} / $${s.hardLimitUsd.toFixed(2)}${s.reservedUsd > 0 ? ` · reserved $${s.reservedUsd.toFixed(2)}` : ''}`, tone });
    }
  }
  if (usage) {
    rows.push({ label: 'Cloud requests', value: String(usage.summary.cloud.count), tone: 'info' });
    rows.push({ label: 'Cloud spend', value: usd(usage.summary.cloud.costUsd, 'calculated'), tone: 'info' });
    rows.push({ label: 'Local requests', value: String(usage.summary.local.count), tone: 'info' });
    rows.push({
      label: 'Estimated avoided cloud spend',
      value: usage.summary.local.savingsStatus === 'unknown' ? 'unknown' : usd(usage.summary.local.estimatedSavingsUsd, 'estimated'),
      tone: 'muted',
    });
  }
  return rows;
}
