// Intent → capability mapping for the MigraAI Engine chat path.
//
// vscode-free so it is unit-testable under plain `node --test`. The extension
// describes WHAT a turn needs (coding / vision / reasoning / size tier) and NEVER
// names a concrete model — model selection + failover belong to the engine.

import type { ChatAttachment, FeatureName } from '@migrapilot/shared-types';
import type { AiChatRequest } from '../services/migraAiClient.js';

/** The model tiers/profiles a user can request from the chat UI. */
export type SelectableProfile = 'cheap' | 'default' | 'premium';

const IMAGE_MIME = /^image\//i;

/** Map the UI model-profile hint to an engine size tier. Undefined lets the
 * engine derive the tier from the feature. */
export function profileToTier(profile: SelectableProfile | undefined): AiChatRequest['tier'] | undefined {
  switch (profile) {
    case 'cheap':
      return 'fast';
    case 'default':
      return 'balanced';
    case 'premium':
      return 'deep';
    default:
      return undefined;
  }
}

/** True when any attachment is an image — the engine will require a vision model
 * for the turn (still without the extension naming one). */
export function turnNeedsVision(attachments: ChatAttachment[] | undefined): boolean {
  return (attachments ?? []).some((a) => IMAGE_MIME.test(a.mimeType));
}

export interface TurnContext {
  feature: FeatureName;
  modelProfile?: SelectableProfile;
  attachments?: ChatAttachment[];
  selectionText?: string;
  activeFile?: string;
  workspaceRoot?: string;
  conversationSummary?: string;
}

/** Translate an extension chat turn into an engine capability spec.
 *
 * Intent → capability:
 *  - normal chat            → chat (no extra flags)
 *  - code explanation/fix/… → chat + coding (`preferCoding`)
 *  - image-aware request    → chat + vision (engine infers from `attachments`)
 *  - deeper reasoning (deep tier) → chat + reasoning (`needsReasoning`)
 *
 * The result NEVER carries a concrete `model` — the engine chooses. */
export function buildAiRequest(prompt: string, ctx: TurnContext): AiChatRequest {
  const tier = profileToTier(ctx.modelProfile);
  return {
    prompt,
    ...(ctx.attachments?.length ? { attachments: ctx.attachments } : {}),
    feature: ctx.feature,
    profile: ctx.modelProfile,
    tier,
    preferCoding:
      ctx.feature === 'explain' || ctx.feature === 'fix' || ctx.feature === 'review' || ctx.feature === 'test',
    needsReasoning: tier === 'deep',
    ...(ctx.selectionText ? { selectionText: ctx.selectionText } : {}),
    ...(ctx.activeFile ? { activeFile: ctx.activeFile } : {}),
    ...(ctx.workspaceRoot ? { workspaceRoot: ctx.workspaceRoot } : {}),
    ...(ctx.conversationSummary ? { conversationSummary: ctx.conversationSummary } : {}),
  };
}
