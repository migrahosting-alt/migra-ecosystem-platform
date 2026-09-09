/**
 * MigraAI Engine — shared tool-execution core.
 *
 * The single validated dispatch path for a capability execution. Both the public
 * `/api/ai/tools` route AND the agent runtime call this, so an agent's tool calls
 * go through the exact same validation, availability check, approval lifecycle,
 * and audit as a direct client call — no bypass boundary.
 */

import { CapabilityRegistry, type ReadinessContext } from '../models/capabilityRegistry.js';
import { ApprovalCapacityError, ToolApprovalStore, hashInput } from './toolApprovalStore.js';
import { ToolAudit } from './toolAudit.js';
import { NOOP_STAGE_LOGGER, type StageLogger } from '../observability/correlation.js';
import { auditStore, type AuditEventType } from '../observability/auditLog.js';
import { classifyToolFailure } from './toolFailureReason.js';

export interface ToolExecInput {
  tool?: string;
  input?: unknown;
  dryRun?: boolean;
  approvalId?: string;
  signal?: AbortSignal;
  requestId: string;
  /** Optional per-call correlation logger — emits approval/apply stage lines
   * (metadata only). Absent for uncorrelated direct calls. */
  stage?: StageLogger;
  /**
   * WHOSE data this call acts on. Forwarded verbatim to the handler.
   *
   * 🚨 Never defaulted here. A default principal is a shared one, and a shared
   * principal on a capability that reads a mailbox is a cross-tenant read.
   * Capabilities that need it refuse without it.
   */
  principal?: { owner: string; workspace: string };
  /**
   * 🚨 READINESS IS NOT AN INPUT. It is resolved below, from `principal`, by
   * `deps.readinessFor`.
   *
   * It used to be passed in, which meant the HTTP route resolved it and the
   * autonomous agent loop simply did not — so every connected-account
   * capability was denied inside the loop, and the denial read as "not
   * available" rather than as a missing wire. Two callers, two behaviours, one
   * of them silently wrong.
   *
   * Accepting it here would also let a caller declare its own readiness, which
   * on a capability that reads a mailbox is a second authorization path.
   */
}

/** Discriminated execution outcome. `httpStatus` lets the HTTP route map 1:1;
 * the agent runtime switches on `status`/`code`. */
export type ToolExecOutcome =
  | { ok: true; httpStatus: 200; status: 'ok' | 'dry_run' | 'approval_required' | 'executed'; tool: string; requestId: string; result?: unknown; preview?: unknown; approvalId?: string; expiresAt?: number }
  | { ok: false; httpStatus: number; code: string; tool: string; requestId: string; error: string; issues?: Array<{ path: string; message: string }>; requiredCapabilities?: string[]; reason?: string; details?: { appliedFileCount: number; affectedPathCount: number; rollbackFailureCount: number; failureStage: string } };

export interface ToolExecDeps {
  registry: CapabilityRegistry;
  approvals: ToolApprovalStore;
  audit: ToolAudit;
  /**
   * Resolve what a principal may currently do — their live connections and
   * authorization state.
   *
   * 🚨 ONE RESOLVER, FOR EVERY CALLER. The HTTP route and the autonomous agent
   * loop both reach capabilities through `executeToolCore`, so resolving here
   * is what stops the agent path from becoming a second authorization path
   * with its own idea of what is connected.
   *
   * Absent means no per-caller facts are available, which fails CLOSED: a
   * capability whose readiness depends on the caller stays unavailable rather
   * than falling back to a global lookup.
   */
  readinessFor?(principal: { owner: string; workspace: string }): Promise<ReadinessContext>;
}

export async function executeToolCore(deps: ToolExecDeps, req: ToolExecInput): Promise<ToolExecOutcome> {
  const { registry, approvals, audit } = deps;
  const { requestId } = req;
  const stage = req.stage ?? NOOP_STAGE_LOGGER;
  const toolId = req.tool;
  const cid = stage.correlationId;
  // Durable audit for tool.* transitions (metadata only). Only correlated calls
  // are audited; uncorrelated direct calls stay out of the execution chain.
  const recordAudit = (type: AuditEventType, outcome: string, fields: Record<string, unknown> = {}): void => {
    if (!cid || cid === 'none') return;
    // floating-ok: detached — `recordAudit` is called from synchronous stage
    // transitions and is documented as never breaking execution. No `tool.*` type
    // is in CRITICAL_EVENTS, so the write cannot fail closed; the catch keeps a
    // rejected write from surfacing as an unhandled rejection.
    void auditStore.append({ correlationId: cid, type, component: 'tool-executor', outcome, requestId, fields: { tool: toolId, ...fields } }).catch(() => { /* tool.* is non-critical */ });
  };
  const failWith = (readOnly: boolean, error: unknown): ToolExecOutcome => {
    recordAudit('tool.failed', 'error');
    return failed(audit, requestId, String(toolId), readOnly, error);
  };

  if (!toolId || typeof toolId !== 'string') {
    return { ok: false, httpStatus: 400, code: 'INVALID_INPUT', tool: String(toolId), requestId, error: 'A `tool` id is required.' };
  }

  const runnable = registry.runnable(toolId);
  if (!runnable) {
    audit.record({ requestId, tool: toolId, action: 'unknown_tool', readOnly: false, outcome: 'refused' });
    return { ok: false, httpStatus: 404, code: 'UNKNOWN_TOOL', tool: toolId, requestId, error: `Unknown capability: ${toolId}` };
  }
  /*
   * 🚨 RESOLVED FROM THE PRINCIPAL, NEVER FROM THE REQUEST.
   *
   * No principal means no per-caller facts, and the gate below then denies any
   * capability that needs them. That is the fail-closed direction: the
   * alternative — looking up "the" connection without knowing whose — is a
   * cross-tenant read waiting for one wiring mistake.
   */
  const readiness = req.principal && deps.readinessFor
    ? await deps.readinessFor(req.principal)
    : undefined;

  if (!registry.isAvailable(toolId, readiness)) {
    audit.record({ requestId, tool: toolId, action: 'denied', readOnly: runnable.descriptor.readOnly, outcome: 'refused' });
    recordAudit('tool.denied', 'refused');
    // A machine-readable reason here too, so a client branches on one vocabulary rather
    // than special-casing this code. The human message and gate are unchanged.
    return { ok: false, httpStatus: 403, code: 'CAPABILITY_DENIED', tool: toolId, requestId, error: `Capability not available: ${toolId}`, reason: 'CAPABILITY_DENIED', requiredCapabilities: runnable.descriptor.requiredCapabilities };
  }
  recordAudit('tool.requested', 'requested', { readOnly: runnable.descriptor.readOnly });

  const parsed = runnable.inputSchema.safeParse(req.input);
  if (!parsed.success) {
    audit.record({ requestId, tool: toolId, action: 'invalid_input', readOnly: runnable.descriptor.readOnly, outcome: 'refused' });
    return {
      ok: false,
      httpStatus: 400,
      code: 'INVALID_INPUT',
      tool: toolId,
      requestId,
      error: 'Tool input failed schema validation.',
      issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  const input = parsed.data;

  // Read-only → execute immediately.
  if (runnable.descriptor.readOnly) {
    try {
      const result = await runnable.handler(input, { correlationId: stage.correlationId, signal: req.signal, ...(req.principal ? { principal: req.principal } : {}) });
      audit.record({ requestId, tool: toolId, action: 'executed', readOnly: true, outcome: 'ok' });
      recordAudit('tool.completed', 'ok', { readOnly: true });
      return { ok: true, httpStatus: 200, status: 'ok', tool: toolId, requestId, result };
    } catch (error) {
      return failWith(true, error);
    }
  }

  // Mutating-class tools that DECLARE approvalRequired: false
  // execute immediately, exactly as the catalog advertises. Approval remains
  // mandatory for every tool that declares it (edit.apply).
  if (runnable.descriptor.approvalRequired === false) {
    try {
      const result = await runnable.handler(input, { correlationId: stage.correlationId, signal: req.signal, ...(req.principal ? { principal: req.principal } : {}) });
      audit.record({ requestId, tool: toolId, action: 'executed', readOnly: false, outcome: 'ok' });
      recordAudit('tool.completed', 'ok', { readOnly: false });
      return { ok: true, httpStatus: 200, status: 'executed', tool: toolId, requestId, result };
    } catch (error) {
      return failWith(false, error);
    }
  }

  const inputHash = hashInput(input);

  if (req.dryRun) {
    try {
      const preview = runnable.preview ? await runnable.preview(input, { correlationId: stage.correlationId }) : null;
      audit.record({ requestId, tool: toolId, action: 'dry_run', readOnly: false, outcome: 'ok' });
      return { ok: true, httpStatus: 200, status: 'dry_run', tool: toolId, requestId, preview };
    } catch (error) {
      return failWith(false, error);
    }
  }

  if (!req.approvalId) {
    let preview: unknown = null;
    try {
      preview = runnable.preview ? await runnable.preview(input, { correlationId: stage.correlationId }) : null;
    } catch (error) {
      return failWith(false, error);
    }
    let record;
    try {
      record = approvals.mint({ tool: toolId, inputHash, requestId, correlationId: stage.correlationId });
    } catch (error) {
      if (error instanceof ApprovalCapacityError) return { ok: false, httpStatus: 429, code: 'OVERLOADED', tool: toolId, requestId, error: 'The approval store is at capacity.' };
      return failWith(false, error);
    }
    audit.record({ requestId, tool: toolId, action: 'approval_required', readOnly: false, outcome: 'ok' });
    // Correlation: approval MINTED (metadata only — never the token).
    stage.log('approval', { tool: toolId, status: 'required' });
    return { ok: true, httpStatus: 200, status: 'approval_required', tool: toolId, requestId, approvalId: record.id, expiresAt: record.expiresAt, preview };
  }

  // approvalId present → single-use, bound consume → execute
  const consumed = approvals.consume(req.approvalId, { tool: toolId, inputHash, correlationId: stage.correlationId });
  if (!consumed.ok) {
    audit.record({ requestId, tool: toolId, action: 'replay_refused', readOnly: false, outcome: 'refused' });
    stage.log('approval', { tool: toolId, status: 'refused', reason: consumed.reason });
    return { ok: false, httpStatus: 409, code: 'INVALID_STATE', tool: toolId, requestId, error: `Approval ${consumed.reason}.`, reason: consumed.reason };
  }
  try {
    const applyStarted = Date.now();
    const result = await runnable.handler(input, { correlationId: stage.correlationId, signal: req.signal, ...(req.principal ? { principal: req.principal } : {}) });
    audit.record({ requestId, tool: toolId, action: 'executed', readOnly: false, outcome: 'ok' });
    recordAudit('tool.completed', 'ok', { approved: true });
    // Correlation: approved APPLY executed.
    stage.log('apply', { tool: toolId, durationMs: Date.now() - applyStarted, outcome: 'ok' });
    return { ok: true, httpStatus: 200, status: 'executed', tool: toolId, requestId, result, approvalId: req.approvalId };
  } catch (error) {
    return failWith(false, error);
  }
}

function failed(audit: ToolAudit, requestId: string, tool: string, readOnly: boolean, error: unknown): ToolExecOutcome {
  // The engine already knows WHY it refused. Collapsing every refusal into one opaque
  // sentence kept the safety property and threw away the diagnosis, so a caller could not
  // tell "someone edited that file under me" from "that path escapes the workspace".
  //
  // `classifyToolFailure` reads only the structured code (and, for a rollback, the
  // documented-safe bounded counts). The raw message and stack are still never forwarded —
  // that is what the generic message existed to protect, and it is preserved.
  const classified = classifyToolFailure(error);
  audit.record({ requestId, tool, action: 'tool_failed', readOnly, outcome: 'error' });
  return {
    ok: false,
    httpStatus: 502,
    code: 'TOOL_FAILED',
    tool,
    requestId,
    error: classified.message,
    reason: classified.reason,
    ...(classified.details ? { details: classified.details } : {}),
  };
}
