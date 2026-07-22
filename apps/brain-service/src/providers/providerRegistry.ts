import type { ChatTurnRequest, ChatTurnResponse, ModelProfile } from '@migrapilot/shared-types';
import type { BrainEnv } from '../config/env.js';
import { OpenAiCompatProvider } from './openAiCompatProvider.js';

export interface ProviderAdapter {
  profile: Exclude<ModelProfile, 'none'>;
  isAvailable(): Promise<boolean>;
  complete(request: ChatTurnRequest): Promise<ChatTurnResponse>;
  stream?(
    request: ChatTurnRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<{ delta?: string; usage?: { inputTokens: number; outputTokens: number } }>;
}

type Profile = Exclude<ModelProfile, 'none'>;

export class StubProvider implements ProviderAdapter {
  constructor(public readonly profile: Exclude<ModelProfile, 'none'>) {}

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async complete(request: ChatTurnRequest): Promise<ChatTurnResponse> {
    // Engineer-protocol turns get a deterministic protocol-compliant reply so
    // the loop is integration-testable without a real model: first turn reads a
    // file, subsequent turns finalize.
    // Detect the PROTOCOL, not the persona wording — the agent's system prompt
    // is edited often, and keying off its opening line silently broke this stub.
    const isEngineer = request.userPrompt.includes('{"action":{"tool"');
    const content = isEngineer
      ? request.userPrompt.includes('Result of ') || request.userPrompt.includes('FAILED')
        ? '{"final":"Stub engineer inspected the workspace and finished."}'
        : '{"action":{"tool":"git.status","input":{}}}'
      : [
          `Stub provider response for profile: ${this.profile}.`,
          `Feature: ${request.feature}.`,
          'Wire a real model provider here next.',
        ].join(' ');

    return {
      modelProfile: this.profile,
      content,
      citations: request.context.activeFile
        ? [{ path: request.context.activeFile, startLine: 1, endLine: 20 }]
        : [],
      proposedEdits: [],
      telemetry: {
        inputTokens: Math.ceil(request.userPrompt.length / 4),
        outputTokens: Math.ceil(content.length / 4),
        latencyMs: 20,
        cacheHit: false,
      },
    };
  }

  /** Deterministic progressive stream used by the controlled local foundation.
   * The event-loop yield between chunks makes cancellation observable without
   * adding nondeterministic wall-clock sleeps. No network provider is consulted. */
  async *stream(
    request: ChatTurnRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<{ delta?: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const result = await this.complete(request);
    const words = result.content.split(' ');
    for (let i = 0; i < words.length; i += 1) {
      throwIfAborted(signal);
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      throwIfAborted(signal);
      yield { delta: `${words[i]}${i === words.length - 1 ? '' : ' '}` };
    }
    yield {
      usage: {
        inputTokens: result.telemetry.inputTokens,
        outputTokens: result.telemetry.outputTokens,
      },
    };
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const error = new Error('Stub generation cancelled.');
  error.name = 'AbortError';
  throw error;
}

export class ProviderRegistry {
  private readonly providers = new Map<Profile, ProviderAdapter>();

  /** Build the per-profile provider table. When `env.localProvider` is
   * 'openai-compat' AND a model is configured for a profile, that profile uses a
   * real OpenAI-compatible adapter; every other profile falls back to the
   * deterministic stub. This keeps stub the safe default per-profile — a partial
   * config never silently disables a profile, and no env at all stays all-stub. */
  constructor(env?: BrainEnv) {
    for (const profile of ['local', 'cheap', 'default', 'premium'] as const) {
      this.providers.set(profile, this.buildProvider(profile, env));
    }
  }

  private buildProvider(profile: Profile, env?: BrainEnv): ProviderAdapter {
    if (env && env.localProvider === 'openai-compat') {
      const model = modelForProfile(profile, env);
      if (model) {
        return new OpenAiCompatProvider({
          profile,
          baseUrl: env.providerBaseUrl,
          model,
          visionModel: env.visionModel,
          apiKey: env.openAiApiKey,
        });
      }
    }
    return new StubProvider(profile);
  }

  get(profile: Profile): ProviderAdapter {
    const provider = this.providers.get(profile);
    if (!provider) {
      throw new Error(`No provider registered for profile: ${profile}`);
    }
    return provider;
  }
}

/** Resolve the configured model name for a profile. `local` falls back to the
 * cheap model when no dedicated local model is set, so a single MIGRAPILOT_CHEAP_MODEL
 * makes both the local and cheap profiles real. */
function modelForProfile(profile: Profile, env: BrainEnv): string | undefined {
  switch (profile) {
    case 'local':
      return env.localModel ?? env.cheapModel;
    case 'cheap':
      return env.cheapModel;
    case 'default':
      return env.defaultModel;
    case 'premium':
      return env.premiumModel;
  }
}
