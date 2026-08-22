/**
 * The composer's capability contract.
 *
 * THE INVARIANT: the consumer never independently decides that Camera, Vision,
 * Audio, Research or anything else is ready. It RENDERS a snapshot the Brain
 * produced. A client that infers readiness has invented a capability claim, and
 * this product has already shipped one of those — a `.png` accepted by a text
 * model, which looked like vision and was not.
 *
 * The Action Hub is a PROJECTION of this contract, never a parallel hardcoded
 * menu. If a capability is not in the snapshot, it does not appear.
 */

export type ComposerCapabilityId =
  | 'chat'
  | 'files.upload'
  | 'files.library'
  | 'vision.image'
  | 'vision.camera'
  | 'audio.transcribe'
  | 'image.generate'
  | 'video.generate'
  | 'web.search'
  | 'web.research'
  | 'gmail'
  | 'calendar'
  | 'drive'
  | 'github'
  | 'automation';

export type CapabilityAvailability =
  | 'ready'
  | 'unavailable'
  | 'requires_auth'
  | 'requires_connection'
  | 'quota_exhausted';

export interface ComposerCapability {
  id: ComposerCapabilityId;
  availability: CapabilityAvailability;

  /**
   * Human-facing reason ONLY when the capability cannot currently execute.
   *
   * Never invent readiness from client assumptions. A `ready` capability carries
   * no reason; an unavailable one without a reason is a bug, because the user is
   * then told a thing is off with no way to know why.
   */
  reason?: string;

  authenticatedOnly: boolean;

  limits?: {
    maxFiles?: number;
    maxBytes?: number;
    acceptedMimeTypes?: string[];
  };
}

export interface ComposerCapabilitySnapshot {
  version: 1;
  generatedAt: string;
  capabilities: ComposerCapability[];
}

/**
 * What the Action Hub shows.
 *
 * A capability that is unavailable AND carries a reason is still shown — the
 * user learns it exists and why it is off, which is the honest state. A
 * capability that is unavailable with NO reason is deliberately omitted: that is
 * how the snapshot says "this product does not have this at all", and rendering
 * it would be a decorative card for something that does not exist.
 */
export function visibleComposerActions(
  snapshot: ComposerCapabilitySnapshot,
): ComposerCapability[] {
  return snapshot.capabilities.filter((capability) => {
    // We may deliberately omit truly unsupported functionality.
    return capability.availability !== 'unavailable' || Boolean(capability.reason);
  });
}

/* ── Execution envelope ──────────────────────────────────────────────────── */

/**
 * One envelope for every composer-triggered operation.
 *
 * Each new capability adds a VARIANT here, never a differently-shaped route.
 * The chain is the same for all of them: contract → consumer validation, auth
 * and quota → Brain capability authorization → executor → canonical artifact →
 * conversation persistence → reload.
 */
export type ComposerAction =
  | { type: 'chat.message'; text: string }
  | { type: 'files.attach'; fileIds: string[] }
  | { type: 'vision.ask'; assetIds: string[]; text: string }
  | { type: 'audio.transcribe'; assetId: string }
  | { type: 'web.search'; query: string };

export interface ComposerActionRequest {
  conversationId: string;
  action: ComposerAction;

  /**
   * Protect every user-triggered operation against accidental replay.
   *
   * A refresh, a retry or a double-click must not produce two turns, two
   * charges, or two quota decrements.
   */
  idempotencyKey: string;
}

/* ── Conversation assets ─────────────────────────────────────────────────── */

export type ConversationAssetState =
  | 'uploading'
  | 'processing'
  | 'ready'
  | 'unreadable'
  | 'failed';

export interface ConversationAsset {
  id: string;
  name: string;
  mimeType: string;
  state: ConversationAssetState;

  /**
   * Attachment to this conversation is separate from existence in the user's
   * library.
   *
   * This is the distinction one trash icon has been overloading: "remove from
   * this conversation" and "delete from my library" are different operations
   * with different blast radii, and conflating them destroys a document the user
   * only wanted to unattach.
   */
  attachedToConversation: boolean;

  capability?: 'document' | 'vision' | 'audio' | 'video';

  reason?: string;
}

/* ── Composer state ──────────────────────────────────────────────────────── */

/**
 * One explicit state, rather than fifteen booleans that can contradict each
 * other. `uploading && streaming && blocked` is not representable here.
 */
export type ComposerState =
  | { kind: 'idle' }
  | { kind: 'uploading'; count: number }
  | { kind: 'recording'; startedAt: number }
  | { kind: 'transcribing' }
  | { kind: 'sending' }
  | { kind: 'streaming' }
  | {
      kind: 'blocked';
      reason:
        | 'anonymous_quota'
        | 'auth_required'
        | 'capability_unavailable'
        | 'persistence_unavailable';
      message: string;
    };

/**
 * The single send decision.
 *
 * Every component asks this rather than deciding for itself what Send means —
 * that divergence is how a disabled-looking button stays clickable.
 */
export function canSubmitComposer(input: {
  state: ComposerState;
  text: string;
  readyAssets: number;
}): boolean {
  if (input.state.kind !== 'idle') return false;

  return input.text.trim().length > 0 || input.readyAssets > 0;
}
