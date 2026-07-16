import { PilotError } from '@migrapilot/pilot-client';
import {
  type ModelProvider,
  type ProviderCapabilities,
  type ProviderChunk,
  type ProviderRequest,
} from './modelProvider.js';

// Deterministic provider retained ONLY for tests and local-deterministic mode.
// It is never a silent fallback for a configured real provider.
export class StubModelProvider implements ModelProvider {
  readonly id = 'stub';

  constructor(private readonly model = 'deterministic-stub') {}

  capabilities(): ProviderCapabilities {
    return { providerId: this.id, model: this.model, streaming: true, supportsCancellation: true };
  }

  async *stream(req: ProviderRequest, signal?: AbortSignal): AsyncGenerator<ProviderChunk> {
    const prompt = req.messages.at(-1)?.content ?? '';
    const text = `Stub provider response for: ${prompt}`.slice(0, 240);
    const words = text.split(' ');
    for (const word of words) {
      if (signal?.aborted) {
        throw new PilotError('CANCELLED', 'Request cancelled.', { requestId: req.requestId });
      }
      yield { type: 'token', text: `${word} ` };
    }
    yield {
      type: 'usage',
      usage: { promptTokens: prompt.length, completionTokens: words.length, totalTokens: prompt.length + words.length },
    };
    yield { type: 'done' };
  }
}
