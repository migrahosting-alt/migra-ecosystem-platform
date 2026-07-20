import type { ChatTurnRequest, ChatTurnResponse, ModelProfile } from '@migrapilot/shared-types';
import type { ProviderAdapter } from './providerRegistry.js';

export interface OpenAiCompatOptions {
  profile: Exclude<ModelProfile, 'none'>;
  /** Base URL exposing POST /chat/completions (OpenAI, Ollama `/v1`, LM Studio, vLLM, …). */
  baseUrl: string;
  /** Model name sent to the endpoint for this profile. */
  model: string;
  /** Vision-capable model used automatically when a turn carries image
   * attachments (e.g. `llama3.2-vision:11b`, `gpt-4o`). When unset, image
   * attachments are described textually instead of analyzed. */
  visionModel?: string;
  /** Optional bearer key. Ollama/LM Studio ignore it; OpenAI requires it. */
  apiKey?: string;
  requestTimeoutMs?: number;
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface StreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** A single OpenAI-style message. `content` is a plain string for text-only
 * turns, or an array of parts for multimodal (vision) turns. */
type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'system' | 'user';
      content: Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
    };

const IMAGE_MIME = /^image\/(png|jpe?g|webp|gif|bmp)$/i;

/** A real model provider over an OpenAI-compatible `/chat/completions` endpoint.
 * There is no silent fallback to a stub: a configured real provider that fails
 * surfaces the error to the caller (mirrors the extension-side provider policy). */
export class OpenAiCompatProvider implements ProviderAdapter {
  public readonly profile: Exclude<ModelProfile, 'none'>;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly visionModel?: string;
  private readonly apiKey?: string;
  private readonly requestTimeoutMs: number;

  constructor(opts: OpenAiCompatOptions) {
    this.profile = opts.profile;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.visionModel = opts.visionModel;
    this.apiKey = opts.apiKey;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 60_000;
  }

  /** Lightweight reachability probe. Prefers GET /models (cheap); treats any
   * HTTP response as "reachable" — auth/model errors are surfaced at complete()
   * time, not hidden here. */
  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/models`, { method: 'GET' }, 4_000);
      return response.ok || response.status === 401 || response.status === 403;
    } catch {
      return false;
    }
  }

  /** Resolve the concrete model + messages for a turn (vision-aware), shared by
   * the buffered {@link complete} and the streaming {@link stream} paths. */
  private prepare(request: ChatTurnRequest): { model: string; messages: ChatMessage[] } {
    const images = (request.context.attachments ?? []).filter((a) => IMAGE_MIME.test(a.mimeType));
    const useVision = images.length > 0 && Boolean(this.visionModel);
    return {
      model: useVision ? (this.visionModel as string) : this.model,
      messages: this.buildMessages(request, useVision ? images : []),
    };
  }

  async complete(request: ChatTurnRequest): Promise<ChatTurnResponse> {
    const started = Date.now();
    const { model, messages } = this.prepare(request);
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages, stream: false }),
      },
      this.requestTimeoutMs,
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Model provider ${this.baseUrl} returned HTTP ${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
    }

    const data = (await response.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(`Model provider ${this.baseUrl} returned no completion content.`);
    }

    return {
      modelProfile: this.profile,
      content,
      citations: request.context.activeFile
        ? [{ path: request.context.activeFile, startLine: 1, endLine: 20 }]
        : [],
      proposedEdits: [],
      telemetry: {
        inputTokens: data.usage?.prompt_tokens ?? Math.ceil(request.userPrompt.length / 4),
        outputTokens: data.usage?.completion_tokens ?? Math.ceil(content.length / 4),
        latencyMs: Date.now() - started,
        cacheHit: false,
      },
    };
  }

  /** Stream a completion token-by-token over SSE (`stream:true`). Yields text
   * deltas as they arrive and a final `usage` frame when the provider reports it.
   * The first yield is delayed until the upstream response is open and OK, so a
   * caller can fail over to another model before any token is emitted. `signal`
   * aborts both the request and the stream. */
  async *stream(
    request: ChatTurnRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<{ delta?: string; usage?: { inputTokens: number; outputTokens: number } }> {
    const { model, messages } = this.prepare(request);
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
        },
        body: JSON.stringify({ model, messages, stream: true, stream_options: { include_usage: true } }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      throw err;
    }
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      const detail = res.ok ? 'empty stream' : await res.text().catch(() => '');
      throw new Error(`Model provider ${this.baseUrl} stream HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let outChars = 0;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice('data:'.length).trim();
          if (payload === '[DONE]') return;
          let parsed: StreamChunk;
          try {
            parsed = JSON.parse(payload) as StreamChunk;
          } catch {
            continue;
          }
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            outChars += delta.length;
            yield { delta };
          }
          if (parsed.usage) {
            yield {
              usage: {
                inputTokens: parsed.usage.prompt_tokens ?? 0,
                outputTokens: parsed.usage.completion_tokens ?? Math.ceil(outChars / 4),
              },
            };
          }
        }
      }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private buildMessages(
    request: ChatTurnRequest,
    images: ReadonlyArray<{ name: string; mimeType: string; dataBase64: string }>,
  ): ChatMessage[] {
    const hasWorkspaceContext =
      (request.context.retrievedChunks?.length ?? 0) > 0 || Boolean(request.context.selectionText);

    const parts: ChatMessage[] = [];
    parts.push({
      role: 'system',
      content:
        'You are MigraPilot, a workspace-aware coding assistant. Answer concisely and use Markdown. ' +
        `Task feature: ${request.feature}.` +
        (hasWorkspaceContext
          ? ' Workspace code may be provided below as context. When you assert a fact about THIS repository\'s EXISTING code, ground it in that context and cite `path:line` — do not invent repo APIs, files, or behaviour, and if the context lacks the answer to a question about existing code, say so instead of guessing. This grounding is for ACCURACY ONLY — it is NOT a restriction on what you may do: for design, planning, building, brainstorming, writing new code, or general help, assist fully and normally even when the workspace context does not cover the topic. NEVER refuse, stall, or ask the user to "clarify" merely because the provided code does not mention the subject — a request to build or design something new needs no prior code evidence.'
          : '') +
        (images.length ? ' The user attached one or more images — analyze them and answer about their contents.' : ''),
    });

    const context: string[] = [];
    if (request.context.activeFile) {
      context.push(`Active file: ${request.context.activeFile}`);
    }
    if (request.context.selectionText) {
      context.push(`Selected code:\n\`\`\`\n${request.context.selectionText}\n\`\`\``);
    }
    for (const chunk of request.context.retrievedChunks ?? []) {
      context.push(`Context from ${chunk.path}:${chunk.startLine}-${chunk.endLine}\n\`\`\`\n${chunk.snippet}\n\`\`\``);
    }
    if (request.context.conversationSummary) {
      context.push(`Conversation so far:\n${request.context.conversationSummary}`);
    }

    const userText = context.length
      ? `${context.join('\n\n')}\n\n---\n\n${request.userPrompt}`
      : request.userPrompt;

    if (images.length) {
      // Multimodal turn: text part + one image_url part per attached image.
      const content: Array<
        { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }
      > = [{ type: 'text', text: userText || 'Describe and analyze the attached image(s).' }];
      for (const img of images) {
        content.push({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.dataBase64}` } });
      }
      parts.push({ role: 'user', content });
    } else {
      parts.push({ role: 'user', content: userText });
    }
    return parts;
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}
