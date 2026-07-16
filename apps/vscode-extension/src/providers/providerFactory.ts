import { PilotError } from '@migrapilot/pilot-client';
import { type ModelProvider, type ProviderRequest, type ProviderUsage } from './modelProvider.js';
import { type OpenAiCompatConfig, OpenAiCompatProvider } from './openAiCompatProvider.js';
import { StubModelProvider } from './stubProvider.js';

export type ProviderKind = 'stub' | 'openai-compat';

export interface ProviderSelection {
  kind: ProviderKind;
  openAi?: OpenAiCompatConfig;
  stubModel?: string;
}

/**
 * Build the configured provider. When 'openai-compat' is selected it MUST be
 * configured — this never silently falls back to the stub. The deterministic
 * stub is only produced when 'stub' is explicitly selected (the default).
 */
export function createProvider(selection: ProviderSelection): ModelProvider {
  if (selection.kind === 'openai-compat') {
    if (!selection.openAi) {
      throw new PilotError('CAPABILITY_MISSING', 'openai-compat provider is selected but not configured.');
    }
    return new OpenAiCompatProvider(selection.openAi);
  }
  return new StubModelProvider(selection.stubModel);
}

export interface Completion {
  content: string;
  usage?: ProviderUsage;
  providerId: string;
  model: string;
}

/**
 * Drive a provider stream to a buffered completion. Propagates provider errors
 * as PilotError — a configured real provider that fails is NEVER swapped for the
 * stub. Cancellation/timeout surface from the provider unchanged.
 */
export async function collectCompletion(
  provider: ModelProvider,
  req: ProviderRequest,
  signal?: AbortSignal,
): Promise<Completion> {
  let content = '';
  let usage: ProviderUsage | undefined;
  for await (const chunk of provider.stream(req, signal)) {
    if (chunk.type === 'token') {
      content += chunk.text;
    } else if (chunk.type === 'usage') {
      usage = chunk.usage;
    }
  }
  const caps = provider.capabilities();
  return { content, usage, providerId: caps.providerId, model: caps.model };
}
