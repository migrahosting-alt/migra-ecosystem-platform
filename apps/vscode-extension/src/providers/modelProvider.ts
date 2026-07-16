// Provider-neutral model interface (P7). The extension talks to models only
// through this contract; concrete providers (deterministic stub, OpenAI-compatible,
// …) implement it. vscode-free so providers are unit-testable against mock
// servers. Provider failures map into the existing correlated PilotError taxonomy.

export type ProviderRole = 'system' | 'user' | 'assistant';

export interface ProviderMessage {
  role: ProviderRole;
  content: string;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  model?: string;
  maxTokens?: number;
  /** Correlation id — sent to the provider and carried into any PilotError. */
  requestId: string;
}

export interface ProviderUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  resetSeconds?: number;
}

export type ProviderChunk =
  | { type: 'token'; text: string }
  | { type: 'usage'; usage: ProviderUsage; rateLimit?: RateLimitInfo }
  | { type: 'done' };

export interface ProviderCapabilities {
  providerId: string;
  model: string;
  streaming: boolean;
  supportsCancellation: boolean;
}

export interface ModelProvider {
  readonly id: string;
  /** Non-secret identity for diagnostics — never includes credentials. */
  capabilities(): ProviderCapabilities;
  stream(req: ProviderRequest, signal?: AbortSignal): AsyncGenerator<ProviderChunk>;
}
