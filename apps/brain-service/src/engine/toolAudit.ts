/**
 * MigraAI Engine — tool audit log.
 *
 * A bounded, in-memory ring of every capability-execution decision the engine
 * made, for observability. SANITIZED BY CONSTRUCTION: it records the tool id,
 * the coarse action/outcome, correlation ids, and the approval id — never tool
 * inputs, file contents, prompts, keys, or raw error bodies.
 */

export type AuditAction =
  | 'executed'
  | 'dry_run'
  | 'approval_required'
  | 'denied'
  | 'invalid_input'
  | 'unknown_tool'
  | 'replay_refused'
  | 'tool_failed';

export interface AuditEvent {
  at: number;
  requestId: string;
  tool: string;
  action: AuditAction;
  readOnly: boolean;
  approvalId?: string;
  outcome: 'ok' | 'refused' | 'error';
}

export class ToolAudit {
  private readonly ring: AuditEvent[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly max = 200,
  ) {}

  record(event: Omit<AuditEvent, 'at'>): AuditEvent {
    const full: AuditEvent = { ...event, at: this.now() };
    this.ring.push(full);
    if (this.ring.length > this.max) this.ring.shift();
    return full;
  }

  recent(limit = 50): AuditEvent[] {
    return this.ring.slice(-limit);
  }
}
