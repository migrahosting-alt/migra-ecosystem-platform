import type { ChatTurnRequest } from '@migrapilot/shared-types';
import { BrainClient } from './brainClient.js';
import { type LocalChatBackend, type LocalChatResult } from './backendRouter.js';

/**
 * The BackendRouter's LOCAL chat backend, backed by the canonical Brain.
 *
 * This replaces `ProviderLocalChatBackend`, which called an OpenAI-compatible
 * endpoint directly from the extension. That was the router's "local-brain"
 * mode reaching a model without passing through Brain routing, grounding, tool
 * policy or audit — the name said Brain and the code said Ollama.
 *
 * In practice the local branch is not currently reached: every caller of
 * `router.chat` passes `local: null` and takes `streamLocalEngine` (Brain) for
 * local mode instead. It is implemented over the Brain regardless, so that the
 * dormant path cannot become a bypass the day something starts using it.
 */
export class BrainLocalChatBackend implements LocalChatBackend {
  constructor(private readonly brain: () => BrainClient) {}

  async chat(request: unknown, signal?: AbortSignal): Promise<LocalChatResult> {
    const payload = request as ChatTurnRequest | null;
    if (!payload) {
      // Fail closed and say why. Never substitute a direct model call.
      throw new Error('local chat backend received no Brain request payload');
    }
    const response = await this.brain().chat(payload, signal);
    return {
      content: response.content,
      citations: response.citations?.map((c) => ({
        path: c.path,
        startLine: c.startLine,
        endLine: c.endLine,
      })),
    };
  }
}
