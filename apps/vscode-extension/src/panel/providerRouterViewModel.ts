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

// ── Escalation reason wording (defined reasons only) ───────────────────────────

const REASON_TEXT: Record<string, string> = {
  LOCAL_TIMEOUT: 'The local model timed out',
  LOCAL_MALFORMED_OUTPUT: 'The local model returned malformed or empty output',
  LOCAL_CONTEXT_LIMIT: 'The local model hit its context limit',
  LOCAL_UNSUPPORTED_CAPABILITY: 'No local model can satisfy this request',
};
export function escalationReasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason;
}

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

// ── Cloud escalation consent card (Slice 3 offer → user consent surface) ───────

export interface EscalationOfferView {
  offerId: string;
  token: string;
  reason: string;
  target?: { providerId: string; modelId: string };
  estimatedCostUsd?: number;
  worstCaseCostUsd?: number;
  remainingBudgetUsd?: number;
  dataLeavesLocal?: boolean;
  request?: unknown;
}

export interface EscalationCard {
  title: string;
  lines: string[];
  actions: ['Approve once', 'Decline', 'Stay local'];
}

/** Build the consent-card content from a SERVER-issued offer. The UI shows exactly
 * this before any cloud call; it never reconstructs provider/model/reason/ceiling. */
export function escalationCardContent(offer: EscalationOfferView): EscalationCard {
  const lines = [
    `Reason: ${escalationReasonText(offer.reason)}`,
    `Provider: ${offer.target?.providerId ?? 'unknown'}`,
    `Model: ${offer.target?.modelId ?? 'unknown'}`,
    `Data leaving this device: ${offer.dataLeavesLocal ? 'current prompt and selected workspace context' : 'none'}`,
    `Estimated cost: ${usd(offer.estimatedCostUsd, 'estimated')}`,
    `Worst-case cost: ${usd(offer.worstCaseCostUsd, 'estimated')}`,
    `Remaining budget: ${offer.remainingBudgetUsd === undefined ? 'unknown' : usd(offer.remainingBudgetUsd, 'calculated')}`,
  ];
  return { title: 'Cloud fallback requested', lines, actions: ['Approve once', 'Decline', 'Stay local'] };
}

/** True only when the offer carries everything needed to approve (defense against
 * a malformed / partial offer that must not be actionable). */
export function offerIsApprovable(offer: Partial<EscalationOfferView> | undefined): boolean {
  return !!offer && typeof offer.offerId === 'string' && typeof offer.token === 'string' && !!offer.target && offer.request !== undefined;
}

export const OFFER_EXPIRED_MESSAGE = 'This cloud offer expired. Request a new evaluation.';

// ── Provider attribution (how a completed response was handled) ────────────────

export interface RoutingView {
  provider?: string;
  model?: string;
  requestedPolicy?: string;
  effectivePolicy?: string;
  policyReason?: string;
  fallbackRecommended?: boolean;
  viaEscalation?: boolean;
  escalationReason?: string;
  costUsd?: number;
  costStatus?: 'actual' | 'calculated' | 'estimated' | 'unknown';
  approvedCeilingUsd?: number;
}

export interface Attribution {
  headline: string;
  lines: string[];
}

/** Truthful attribution — never implies "local" merely because local started
 * first. Distinguishes local success, cloud fallback used, and fallback
 * recommended-but-not-approved. */
export function attributionView(r: RoutingView): Attribution {
  const policyLine = r.effectivePolicy
    ? r.requestedPolicy && r.requestedPolicy !== r.effectivePolicy
      ? `Policy: ${r.requestedPolicy} → ${r.effectivePolicy}${r.policyReason ? ` (${r.policyReason})` : ''}`
      : `Policy: ${r.effectivePolicy}`
    : undefined;
  if (r.viaEscalation) {
    return {
      headline: `Cloud fallback used · ${r.provider ?? '?'}${r.model ? ` · ${r.model}` : ''}`,
      lines: [
        ...(r.escalationReason ? [`Reason: ${escalationReasonText(r.escalationReason)}`] : []),
        ...(r.approvedCeilingUsd !== undefined ? [`Approved cost ceiling: ${usd(r.approvedCeilingUsd, 'estimated')}`] : []),
        `Actual estimated cost: ${usd(r.costUsd, r.costStatus ?? 'estimated')}`,
        ...(policyLine ? [policyLine] : []),
      ],
    };
  }
  if (r.fallbackRecommended) {
    return { headline: 'Local result returned', lines: ['Cloud fallback recommended but not approved', ...(policyLine ? [policyLine] : [])] };
  }
  return {
    headline: `Handled locally${r.provider ? ` · ${r.provider}` : ''}${r.model ? ` · ${r.model}` : ''}`,
    lines: policyLine ? [policyLine] : [],
  };
}

// ── Failure/blocked-state mapping (message + machine code preserved) ───────────

const FAILURE_TEXT: Record<string, string> = {
  LOCAL_UNSUPPORTED_CAPABILITY: 'No local model can handle this request.',
  NO_LOCAL_MODEL: 'No local model is available.',
  LOCAL_CAPABILITY_LIMIT: 'The local engine could not complete this to the required standard.',
  CLOUD_CONSENT_REQUIRED: 'A cloud provider could continue this task, but explicit approval is required.',
  BUDGET_EXCEEDED: 'Cloud execution was blocked because the approved budget is insufficient.',
  REQUEST_COST_LIMIT_EXCEEDED: 'Cloud execution was blocked: the estimated cost exceeds the per-request limit.',
  PROVIDER_COST_LIMIT_EXCEEDED: 'Cloud execution was blocked: the provider budget is insufficient.',
  BUDGET_DISABLED: 'Cloud execution is disabled (budget enforcement is off).',
  BUDGET_NOT_CONFIGURED: 'Cloud execution is blocked: no budget is configured.',
  COST_ESTIMATE_UNAVAILABLE: 'Cloud execution was blocked because a trustworthy cost estimate is unavailable.',
  CEILING_EXCEEDED: 'Cloud execution was blocked: the estimated cost exceeds the approved ceiling.',
  TARGET_INELIGIBLE: 'The selected provider is no longer eligible.',
  PROVIDER_UNAVAILABLE: 'The selected provider is currently unavailable.',
  OFFER_INVALID: OFFER_EXPIRED_MESSAGE,
  CLOUD_DATA_TRANSFER_NOT_ALLOWED: 'The current privacy policy does not allow this data to leave the local environment.',
  ESCALATION_FAILED: 'The cloud attempt failed.',
};

export interface FailureView {
  message: string;
  code: string;
}
/** Map a server failure code to a clear message while KEEPING the machine code. */
export function failureView(code: string | undefined): FailureView {
  const c = code ?? 'UNKNOWN';
  return { message: FAILURE_TEXT[c] ?? 'The request could not be completed.', code: c };
}

// ── Task-level execution details (safe metadata only) ──────────────────────────

export function shortCorrelation(id: string | undefined): string {
  if (!id) return '—';
  return id.length > 14 ? `${id.slice(0, 6)}…${id.slice(-4)}` : id;
}
