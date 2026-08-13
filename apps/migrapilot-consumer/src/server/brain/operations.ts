/**
 * The closed set of Brain operations this application may perform.
 *
 * The gateway takes an operation from this union — never a path. That is what
 * makes arbitrary proxying structurally impossible: there is no code path from
 * a browser-supplied string to a Brain URL.
 *
 * Governed coding is deliberately READ-ONLY here. Phase 1's product decision is
 * that the browser observes durable runs started by an authorized,
 * workspace-bearing surface (the VS Code extension). `POST /coding/runs`,
 * `/scope-decision` and `/cancel` are therefore absent by design — a browser
 * has no `workspaceRoot`, and inventing one would weaken the filesystem
 * governance contract.
 */

export type MessageRole = 'user' | 'assistant' | 'system'

export type BrainOperation =
  // ── conversations ────────────────────────────────────────────────────────
  | { kind: 'listConversations' }
  | { kind: 'createConversation'; title?: string; memoryMode?: 'off' | 'session' | 'durable' }
  | { kind: 'getConversation'; conversationId: string }
  | { kind: 'renameConversation'; conversationId: string; title: string }
  | { kind: 'deleteConversation'; conversationId: string }
  | { kind: 'listMessages'; conversationId: string }
  | { kind: 'appendMessage'; conversationId: string; role: MessageRole; content: string }
  // ── turns ────────────────────────────────────────────────────────────────
  | { kind: 'chatTurn'; prompt: string; conversationSummary?: string }
  | { kind: 'answer'; prompt: string; tier?: 'local' | 'cloud' }
  // ── governed coding (observation only) ───────────────────────────────────
  | { kind: 'codingCapability' }
  | { kind: 'getCodingRun'; runId: string }

export interface ResolvedRequest {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  body?: unknown
}

/**
 * Path segments are validated, not escaped-and-hoped. A conversation or run id
 * containing `/`, `..`, or a query character would otherwise let a caller reach
 * a different Brain route through an id field.
 */
const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/

export class InvalidOperationError extends Error {
  readonly code = 'INVALID_OPERATION'
  constructor(message: string) {
    super(message)
    this.name = 'InvalidOperationError'
  }
}

function id(value: string, label: string): string {
  if (typeof value !== 'string' || !SAFE_ID.test(value)) {
    throw new InvalidOperationError(`${label} is not a valid identifier.`)
  }
  return value
}

function text(value: string, label: string, max = 32_000): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InvalidOperationError(`${label} must be a non-empty string.`)
  }
  if (value.length > max) throw new InvalidOperationError(`${label} exceeds ${max} characters.`)
  return value
}

/** Map an operation to a concrete Brain request. The only path constructor. */
export function resolveOperation(op: BrainOperation): ResolvedRequest {
  switch (op.kind) {
    case 'listConversations':
      return { method: 'GET', path: '/api/ai/conversations' }

    case 'createConversation':
      return {
        method: 'POST',
        path: '/api/ai/conversations',
        // Durable by default: the consumer's whole point is reload persistence.
        body: { title: op.title, memoryMode: op.memoryMode ?? 'durable' },
      }

    case 'getConversation':
      return { method: 'GET', path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}` }

    case 'renameConversation':
      return {
        method: 'PATCH',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}`,
        body: { title: text(op.title, 'title', 400) },
      }

    case 'deleteConversation':
      return {
        method: 'DELETE',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}`,
      }

    case 'listMessages':
      return {
        method: 'GET',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}/messages`,
      }

    case 'appendMessage':
      return {
        method: 'POST',
        path: `/api/ai/conversations/${id(op.conversationId, 'conversationId')}/messages`,
        body: { role: op.role, content: text(op.content, 'content') },
      }

    case 'chatTurn':
      return {
        method: 'POST',
        path: '/api/ai/chat',
        body: {
          prompt: text(op.prompt, 'prompt'),
          ...(op.conversationSummary ? { conversationSummary: op.conversationSummary } : {}),
        },
      }

    case 'answer':
      return {
        method: 'POST',
        path: '/api/ai/answer',
        // `workspaceRoot` is deliberately never sent: the consumer server has no
        // workspace, and asserting one would be a fiction.
        body: { prompt: text(op.prompt, 'prompt'), tier: op.tier ?? 'local' },
      }

    case 'codingCapability':
      return { method: 'GET', path: '/api/ai/coding/capability' }

    case 'getCodingRun':
      return { method: 'GET', path: `/api/ai/coding/runs/${id(op.runId, 'runId')}` }
  }

  // Unreachable for well-typed callers. Reached at runtime only if an
  // unrecognised operation arrives — which must fail closed here rather than
  // return `undefined` and surface later as a confusing TypeError.
  throw new InvalidOperationError(
    `Unknown Brain operation: ${String((op as { kind?: unknown }).kind)}`,
  )
}
