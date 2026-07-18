// Operational Readiness Slice 5 — the Read-Only Production Diagnostics Provider.
//
// A dedicated provider, SEPARATE from the local workspace engineer, the capability
// registry, fs.applyChangeset, production delegation, and command.run. It is
// disabled by default and fails closed at every gate. It exposes ONLY read-only
// `production.diagnostics.*` capabilities against SERVER-REGISTERED targets — no
// generic shell, no client-supplied target, no mutation path.
//
// © MigraTeck LLC.

import { randomUUID } from 'node:crypto';
import { auditStore } from '../auditLog.js';
import { newCorrelationId } from '../correlation.js';
import { redactString } from '../redaction.js';
import {
  DiagnosticError,
  RESULT_CAPS,
  isDiagnosticCapabilityId,
  type DiagnosticCapabilityId,
  type DiagnosticResult,
  type DiagnosticStatus,
} from './types.js';
import type { Environment, ProductionTarget } from './targetRegistry.js';
import { ProductionTargetRegistry } from './targetRegistry.js';
import type { Prober } from './deps.js';
import { NullProber } from './deps.js';

/** Bounded, validated diagnostic parameters. NO host/url/port/command/sql/path —
 * only these safe, capped keys are ever accepted. */
export interface DiagnosticParams {
  endpointId?: string;
  windowMinutes: number;
  maxLines: number;
  includeBody: boolean;
}

/** The ONLY param keys a client may send. Anything else → ARBITRARY_INPUT_REJECTED. */
const SAFE_PARAM_KEYS = new Set(['endpointId', 'windowMinutes', 'maxLines', 'includeBody']);

export interface CapabilityRunContext {
  target: ProductionTarget;
  params: DiagnosticParams;
  prober: Prober;
  registry: ProductionTargetRegistry;
}

/** A read-only diagnostic capability. `run` returns evidence; it never mutates. */
export interface DiagnosticCapability {
  id: DiagnosticCapabilityId;
  /** Human-facing one-liner (safe metadata). */
  description: string;
  run(ctx: CapabilityRunContext): Promise<DiagnosticResult>;
}

export interface DiagnosticRunRequest {
  /** Authenticated operator principal (established by the route, NOT the model). */
  operator: string;
  targetId: string;
  capability: string;
  params?: Record<string, unknown>;
  /** Optional inbound correlation (else minted). */
  correlationId?: string;
}

export interface DiagnosticRunRecord {
  runId: string;
  correlationId: string;
  at: number;
  targetId: string;
  capability: string;
  environment: Environment;
  status?: DiagnosticStatus;
  errorCode?: string;
  result?: DiagnosticResult;
}

export interface ProviderConfig {
  /** Disabled by default — the provider fails closed until explicitly enabled. */
  enabled: boolean;
  approvedEnvironments: Environment[];
  /** Authenticated operator principals permitted to run diagnostics. Local
   * coding-agent availability does NOT populate this — it is a separate gate. */
  operators: Set<string>;
  /** Hard per-request timeout ceiling (a target may only be stricter). */
  maxTimeoutMs: number;
}

const MAX_RUN_HISTORY = 500;

export class ProductionDiagnosticsProvider {
  private readonly capabilities = new Map<DiagnosticCapabilityId, DiagnosticCapability>();
  private readonly runs = new Map<string, DiagnosticRunRecord>();
  private readonly runOrder: string[] = [];
  private readonly rate = new Map<string, number[]>(); // targetId → recent request times

  constructor(
    private readonly config: ProviderConfig,
    private readonly registry: ProductionTargetRegistry,
    capabilities: DiagnosticCapability[] = [],
    private readonly prober: Prober = new NullProber(),
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = randomUUID,
  ) {
    for (const c of capabilities) this.capabilities.set(c.id, c);
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  status(): { enabled: boolean; approvedEnvironments: Environment[]; targetCount: number; capabilityCount: number } {
    return {
      enabled: this.config.enabled,
      approvedEnvironments: [...this.config.approvedEnvironments],
      targetCount: this.registry.size(),
      capabilityCount: this.capabilities.size,
    };
  }

  registeredCapabilityIds(): DiagnosticCapabilityId[] {
    return [...this.capabilities.keys()].sort();
  }

  listTargets() {
    return this.registry.list();
  }

  getRun(runId: string): DiagnosticRunRecord | undefined {
    return this.runs.get(runId);
  }

  /** Bounded, newest-first run history (safe metadata + redacted result). */
  history(limit = 50): DiagnosticRunRecord[] {
    return this.runOrder
      .slice(-Math.max(0, Math.min(limit, MAX_RUN_HISTORY)))
      .reverse()
      .map((id) => this.runs.get(id)!)
      .filter(Boolean);
  }

  /** Execute a diagnostic. Fails closed at every gate; every attempt is audited. */
  async run(req: DiagnosticRunRequest): Promise<{ runId: string; correlationId: string; result: DiagnosticResult }> {
    const correlationId = req.correlationId?.trim() || newCorrelationId(this.now);
    const auditBase = { correlationId, component: 'production-diagnostics' as const };

    const deny = (code: string, message: string): never => {
      auditStore.append({ ...auditBase, type: 'production.diagnostics.denied', outcome: code, fields: { target: safeId(req.targetId), capability: safeId(req.capability), code } });
      throw new DiagnosticError(code as never, message);
    };

    // 1) Provider disabled → fail closed.
    if (!this.config.enabled) deny('PROVIDER_DISABLED', 'production diagnostics provider is disabled');

    // 2) Authenticated operator required (independent of local agent availability).
    if (!req.operator || !this.config.operators.has(req.operator)) deny('UNAUTHORIZED', 'operator is not authorized for production diagnostics');

    // 3) Capability must be a registered, read-only diagnostics capability. Any
    //    mutation-style request ("restart"/"deploy"/unknown) → READ_ONLY_CAPABILITY.
    if (!isDiagnosticCapabilityId(req.capability) || !this.capabilities.has(req.capability)) {
      deny('READ_ONLY_CAPABILITY', 'only registered read-only diagnostic capabilities may run');
    }
    const capability = this.capabilities.get(req.capability as DiagnosticCapabilityId)!;

    // 4) Reject arbitrary client input BEFORE any target/network resolution.
    const params = this.validateParams(req.params, deny);

    // 5) Resolve a server-registered + enabled target (unknown/disabled → not allowed).
    const target = this.registry.resolve(req.targetId);
    if (!target) deny('TARGET_NOT_ALLOWED', 'target is not registered or not enabled');
    const t = target!;

    // 6) Environment allowlist.
    if (!this.config.approvedEnvironments.includes(t.environment)) deny('ENVIRONMENT_NOT_ALLOWED', 'target environment is not approved');

    // 7) Capability must be approved FOR THIS TARGET.
    if (!t.approvedCapabilities.includes(capability.id)) deny('CAPABILITY_NOT_ALLOWED_FOR_TARGET', 'capability is not approved for this target');

    // 8) An endpointId param, if present, must resolve to an approved endpoint.
    if (params.endpointId && !this.registry.endpoint(t, params.endpointId)) {
      deny('ARBITRARY_INPUT_REJECTED', 'endpoint is not an approved endpoint for this target');
    }

    // 9) Rate limit per target.
    if (!this.allowRate(t)) deny('RATE_LIMITED', 'rate limit exceeded for this target');

    // Record the request (audited) then execute under timeout + caps.
    auditStore.append({ ...auditBase, type: 'production.diagnostics.requested', fields: { target: t.targetId, capability: capability.id, environment: t.environment } });

    const timeoutMs = Math.min(t.timeoutMs, this.config.maxTimeoutMs);
    const runId = `pdr_${this.mkId()}`;
    const record: DiagnosticRunRecord = { runId, correlationId, at: this.now(), targetId: t.targetId, capability: capability.id, environment: t.environment };

    try {
      const raw = await this.withTimeout(capability.run({ target: t, params, prober: this.prober, registry: this.registry }), timeoutMs);
      const result = this.capResult(raw, t.redactionProfile);
      record.status = result.status;
      record.result = result;
      this.store(record);
      auditStore.append({ ...auditBase, type: 'production.diagnostics.completed', outcome: result.status, fields: { target: t.targetId, capability: capability.id, environment: t.environment, status: result.status } });
      return { runId, correlationId, result };
    } catch (err) {
      const code = err instanceof DiagnosticError ? err.code : 'TIMEOUT';
      record.errorCode = code;
      this.store(record);
      auditStore.append({ ...auditBase, type: 'production.diagnostics.failed', outcome: code, fields: { target: t.targetId, capability: capability.id, code } });
      throw err instanceof DiagnosticError ? err : new DiagnosticError('TIMEOUT', 'diagnostic timed out');
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private validateParams(raw: unknown, deny: (c: string, m: string) => never): DiagnosticParams {
    const out: DiagnosticParams = { windowMinutes: 15, maxLines: 200, includeBody: false };
    if (raw === undefined || raw === null) return out;
    if (typeof raw !== 'object' || Array.isArray(raw)) deny('ARBITRARY_INPUT_REJECTED', 'params must be a bounded object');
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      // Allowlist: any key outside the safe set (host/url/port/command/sql/path/…) is refused.
      if (!SAFE_PARAM_KEYS.has(k)) deny('ARBITRARY_INPUT_REJECTED', `unsupported parameter: ${safeId(k)}`);
      if (k === 'endpointId') {
        if (typeof v !== 'string' || !/^[A-Za-z0-9._-]{1,64}$/.test(v)) deny('ARBITRARY_INPUT_REJECTED', 'endpointId must be a simple identifier (no host/url/path)');
        out.endpointId = v as string;
      } else if (k === 'windowMinutes') {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1440) deny('ARBITRARY_INPUT_REJECTED', 'windowMinutes out of range');
        out.windowMinutes = v as number;
      } else if (k === 'maxLines') {
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 1000) deny('ARBITRARY_INPUT_REJECTED', 'maxLines out of range');
        out.maxLines = v as number;
      } else if (k === 'includeBody') {
        if (typeof v !== 'boolean') deny('ARBITRARY_INPUT_REJECTED', 'includeBody must be boolean');
        out.includeBody = v as boolean;
      }
    }
    return out;
  }

  private allowRate(t: ProductionTarget): boolean {
    const now = this.now();
    const win = (this.rate.get(t.targetId) ?? []).filter((ts) => now - ts < 60_000);
    if (win.length >= t.rateLimitPerMinute) {
      this.rate.set(t.targetId, win);
      return false;
    }
    win.push(now);
    this.rate.set(t.targetId, win);
    return true;
  }

  private withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new DiagnosticError('TIMEOUT', 'diagnostic timed out')), ms);
      p.then(
        (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  /** Bound + redact a result before it leaves trusted execution. Every string is
   * run through the canonical redactor (paths + secrets); arrays are capped. */
  private capResult(r: DiagnosticResult, _profile: 'standard' | 'strict'): DiagnosticResult {
    const scrub = (s: string): string => redactString(String(s), { redactPaths: true }).value.slice(0, RESULT_CAPS.maxStringLen);
    const evidence: Record<string, string | number | boolean> = {};
    let n = 0;
    for (const [k, v] of Object.entries(r.evidence ?? {})) {
      if (n >= RESULT_CAPS.maxEvidenceKeys) break;
      evidence[scrub(k)] = typeof v === 'string' ? scrub(v) : v;
      n += 1;
    }
    return {
      status: r.status,
      observations: (r.observations ?? []).slice(0, RESULT_CAPS.maxObservations).map(scrub),
      evidence,
      interpretation: scrub(r.interpretation ?? ''),
      limitations: (r.limitations ?? []).slice(0, RESULT_CAPS.maxLimitations).map(scrub),
      recommendedNextSteps: (r.recommendedNextSteps ?? []).slice(0, RESULT_CAPS.maxNextSteps).map(scrub),
    };
  }

  private store(record: DiagnosticRunRecord): void {
    this.runs.set(record.runId, record);
    this.runOrder.push(record.runId);
    while (this.runOrder.length > MAX_RUN_HISTORY) {
      const evicted = this.runOrder.shift()!;
      this.runs.delete(evicted);
    }
  }
}

/** A safe, bounded identifier for audit fields — strips anything that could carry
 * a path/url/secret and caps length (defense in depth; audit also redacts). */
function safeId(v: string): string {
  return String(v ?? '')
    .replace(/[^A-Za-z0-9._:-]/g, '')
    .slice(0, 80);
}
