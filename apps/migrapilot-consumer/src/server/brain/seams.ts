import 'server-only'

import { callBrain, streamBrain, type BrainResult, type BrainStream, type GatewayDeps } from './gateway'
import type { GroundingMode } from './operations'
import type {
  ConversationMessage,
  ConversationSummary,
  CodingRunSnapshot,
  GovernedCodingCapability,
} from './contracts'

/**
 * Typed integration seams for Phase 1.
 *
 * These exist so the later feature work has a server-side surface to call. They
 * are NOT wired to any screen in Step 0 — no page imports them yet, by design.
 *
 * Every function is server-only and goes through `callBrain`, so all three
 * boundary properties (authenticated, server-derived scope, closed operation
 * set) hold automatically.
 */

// ── Conversations & history ────────────────────────────────────────────────

export function listConversations(
  deps?: GatewayDeps,
): Promise<BrainResult<{ conversations: ConversationSummary[] }>> {
  return callBrain({ kind: 'listConversations' }, deps)
}

export function createConversation(
  title?: string,
  deps?: GatewayDeps,
): Promise<BrainResult<ConversationSummary>> {
  return callBrain({ kind: 'createConversation', title, memoryMode: 'durable' }, deps)
}

export function listMessages(
  conversationId: string,
  deps?: GatewayDeps,
): Promise<BrainResult<{ messages: ConversationMessage[] }>> {
  return callBrain({ kind: 'listMessages', conversationId }, deps)
}

export function appendMessage(
  conversationId: string,
  role: ConversationMessage['role'],
  content: string,
  deps?: GatewayDeps,
): Promise<BrainResult<ConversationMessage>> {
  return callBrain({ kind: 'appendMessage', conversationId, role, content }, deps)
}

// ── Turns ──────────────────────────────────────────────────────────────────

/**
 * A chat turn. Note the Brain does NOT persist this — the caller is responsible
 * for appending both the user and assistant messages to the conversation.
 */
export function chatTurn(
  prompt: string,
  conversationSummary?: string,
  deps?: GatewayDeps,
): Promise<BrainResult<unknown>> {
  return callBrain({ kind: 'chatTurn', prompt, conversationSummary }, deps)
}

/**
 * The same chat turn, streamed.
 *
 * The Brain emits `context`, `route`, `token`, `done` and `error` frames over
 * SSE, and commits the assistant message to its own memory ONLY on a completed
 * stream — never on a partial, cancelled or failed one. Callers must mirror
 * that: an interrupted stream has no answer to persist.
 */
export function chatTurnStream(
  prompt: string,
  options: { conversationSummary?: string; groundingMode?: GroundingMode } = {},
  deps?: GatewayDeps,
): Promise<BrainStream> {
  return streamBrain(
    {
      kind: 'chatTurn',
      prompt,
      ...(options.conversationSummary ? { conversationSummary: options.conversationSummary } : {}),
      ...(options.groundingMode ? { groundingMode: options.groundingMode } : {}),
      stream: true,
    },
    deps,
  )
}

/** The grounded, cited answer path. Streaming is a later addition. */
export function groundedAnswer(
  prompt: string,
  tier: 'local' | 'cloud' = 'local',
  deps?: GatewayDeps,
): Promise<BrainResult<unknown>> {
  return callBrain({ kind: 'answer', prompt, tier }, deps)
}

// ── Governed coding: OBSERVATION ONLY ──────────────────────────────────────

/**
 * Capability is authority. `/api/ai/coding/capability` stays mounted even when
 * the feature is off, so "unavailable" and "not found" remain distinguishable.
 * UI must gate on `available` AND `workspaceRootsConfigured > 0`.
 */
export function codingCapability(
  deps?: GatewayDeps,
): Promise<BrainResult<{ governedCoding: GovernedCodingCapability }>> {
  return callBrain({ kind: 'codingCapability' }, deps)
}

/**
 * Read a durable run snapshot.
 *
 * Observation only: there is intentionally no `startCodingRun`,
 * `submitScopeDecision`, or `cancelCodingRun` seam. Starting a run requires a
 * `workspaceRoot` the browser does not have, and fabricating one would weaken
 * the filesystem governance contract. Runs are started by the VS Code
 * extension; the consumer watches them.
 */
export function getCodingRun(
  runId: string,
  deps?: GatewayDeps,
): Promise<BrainResult<CodingRunSnapshot>> {
  return callBrain({ kind: 'getCodingRun', runId }, deps)
}
