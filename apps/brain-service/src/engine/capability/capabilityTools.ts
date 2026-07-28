/**
 * MigraAI Engine — the tool gate: authority enforced at EXECUTION, not at advertisement.
 *
 * The engineer loop already advertised a narrowed tool list, and that is not enforcement.
 * `executeToolCore` validates that a tool exists, is available and is approved — it never
 * checked the tool against the list this turn was actually shown. So a model that named an
 * unadvertised tool reached the executor anyway, and "we withheld it from the prompt" is a
 * hope rather than a boundary.
 *
 * This gate closes that. Every tool call passes {@link ToolGate.permit} before the
 * executor sees it, and the gate cannot answer until it has been opened with a
 * {@link CapabilityDecision}. That ordering is structural, not a comment: a route that
 * assembled tools before resolving authority would throw rather than silently expose them.
 */

import {
  toolClassPermitted,
  type CapabilityAuthority,
  type CapabilityDecision,
  type ToolAuthorityClass,
} from '@migrapilot/protocol';

/**
 * Tool ids whose consequence exceeds their `readOnly` flag.
 *
 * Classified by CONSEQUENCE rather than by matching ids, so a newly registered tool falls
 * into a class by default instead of escaping an allowlist nobody updated. The default for
 * a non-read-only tool is `mutation`, which is the cautious direction.
 */
const APPROVAL_TOOLS = new Set(['edit.approve', 'changeset.approve', 'approval.grant', 'proposal.approve']);
const PRODUCTION_TOOLS = new Set(['deploy.run', 'deploy.apply', 'release.publish', 'production.mutate', 'merge.perform']);

/**
 * Classify a tool.
 *
 * `readOnly` comes from the registry, which is the authority on whether a tool writes.
 * The two sets above catch the cases where writing is not the point — approving someone
 * else's change and shipping to production are consequential in ways a write flag does not
 * capture.
 */
export function classifyTool(toolId: string, readOnly: boolean): ToolAuthorityClass {
  if (PRODUCTION_TOOLS.has(toolId)) return 'production';
  if (APPROVAL_TOOLS.has(toolId)) return 'approval';
  if (/^(deploy|release|production)\./.test(toolId)) return 'production';
  if (/\.(approve|certify|signoff)$/.test(toolId)) return 'approval';
  return readOnly ? 'read-only' : 'mutation';
}

export class ToolGateNotOpenError extends Error {
  override readonly name = 'ToolGateNotOpenError';
  constructor(toolId: string) {
    super(
      `tool gate consulted for "${toolId}" before capability authority was resolved — ` +
        'authority must be decided before any tool is derived or exposed',
    );
  }
}

/** Refused by the gate. Distinct from a tool that failed or does not exist. */
export class ToolNotPermittedError extends Error {
  override readonly name = 'ToolNotPermittedError';
  constructor(
    readonly toolId: string,
    readonly toolClass: ToolAuthorityClass,
    readonly authority: CapabilityAuthority,
  ) {
    super(`CAPABILITY_TOOL_DENIED: ${toolId} is ${toolClass}, which ${authority} authority may not use`);
  }
}

/**
 * A sealed gate that only answers once authority is known.
 *
 * Sealed-by-default is the whole design. An unopened gate that returned `true` would make
 * the ordering invariant depend on nobody reordering two lines; an unopened gate that
 * returned `false` would silently strip every tool and look like a model that chose not to
 * use any. Throwing is the only outcome that cannot be mistaken for correct behaviour.
 */
export class ToolGate {
  private decision: CapabilityDecision | undefined;
  /** Every id the gate was asked about, in order — for structural assertions. */
  readonly consulted: string[] = [];

  open(decision: CapabilityDecision): this {
    this.decision = decision;
    return this;
  }

  get isOpen(): boolean {
    return this.decision !== undefined;
  }

  get authority(): CapabilityAuthority {
    if (!this.decision) throw new ToolGateNotOpenError('(authority)');
    return this.decision.authority;
  }

  /** May this tool be used at all? Throws when consulted before authority is resolved. */
  permit(toolId: string, readOnly: boolean): boolean {
    if (!this.decision) throw new ToolGateNotOpenError(toolId);
    this.consulted.push(toolId);
    return toolClassPermitted(this.decision.authority, classifyTool(toolId, readOnly));
  }

  /** Assert permission, or throw the refusal the loop reports back to the model. */
  assertPermitted(toolId: string, readOnly: boolean): void {
    if (!this.decision) throw new ToolGateNotOpenError(toolId);
    const cls = classifyTool(toolId, readOnly);
    if (!toolClassPermitted(this.decision.authority, cls)) {
      throw new ToolNotPermittedError(toolId, cls, this.decision.authority);
    }
  }
}

/**
 * Filter a candidate tool list down to what this authority may actually use.
 *
 * Takes the GATE rather than the decision, so advertisement and execution are filtered by
 * one object with one state. Deriving the advertised list from a different source than the
 * execution check is how the two drift apart.
 */
export function permittedTools<T extends { id: string; readOnly: boolean }>(gate: ToolGate, candidates: readonly T[]): T[] {
  return candidates.filter((t) => gate.permit(t.id, t.readOnly));
}

/** Counts by class, for the audit — never the tool ids a turn happened to be shown. */
export function toolAuthoritySummary<T extends { id: string; readOnly: boolean }>(
  candidates: readonly T[],
): Record<ToolAuthorityClass, number> {
  const out: Record<ToolAuthorityClass, number> = { 'read-only': 0, mutation: 0, approval: 0, production: 0 };
  for (const t of candidates) out[classifyTool(t.id, t.readOnly)] += 1;
  return out;
}
