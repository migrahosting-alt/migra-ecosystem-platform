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

export interface ToolExecInput {
  tool?: string;
  input?: unknown;
  dryRun?: boolean;
  approvalId?: string;
  requestId: string;
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
  const toolId = req.tool;

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
    return { ok: false, httpStatus: 403, code: 'CAPABILITY_DENIED', tool: toolId, requestId, error: `Capability not available: ${toolId}`, requiredCapabilities: runnable.descriptor.requiredCapabilities };
  }

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
      const result = await runnable.handler(input);
      audit.record({ requestId, tool: toolId, action: 'executed', readOnly: true, outcome: 'ok' });
      return { ok: true, httpStatus: 200, status: 'ok', tool: toolId, requestId, result };
    } catch (error) {
      return failed(audit, requestId, toolId, true, error);
    }
  }

  const inputHash = hashInput(input);

  if (req.dryRun) {
    try {
      const preview = runnable.preview ? await runnable.preview(input) : null;
      audit.record({ requestId, tool: toolId, action: 'dry_run', readOnly: false, outcome: 'ok' });
      return { ok: true, httpStatus: 200, status: 'dry_run', tool: toolId, requestId, preview };
    } catch (error) {
      return failed(audit, requestId, toolId, false, error);
    }
  }

  if (!req.approvalId) {
    let preview: unknown = null;
    try {
      preview = runnable.preview ? await runnable.preview(input) : null;
    } catch (error) {
      return failed(audit, requestId, toolId, false, error);
    }
    const record = approvals.mint({ tool: toolId, inputHash, requestId });
    audit.record({ requestId, tool: toolId, action: 'approval_required', readOnly: false, approvalId: record.id, outcome: 'ok' });
    return { ok: true, httpStatus: 200, status: 'approval_required', tool: toolId, requestId, approvalId: record.id, expiresAt: record.expiresAt, preview };
  }

  // approvalId present → single-use, bound consume → execute
  const consumed = approvals.consume(req.approvalId, { tool: toolId, inputHash });
  if (!consumed.ok) {
    audit.record({ requestId, tool: toolId, action: 'replay_refused', readOnly: false, approvalId: req.approvalId, outcome: 'refused' });
    return { ok: false, httpStatus: 409, code: 'INVALID_STATE', tool: toolId, requestId, error: `Approval ${consumed.reason}.`, reason: consumed.reason };
  }
  try {
    const result = await runnable.handler(input);
    audit.record({ requestId, tool: toolId, action: 'executed', readOnly: false, approvalId: req.approvalId, outcome: 'ok' });
    return { ok: true, httpStatus: 200, status: 'executed', tool: toolId, requestId, result, approvalId: req.approvalId };
  } catch (error) {
    return failed(audit, requestId, toolId, false, error);
  }
}

function failed(audit: ToolAudit, requestId: string, tool: string, readOnly: boolean, _error: unknown): ToolExecOutcome {
  // Detail is logged by the caller/route; the client-facing error is generic.
  audit.record({ requestId, tool, action: 'tool_failed', readOnly, outcome: 'error' });
  return { ok: false, httpStatus: 502, code: 'TOOL_FAILED', tool, requestId, error: 'The tool could not complete.' };
}
