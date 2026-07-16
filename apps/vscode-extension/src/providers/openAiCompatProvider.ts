import { PilotError, type PilotErrorCode } from '@migrapilot/pilot-client';
import { REQUEST_ID_HEADER } from '@migrapilot/pilot-client';
import {
  type ModelProvider,
  type ProviderCapabilities,
  type ProviderChunk,
  type ProviderRequest,
  type RateLimitInfo,
} from './modelProvider.js';

// Real provider speaking the OpenAI-compatible /chat/completions streaming wire
// format (OpenAI, Ollama /v1, LM Studio, vLLM, …). vscode-free; credentials are
// injected via config and NEVER logged or placed in errors. Failures map into
// the PilotError taxonomy.

export interface OpenAiCompatConfig {
  baseUrl(): string;
  /** Bearer key or undefined (e.g. a local server with auth disabled). */
  apiKey(): Promise<string | undefined> | string | undefined;
  model(): string;
  timeoutMs(): number;
  log(message: string): void;
}

export class OpenAiCompatProvider implements ModelProvider {
  readonly id = 'openai-compat';

  constructor(private readonly cfg: OpenAiCompatConfig) {}

  capabilities(): ProviderCapabilities {
    return { providerId: this.id, model: this.cfg.model(), streaming: true, supportsCancellation: true };
  }

  async *stream(req: ProviderRequest, signal?: AbortSignal): AsyncGenerator<ProviderChunk> {
    const base = this.cfg.baseUrl().replace(/\/+$/, '');
    const url = `${base}/chat/completions`;
    const key = await this.cfg.apiKey();
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      [REQUEST_ID_HEADER]: req.requestId,
    };
    if (key) {
      headers['authorization'] = `Bearer ${key}`;
    }
    // Log identity + correlation only — never the key.
    this.cfg.log(`provider ${this.id} ${this.cfg.model()} POST ${url} [${req.requestId}]`);

    const body = JSON.stringify({
      model: req.model ?? this.cfg.model(),
      messages: req.messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
    });

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.cfg.timeoutMs());
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) {
        controller.abort();
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    let res: Response;
    try {
      res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    } catch (err) {
      cleanup();
      if (isAbort(err)) {
        throw abortError(timedOut, req.requestId);
      }
      throw new PilotError('NETWORK', 'Could not reach the model provider.', {
        requestId: req.requestId,
        cause: err,
      });
    }

    if (!res.ok) {
      const err = await errorFromResponse(res, req.requestId);
      cleanup();
      throw err;
    }
    if (!res.body) {
      cleanup();
      throw new PilotError('SERVER_ERROR', 'Provider returned an empty stream.', { requestId: req.requestId });
    }

    const rateLimit = parseRateLimit(res);
    const decoder = new TextDecoder();
    let buffer = '';
    let usageEmitted = false;
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const data = sseData(frame);
          if (data === undefined) {
            continue;
          }
          if (data === '[DONE]') {
            if (!usageEmitted && rateLimit) {
              yield { type: 'usage', usage: {}, rateLimit };
            }
            yield { type: 'done' };
            return;
          }
          let json: OpenAiStreamChunk;
          try {
            json = JSON.parse(data) as OpenAiStreamChunk;
          } catch {
            continue; // ignore keep-alives / malformed frames
          }
          const token = json.choices?.[0]?.delta?.content;
          if (token) {
            yield { type: 'token', text: token };
          }
          if (json.usage) {
            usageEmitted = true;
            yield {
              type: 'usage',
              usage: {
                promptTokens: json.usage.prompt_tokens,
                completionTokens: json.usage.completion_tokens,
                totalTokens: json.usage.total_tokens,
              },
              rateLimit,
            };
          }
        }
      }
      // Stream ended without an explicit [DONE].
      yield { type: 'done' };
    } catch (err) {
      if (isAbort(err)) {
        throw abortError(timedOut, req.requestId);
      }
      throw new PilotError('NETWORK', 'Provider stream interrupted.', { requestId: req.requestId, cause: err });
    } finally {
      cleanup();
    }
  }
}

interface OpenAiStreamChunk {
  choices?: Array<{ delta?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

function sseData(frame: string): string | undefined {
  const parts: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('data:')) {
      parts.push(line.slice('data:'.length).trimStart());
    }
  }
  return parts.length ? parts.join('\n') : undefined;
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}

function abortError(timedOut: boolean, requestId: string): PilotError {
  return timedOut
    ? new PilotError('TIMEOUT', 'The model provider did not respond in time.', { retriable: true, requestId })
    : new PilotError('CANCELLED', 'Request cancelled.', { requestId });
}

async function errorFromResponse(res: Response, requestId: string): Promise<PilotError> {
  // Read (and discard) the body so we don't surface a raw provider payload.
  await res.text().catch(() => '');
  const status = res.status;
  let code: PilotErrorCode;
  let retriable = false;
  if (status === 401 || status === 403) {
    code = 'AUTH_INVALID';
  } else if (status === 429) {
    code = 'RATE_LIMITED';
    retriable = true;
  } else if (status >= 500) {
    code = 'SERVER_ERROR';
    retriable = true;
  } else {
    code = 'SERVER_ERROR';
  }
  return new PilotError(code, `Model provider responded ${status}.`, { httpStatus: status, retriable, requestId });
}

function parseRateLimit(res: Response): RateLimitInfo | undefined {
  const limit = num(res.headers.get('x-ratelimit-limit-requests') ?? res.headers.get('x-ratelimit-limit'));
  const remaining = num(
    res.headers.get('x-ratelimit-remaining-requests') ?? res.headers.get('x-ratelimit-remaining'),
  );
  const reset = num(res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset-requests'));
  if (limit === undefined && remaining === undefined && reset === undefined) {
    return undefined;
  }
  return { limit, remaining, resetSeconds: reset };
}

function num(v: string | null): number | undefined {
  if (v === null) {
    return undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
