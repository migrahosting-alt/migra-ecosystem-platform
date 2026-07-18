// Intelligent Provider Router — Slice 2: bounded coding-outcome assessment.
//
// A deterministic, cheap quality check on a LOCAL coding result. It does not call
// a model or a provider — it inspects the produced text. When the local result
// looks empty, refused, or below signal, it recommends fallback (advisory only in
// Slice 2; no cloud is invoked). Escalation/consent is Slice 3.
//
// © MigraTeck LLC.

export interface CodingAssessment {
  ok: boolean;
  fallbackRecommended: boolean;
  reasons: string[];
}

const REFUSAL = /\b(i (can'?t|cannot|am unable to|won'?t)|as an ai\b|i'?m (unable|not able) to|i do not have the ability)/i;
const MIN_SIGNAL_CHARS = 24;

export interface AssessInput {
  /** The local model's final output for the coding turn. */
  output: string;
  /** Whether the coding loop reported a hard failure (e.g. provider error). */
  failed?: boolean;
}

export function assessCodingOutcome(input: AssessInput): CodingAssessment {
  const reasons: string[] = [];
  const text = (input.output ?? '').trim();

  if (input.failed) reasons.push('local coding run reported a failure');
  if (text.length === 0) reasons.push('empty local output');
  else if (REFUSAL.test(text)) reasons.push('local model appears to have refused');
  else if (text.length < MIN_SIGNAL_CHARS) reasons.push('local output below signal threshold');

  const ok = reasons.length === 0;
  return { ok, fallbackRecommended: !ok, reasons };
}
