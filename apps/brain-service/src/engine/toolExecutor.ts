/**
 * MigraAI Engine — shared tool-execution core.
 *
 * The single validated dispatch path for a capability execution. Both the public
 * `/api/ai/tools` route AND the agent runtime call this, so an agent's tool calls
 * go through the exact same validation, availability check, approval lifecycle,
 * and audit as a direct client call — no bypass boundary.
 */

import { CapabilityRegistry } from './capabilityRegistry.js';
import { ToolApprovalStore, hashInput } from './toolApprovalStore.js';
import { ToolAudit } from './toolAudit.js';
import { NOOP_STAGE_LOGGER, type StageLogger } from './correlation.js';
import { auditStore, type AuditEventType } from './auditLog.js';

export interface ToolExecInput {
  tool?: string;
  input?: unknown;
  dryRun?: boolean;
  approvalId?: string;
  requestId: string;
  /** Optional per-call correlation logger — emits approval/apply stage lines
   * (metadata only). Absent for uncorrelated direct calls. */
  stage?: StageLogger;
}

/** Discriminated execution outcome. `httpStatus` lets the HTTP route map 1:1;
 * the agent runtime switches on `status`/`code`. */
export type ToolExecOutcome =
  | { ok: true; httpStatus: 200; status: 'ok' | 'dry_run' | 'approval_required' | 'executed'; tool: string; requestId: string; result?: unknown; preview?: unknown; approvalId?: string; expiresAt?: number }
  | { ok: false; httpStatus: number; code: string; tool: string; requestId: string; error: string; issues?: Array<{ path: string; message: string }>; requiredCapabilities?: string[]; reason?: string };

export interface ToolExecDeps {
  registry: CapabilityRegistry;
  approvals: ToolApprovalStore;
  audit: ToolAudit;
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
    try {
      auditStore.append({ correlationId: cid, type, component: 'tool-executor', outcome, requestId, fields: { tool: toolId, ...fields } });
    } catch {
      /* tool.* is non-critical; never break execution */
    }
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
  if (!registry.isAvailable(toolId)) {
    audit.record({ requestId, tool: toolId, action: 'denied', readOnly: runnable.descriptor.readOnly, outcome: 'refused' });
    recordAudit('tool.denied', 'refused');
    return { ok: false, httpStatus: 403, code: 'CAPABILITY_DENIED', tool: toolId, requestId, error: `Capability not available: ${toolId}`, requiredCapabilities: runnable.descriptor.requiredCapabilities };
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
      const result = await runnable.handler(input, { correlationId: stage.correlationId });
      audit.record({ requestId, tool: toolId, action: 'executed', readOnly: true, outcome: 'ok' });
      recordAudit('tool.completed', 'ok', { readOnly: true });
      return { ok: true, httpStatus: 200, status: 'ok', tool: toolId, requestId, result };
    } catch (error) {
      return failWith(true, error);
    }
  }

  // Mutating-class tools that DECLARE approvalRequired: false (e.g. command.run,
  // whose own policy layer — allowlist/containment/kill-switch — is the control)
  // execute immediately, exactly as the catalog advertises. Approval remains
  // mandatory for every tool that declares it (edit.apply).
  if (runnable.descriptor.approvalRequired === false) {
    try {
      const result = await runnable.handler(input, { correlationId: stage.correlationId });
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
    const record = approvals.mint({ tool: toolId, inputHash, requestId, correlationId: stage.correlationId });
    audit.record({ requestId, tool: toolId, action: 'approval_required', readOnly: false, approvalId: record.id, outcome: 'ok' });
    // Correlation: approval MINTED (metadata only — never the token).
    stage.log('approval', { tool: toolId, status: 'required' });
    return { ok: true, httpStatus: 200, status: 'approval_required', tool: toolId, requestId, approvalId: record.id, expiresAt: record.expiresAt, preview };
  }

  // approvalId present → single-use, bound consume → execute
  const consumed = approvals.consume(req.approvalId, { tool: toolId, inputHash, correlationId: stage.correlationId });
  if (!consumed.ok) {
    audit.record({ requestId, tool: toolId, action: 'replay_refused', readOnly: false, approvalId: req.approvalId, outcome: 'refused' });
    stage.log('approval', { tool: toolId, status: 'refused', reason: consumed.reason });
    return { ok: false, httpStatus: 409, code: 'INVALID_STATE', tool: toolId, requestId, error: `Approval ${consumed.reason}.`, reason: consumed.reason };
  }
  try {
    const applyStarted = Date.now();
    const result = await runnable.handler(input, { correlationId: stage.correlationId });
    audit.record({ requestId, tool: toolId, action: 'executed', readOnly: false, approvalId: req.approvalId, outcome: 'ok' });
    recordAudit('tool.completed', 'ok', { approved: true });
    // Correlation: approved APPLY executed.
    stage.log('apply', { tool: toolId, durationMs: Date.now() - applyStarted, outcome: 'ok' });
    return { ok: true, httpStatus: 200, status: 'executed', tool: toolId, requestId, result, approvalId: req.approvalId };
  } catch (error) {
    return failWith(false, error);
  }
}

function failed(audit: ToolAudit, requestId: string, tool: string, readOnly: boolean, _error: unknown): ToolExecOutcome {
  // Detail is logged by the caller/route; the client-facing error is generic.
  audit.record({ requestId, tool, action: 'tool_failed', readOnly, outcome: 'error' });
  return { ok: false, httpStatus: 502, code: 'TOOL_FAILED', tool, requestId, error: 'The tool could not complete.' };
}
