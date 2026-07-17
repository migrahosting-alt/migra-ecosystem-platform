// Operational Readiness Slice 5 — Read-Only Production Diagnostics.
//
// Shared types + the diagnostic RESULT CONTRACT. This subsystem is DIAGNOSTICS
// ONLY: it inspects production health and produces evidence. It holds NO mutation
// capability, no generic shell, and no client-supplied target. It is deliberately
// kept separate from the local workspace engineer, fs.applyChangeset, production
// delegation, and command.run.
//
// © MigraTeck LLC.

/** Bounded diagnostic status — never "healthy" merely because a connection opened. */
export type DiagnosticStatus =
  | 'healthy'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'unreachable'
  | 'unauthorized';

/** Fail-closed error codes surfaced to the operator (no internals, no secrets). */
export type DiagnosticFailureCode =
  | 'PROVIDER_DISABLED'
  | 'UNAUTHORIZED'
  | 'TARGET_NOT_ALLOWED'
  | 'ENVIRONMENT_NOT_ALLOWED'
  | 'CAPABILITY_NOT_ALLOWED_FOR_TARGET'
  | 'READ_ONLY_CAPABILITY'
  | 'ARBITRARY_INPUT_REJECTED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'OUTPUT_CAPPED'
  | 'UNKNOWN_RUN';

/** The canonical read-only capability namespace. Every id is `production.diagnostics.*`
 * and every one is read-only by construction. There is intentionally NO restart,
 * deploy, write, renew, migrate, or shell capability in this union. */
export const DIAGNOSTIC_CAPABILITY_IDS = [
  'production.diagnostics.serviceHealth',
  'production.diagnostics.logs',
  'production.diagnostics.metrics',
  'production.diagnostics.database',
  'production.diagnostics.dns',
  'production.diagnostics.tls',
  'production.diagnostics.http',
  'production.diagnostics.mail',
  'production.diagnostics.storage',
  'production.diagnostics.summary',
] as const;

export type DiagnosticCapabilityId = (typeof DIAGNOSTIC_CAPABILITY_IDS)[number];

export function isDiagnosticCapabilityId(id: string): id is DiagnosticCapabilityId {
  return (DIAGNOSTIC_CAPABILITY_IDS as readonly string[]).includes(id);
}

/** The result contract (spec §6). Evidence is bounded + redacted before it leaves
 * trusted execution. Recommendations are ADVISORY TEXT ONLY — they can never
 * trigger remediation; nothing in the system consumes them as an instruction. */
export interface DiagnosticResult {
  status: DiagnosticStatus;
  observations: string[];
  /** Bounded, redacted key→scalar evidence. Never contains secrets or raw creds. */
  evidence: Record<string, string | number | boolean>;
  interpretation: string;
  limitations: string[];
  recommendedNextSteps: string[];
}

/** A diagnostic error surfaced to the operator: a bounded code + a safe message.
 * No stack, no internal host/credential detail. */
export class DiagnosticError extends Error {
  constructor(
    readonly code: DiagnosticFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'DiagnosticError';
  }
}

/** Caps applied to every diagnostic result before transport/persistence. */
export const RESULT_CAPS = {
  maxObservations: 40,
  maxEvidenceKeys: 40,
  maxLimitations: 20,
  maxNextSteps: 20,
  maxStringLen: 2000,
} as const;
