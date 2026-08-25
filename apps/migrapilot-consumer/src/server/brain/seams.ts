import 'server-only'

import { callBrain, streamBrain, type BrainResult, type BrainStream, type GatewayDeps } from './gateway'
import type { GroundingMode } from './operations'
import type { UserPreferences } from '@migrapilot/shared-types/user-preferences'
import type { AnonymousChatQuota } from '@migrapilot/shared-types/anonymous-quota'
import type {
  ConversationMessage,
  ConversationSummary,
  CodingRunSnapshot,
  GovernedCodingCapability,
} from './contracts'
import type {
  TranscriptionCapability,
  TranscriptionResult,
} from '@migrapilot/shared-types/transcription'

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

/**
 * Rename one conversation.
 *
 * The title is what a person navigates their own history by, and the automatic
 * one is the first line of whatever they happened to type first. Letting them
 * fix it is the difference between a history and a pile.
 */
export function renameConversation(
  conversationId: string,
  title: string,
  deps?: GatewayDeps,
): Promise<BrainResult<ConversationSummary>> {
  return callBrain({ kind: 'renameConversation', conversationId, title }, deps)
}

/**
 * Delete one conversation.
 *
 * The Brain removes the thread and its messages under the caller's scope, so a
 * foreign id deletes nothing and reports not-found — the same answer it gives
 * for an id that never existed, deliberately.
 */
export function deleteConversation(
  conversationId: string,
  deps?: GatewayDeps,
): Promise<BrainResult<unknown>> {
  return callBrain({ kind: 'deleteConversation', conversationId }, deps)
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
  options: {
    conversationSummary?: string
    groundingMode?: GroundingMode
    /**
     * Restrict retrieval to these files.
     *
     * Every layer between the route and the wire re-declares its own shape, so a field
     * added at one end is silently discarded by the next. This one was: the route passed
     * it, the operation type lacked it, and the caller compiled anyway because excess
     * properties are not checked through a spread. Retrieval kept ranking over the whole
     * library while everything looked correct.
     */
    groundingFiles?: string[]
    /**
     * Images already resolved to bytes, in order.
     *
     * Declared HERE as well as on the operation because this file's own history
     * says a field added at one end is silently discarded by the next: excess
     * properties are not checked through a spread, so the omission compiles and
     * the tests pass while the value never reaches the wire.
     */
    imageAttachments?: readonly { name: string; mimeType: string; dataBase64: string; sizeBytes?: number }[]
  } = {},
  deps?: GatewayDeps,
): Promise<BrainStream> {
  return streamBrain(
    {
      kind: 'chatTurn',
      prompt,
      ...(options.conversationSummary ? { conversationSummary: options.conversationSummary } : {}),
      ...(options.groundingMode ? { groundingMode: options.groundingMode } : {}),
      ...(options.groundingFiles && options.groundingFiles.length > 0
        ? { groundingFiles: options.groundingFiles }
        : {}),
      ...(options.imageAttachments && options.imageAttachments.length > 0
        ? { imageAttachments: options.imageAttachments }
        : {}),
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

/** One conversation, including the files it answers from. */
export function getConversation(
  conversationId: string,
  deps?: GatewayDeps,
): Promise<BrainResult<ConversationSummary>> {
  return callBrain({ kind: 'getConversation', conversationId }, deps)
}

/**
 * Replace the files this conversation answers from.
 *
 * Grounding is a property of the CONVERSATION, stored in the Brain — not a flag the
 * browser remembers. It used to live in a React ref, so a reload silently dropped it
 * and the same question started answering "I don't have access to external documents"
 * with the earlier grounded answers still on screen.
 */
/**
 * Replace the conversation's image set.
 *
 * PUT semantics like grounding: the whole set is sent, so a retry or a race
 * cannot leave a thread about a picture nobody chose.
 */
export function setConversationImages(
  conversationId: string,
  images: string[],
  deps?: GatewayDeps,
) {
  return callBrain({ kind: 'setConversationImages', conversationId, images }, deps)
}

export function setConversationGrounding(
  conversationId: string,
  files: string[],
  deps?: GatewayDeps,
): Promise<BrainResult<ConversationSummary>> {
  return callBrain({ kind: 'setConversationGrounding', conversationId, files }, deps)
}

// ── Speech ─────────────────────────────────────────────────────────────────

/**
 * What the Brain can do with speech RIGHT NOW.
 *
 * A microphone may only be enabled when this reports `ready`. The consumer does not know,
 * and must not guess, which ASR runtime is behind it — that is the whole point of routing
 * through the Brain rather than reaching into another app's implementation.
 */
export function transcriptionCapability(
  deps?: GatewayDeps,
): Promise<BrainResult<TranscriptionCapability>> {
  return callBrain({ kind: 'transcriptionCapability' }, deps)
}

/**
 * Transcribe one recording.
 *
 * Returns the SHARED TranscriptionResult — status and warnings included — because a
 * fluent transcript is not proof the ASR heard the user. The safety decision is made once,
 * at the capability layer, and every surface reads the same verdict instead of re-deriving
 * it and drifting.
 *
 * `requestedLanguage` is passed ONLY when the user explicitly chose one.
 */
export function transcribe(
  input: { audioBase64: string; audioMime: string; requestedLanguage?: string },
  deps?: GatewayDeps,
): Promise<BrainResult<TranscriptionResult>> {
  return callBrain(
    {
      kind: 'transcribe',
      audioBase64: input.audioBase64,
      audioMime: input.audioMime,
      ...(input.requestedLanguage ? { requestedLanguage: input.requestedLanguage } : {}),
    },
    deps,
  )
}

// ── Anonymous allowance ────────────────────────────────────────────────────

/**
 * What the visitor has left. A PROJECTION for rendering, never the authority.
 *
 * The authority is `reserveAnonymousTurn`, because only that decides inside the
 * transaction that also records the spend. Rendering from this and deciding
 * from this would be two sources of truth, and they diverge the first time two
 * tabs send at once.
 */
export function anonymousQuota(
  deps?: GatewayDeps,
): Promise<BrainResult<{ ok: boolean; quota: AnonymousChatQuota; claimed: boolean }>> {
  return callBrain({ kind: 'anonymousQuota' }, deps)
}

/**
 * Take one turn's allowance BEFORE inference.
 *
 * A check after generation is not a limit, it is a receipt. Refusal here is the
 * thing that stops the model being called at all, so this must be awaited and
 * its outcome acted on — not fired alongside the turn.
 */
export function reserveAnonymousTurn(
  reservationId: string,
  conversationId?: string,
  deps?: GatewayDeps,
): Promise<
  BrainResult<{
    ok: boolean
    reservation?: { reservationId: string; remainingAfterReservation: number }
    quota: AnonymousChatQuota
  }>
> {
  return callBrain(
    {
      kind: 'reserveAnonymousTurn',
      reservationId,
      ...(conversationId ? { conversationId } : {}),
    },
    deps,
  )
}

/**
 * Close the reservation.
 *
 * `producedOutput` is the pivot, not the HTTP status: a stream that delivered
 * tokens and then failed to persist DID give the user something, and a 200
 * carrying an empty answer did not.
 */
export function settleAnonymousTurn(
  input: { reservationId: string; producedOutput: boolean; failure?: string },
  deps?: GatewayDeps,
): Promise<BrainResult<{ ok: boolean; settlement: 'consume' | 'release'; released?: boolean }>> {
  return callBrain(
    {
      kind: 'settleAnonymousTurn',
      reservationId: input.reservationId,
      producedOutput: input.producedOutput,
      ...(input.failure ? { failure: input.failure } : {}),
    },
    deps,
  )
}

/**
 * Move one anonymous conversation into the account that just signed in.
 *
 * Made AS the account — the deps must carry the SESSION principal, never the
 * anonymous one — with the anonymous side named. Both halves come from one
 * verified cookie, and the Brain re-checks that they agree.
 */
export function claimAnonymousConversation(
  input: { conversationId: string; anonymousSessionId: string; anonymousOwner: string },
  deps?: GatewayDeps,
): Promise<BrainResult<{ ok: boolean; conversationId: string; claimed: boolean }>> {
  return callBrain({ kind: 'claimAnonymousConversation', ...input }, deps)
}

// ── Preferences ────────────────────────────────────────────────────────────

/**
 * How this caller likes MigraPilot to behave.
 *
 * MigraPilot-owned ONLY. Name, email, avatar, linked providers and sessions come
 * from MigraAuth and are never mirrored here.
 */
export function getPreferences(
  deps?: GatewayDeps,
): Promise<BrainResult<{ ok: boolean; preferences: UserPreferences; stored: boolean; updatedAt: number }>> {
  return callBrain({ kind: 'getPreferences' }, deps)
}

/** A partial update. The FULL document comes back, for the client to reconcile against. */
export function patchPreferences(
  patch: Record<string, unknown>,
  deps?: GatewayDeps,
): Promise<BrainResult<{ ok: boolean; preferences: UserPreferences; changed: string[] }>> {
  return callBrain({ kind: 'patchPreferences', patch }, deps)
}

export function preferenceEvents(
  deps?: GatewayDeps,
): Promise<BrainResult<{ ok: boolean; events: { id: string; changedKeys: string[]; createdAt: number }[] }>> {
  return callBrain({ kind: 'preferenceEvents' }, deps)
}
