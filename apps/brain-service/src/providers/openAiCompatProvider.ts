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
  /**
   * @deprecated A single TOTAL deadline for a whole generation. Kept so existing
   * callers keep compiling; it now seeds {@link connectTimeoutMs} only. A local
   * 14B model streaming a grounded context routinely runs past any fixed total,
   * so a total deadline killed valid turns — see {@link StreamTimeoutPolicy}.
   */
  requestTimeoutMs?: number;
  /** Deadline for the provider to ACCEPT the request and return headers. */
  connectTimeoutMs?: number;
  /** Max gap BETWEEN tokens. Reset on every chunk, so a healthy stream never
   * expires no matter how long the answer is. */
  idleTimeoutMs?: number;
  /** Final safety guard on total wall-clock. `0`/undefined = no ceiling. */
  absoluteTimeoutMs?: number;
}

/** Which deadline expired. Distinct from a user abort and from a provider error
 * so operators can tell "model too slow to start" from "model went silent" from
 * "someone pressed Stop". */
export type TimeoutPhase = 'connect' | 'idle' | 'absolute' | 'response';

export class ProviderTimeoutError extends Error {
  override readonly name = 'ProviderTimeoutError';
  constructor(
    readonly phase: TimeoutPhase,
    readonly limitMs: number,
    readonly elapsedMs: number,
    baseUrl: string,
  ) {
    super(
      phase === 'connect'
        ? `Model provider ${baseUrl} did not accept the connection within ${limitMs}ms (connect timeout).`
        : phase === 'idle'
          ? `Model provider ${baseUrl} sent no output for ${limitMs}ms (idle timeout) after ${elapsedMs}ms.`
          : phase === 'response'
            ? // The connection SUCCEEDED. Saying "connect timeout" here sent operators to
              // check networking that answers in under a millisecond.
              `Model provider ${baseUrl} accepted the request but returned no complete response within ${limitMs}ms (non-streaming request; the model was still generating after ${elapsedMs}ms).`
            : `Model provider ${baseUrl} exceeded the ${limitMs}ms absolute ceiling.`,
    );
  }
}

/** Raised when the CALLER aborted — never conflated with a timeout. */
export class ProviderAbortedError extends Error {
  override readonly name = 'ProviderAbortedError';
  constructor(readonly elapsedMs: number) {
    super(`The request was aborted by the caller after ${elapsedMs}ms.`);
  }
}

/**
 * Streaming-aware timeout policy.
 *
 * The provider previously armed ONE `setTimeout(abort, 60_000)` before the fetch
 * and never reset it, so the whole generation had to finish inside 60 seconds.
 * A grounded turn on a local 14B model exceeded that after retrieval, gating,
 * provenance and audit had all already succeeded — the expensive work was paid
 * for and then thrown away, and the failure surfaced as a bare `AbortError`
 * indistinguishable from the user pressing Stop.
 *
 * Tokens arriving are proof of liveness, so the deadline that matters during a
 * stream is the GAP between them, not the total.
 */
export interface StreamTimeoutPolicy {
  connectMs: number;
  idleMs: number;
  /** 0 = unbounded. */
  absoluteMs: number;
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

/** True for the DOMException/Error an aborted fetch throws. */
function isAbort(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/** A real model provider over an OpenAI-compatible `/chat/completions` endpoint.
 * There is no silent fallback to a stub: a configured real provider that fails
 * surfaces the error to the caller (mirrors the extension-side provider policy). */
export class OpenAiCompatProvider implements ProviderAdapter {
  public readonly profile: Exclude<ModelProfile, 'none'>;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly visionModel?: string;
  private readonly apiKey?: string;
  private readonly timeouts: StreamTimeoutPolicy;

  constructor(opts: OpenAiCompatOptions) {
    this.profile = opts.profile;
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.model = opts.model;
    this.visionModel = opts.visionModel;
    this.apiKey = opts.apiKey;
    // `requestTimeoutMs` seeds only the CONNECT deadline: as a total budget it was
    // the defect. Idle and absolute are independent.
    this.timeouts = {
      connectMs: opts.connectTimeoutMs ?? opts.requestTimeoutMs ?? 60_000,
      idleMs: opts.idleTimeoutMs ?? 120_000,
      absoluteMs: opts.absoluteTimeoutMs ?? 0,
    };
  }

  /** The effective policy, so callers/tests can assert what is enforced. */
  timeoutPolicy(): StreamTimeoutPolicy {
    return { ...this.timeouts };
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
    // Non-streaming: there are no tokens to prove liveness, so the only sensible
    // bound is a single deadline covering the whole request.
    //
    // Measured against Ollama: on `stream: false` the response HEADERS are withheld
    // until generation completes (TTFB 11.57s == total 11.57s for a 200-token reply,
    // versus TTFB 0.32s when streaming). So this budget necessarily spans connect +
    // prefill + the entire generation, and `fetch` cannot observe the phases apart.
    // It is therefore reported as `response`, NOT `connect` — TCP connect to this
    // provider completes in ~0.6ms, so blaming connect pointed operators at healthy
    // networking while a 14B model spilling 34% to CPU was the actual cost.
    const budget = this.timeouts.absoluteMs > 0 ? Math.max(this.timeouts.connectMs, this.timeouts.absoluteMs) : this.timeouts.connectMs;
    let response: Response;
    try {
      response = await this.fetchWithTimeout(
        `${this.baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
          body: JSON.stringify({ model, messages, stream: false }),
        },
        budget,
      );
    } catch (err) {
      // A bare AbortError says nothing about WHY. Name the deadline HONESTLY: the
      // connection was accepted, the response never completed.
      if (isAbort(err)) throw new ProviderTimeoutError('response', budget, Date.now() - started, this.baseUrl);
      throw err;
    }

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
    // ── Streaming deadlines ──────────────────────────────────────────────────
    // Three independent clocks, so a slow-but-alive stream is never killed:
    //   connect  — until headers arrive, then cancelled
    //   idle     — armed once streaming starts, RESET on every chunk
    //   absolute — optional final guard on total wall-clock
    const started = Date.now();
    let expired: TimeoutPhase | undefined;
    let limitMs = 0;
    const fire = (phase: TimeoutPhase, limit: number) => {
      expired = phase;
      limitMs = limit;
      controller.abort();
    };

    let connectTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => fire('connect', this.timeouts.connectMs),
      this.timeouts.connectMs,
    );
    const absoluteTimer =
      this.timeouts.absoluteMs > 0 ? setTimeout(() => fire('absolute', this.timeouts.absoluteMs), this.timeouts.absoluteMs) : undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    /** Every chunk is proof of liveness — restart the only clock that can kill us. */
    const touch = (): void => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => fire('idle', this.timeouts.idleMs), this.timeouts.idleMs);
    };
    const clearAll = (): void => {
      if (connectTimer) clearTimeout(connectTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (absoluteTimer) clearTimeout(absoluteTimer);
    };
    /** Turn a bare abort into a NAMED cause: our deadline, or the caller's Stop. */
    const classify = (err: unknown): unknown => {
      if (!isAbort(err)) return err;
      if (expired) return new ProviderTimeoutError(expired, limitMs, Date.now() - started, this.baseUrl);
      if (signal?.aborted) return new ProviderAbortedError(Date.now() - started);
      return err;
    };

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
      clearAll();
      signal?.removeEventListener('abort', onAbort);
      throw classify(err);
    }
    // Headers are in: the connect deadline has done its job and must not linger as
    // a total-request deadline — that lingering timer WAS the defect.
    if (connectTimer) {
      clearTimeout(connectTimer);
      connectTimer = undefined;
    }
    if (!res.ok || !res.body) {
      clearAll();
      signal?.removeEventListener('abort', onAbort);
      const detail = res.ok ? 'empty stream' : await res.text().catch(() => '');
      throw new Error(`Model provider ${this.baseUrl} stream HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let outChars = 0;
    touch(); // arm the idle clock only once the stream is actually open
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        touch(); // liveness: reset, never accumulate toward a total
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
    } catch (err) {
      throw classify(err);
    } finally {
      clearAll();
      signal?.removeEventListener('abort', onAbort);
    }
  }

  private buildMessages(
    request: ChatTurnRequest,
    images: ReadonlyArray<{ name: string; mimeType: string; dataBase64: string }>,
  ): ChatMessage[] {
    const hasWorkspaceContext =
      (request.context.retrievedChunks?.length ?? 0) > 0 || Boolean(request.context.selectionText);

    /*
     * IDENTITY FOLLOWS THE CAPABILITY, NOT THE ENGINE.
     *
     * This system prompt used to be a single hard-coded "You are MigraPilot, a
     * workspace-aware coding assistant" for every caller. One Brain serves the
     * VS Code extension AND the public consumer, so that framing became the
     * identity every member of the public met: asked in French to introduce
     * itself, the consumer replied "Je suis MigraPilot, un assistant de codage
     * conscient de l'espace de travail" — to someone who had asked nothing
     * about code. Engineering specialisation belongs to routing, not to the
     * universal assistant.
     *
     * `systemPromptId` is the field that already carried this intent and was
     * being ignored. `engineer-v1` keeps the engineering persona; everything
     * else gets the general assistant. The grounding/citation rules below are
     * appended to BOTH, because they are about accuracy, not identity.
     */
    const engineering = request.systemPromptId === 'engineer-v1';

    const ENGINEER_PERSONA =
      'You are MigraPilot, a workspace-aware coding assistant. Answer concisely and use Markdown. ' +
      // The user is asking about THEIR OWN machine and code. A blanket refusal
      // ("I'm sorry, but I can't help with that request") is never appropriate
      // here and has been emitted for benign questions like "locate MigraCMS".
      'You operate on the USER\'S OWN local workspace on their own machine: questions about their code, files, paths, packages, routes, schemas and configuration are always legitimate and safe to answer. ' +
      'NEVER reply with a blanket refusal such as "I\'m sorry, but I can\'t help with that request" — there is nothing to refuse. If you genuinely lack the information, say specifically what is missing and which file or path would have it. ' +
      // Observed on an image turn: "you'd need access or detailed code files from
      // a repository or a local workspace". MigraPilot HAS workspace access —
      // implying otherwise is the same false capability-denial we removed from
      // the inspection path, and it puts the work back on the user.
      'You already HAVE access to this workspace: relevant code is retrieved and attached for you automatically, and read-only workspace tools can search it. NEVER say or imply that you need access to the user\'s repository, files, or workspace, and never ask them to upload, paste or "provide access to" their codebase. If the attached context does not cover something, say what you did not find and name the file or path to look at — or ask them to point you at a folder — but never claim a lack of access you do not have. ';

    /*
     * THE LANGUAGE RULE IS NOT DECORATIVE. With no instruction, the model
     * guessed: `sak pase?` — everyday Haitian Creole — came back in INDONESIAN
     * ("Tentu, Anda bisa melanjutkan!"). Haitian Creole is named explicitly
     * because models of this size routinely misread it as Indonesian, Malay or
     * French, and because it is a first-class language for this product.
     */
    const ASSISTANT_PERSONA =
      'You are MigraPilot, a helpful, friendly, general-purpose AI assistant. Answer naturally and use Markdown when it helps. ' +
      'You help with everyday questions, writing, explanation, planning, analysis and code. Code is one of your abilities, not your identity — never introduce yourself as a coding assistant or a workspace assistant unless the user is specifically asking about software work. ' +
      // BALANCE MATTERS HERE. A first attempt spelled out Haitian Creole at
      // length, and the model over-corrected: French and English questions came
      // back in Creole. The rule is therefore stated once, neutrally, with
      // Creole named only as a disambiguation hint rather than a preference.
      'LANGUAGE: reply in the SAME language the user wrote in — if they write English, answer in English; French, answer in French; Haitian Creole, answer in Haitian Creole. Never switch languages on your own. ' +
      // Scoped to Creole-specific greetings ONLY. An earlier, broader version
      // pulled ANY short greeting toward Creole: `salut` — plain French —
      // came back as "SALUT! Ka fet ou?" in Kreyol. The hint must disambiguate
      // Creole, not capture the neighbouring languages it is confused with.
      'A few short Haitian Creole greetings are routinely misread as Indonesian, Malay, or a typo: "sak pase", "sa k ap fet", "kijan ou ye", "n ap boule", "bonjou", "bonswa". Treat THOSE as Haitian Creole. ' +
      'This does not extend to greetings from other languages: "salut", "bonjour", "coucou" and "ca va" are FRENCH and are answered in French; "hi", "hey", "yo" and "what is up" are ENGLISH and are answered in English. ' +
      'Never treat an ordinary message as a filename, a path, a command, or a typo. ' +
      'A short greeting or small talk deserves a short, warm, human reply — not a request for clarification and not a list of your capabilities. ';

    const parts: ChatMessage[] = [];
    parts.push({
      role: 'system',
      content:
        (engineering ? ENGINEER_PERSONA : ASSISTANT_PERSONA) +
        `Task feature: ${request.feature}.` +
        (hasWorkspaceContext
          ? ' Context may be provided below as retrieved excerpts from the user\'s own material. When you assert a fact that comes from it, ground it in that context and cite `path:line` — do not invent files, APIs or behaviour. The context is a RELEVANT SAMPLE, not everything: answer the parts it DOES support (with citations), and for a specific fact it does not show, say just that fact is not in the retrieved excerpts — name the specific gap. Do NOT dismiss the whole question, refuse, or ask the user to paste or "provide access to" their material — it is already retrieved for you. This grounding is for ACCURACY ONLY — it is NOT a restriction: for design, planning, writing, brainstorming or general help, assist fully even when the context does not cover the topic.'
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

/** A named failure class for the SSE frame and the audit record. */
export interface ProviderFailure {
  /** Stable machine code for the client. */
  code:
    | 'PROVIDER_CONNECT_TIMEOUT'
    | 'PROVIDER_IDLE_TIMEOUT'
    | 'PROVIDER_ABSOLUTE_TIMEOUT'
    /** Non-streaming request accepted, generation never completed. NOT a connect failure. */
    | 'PROVIDER_RESPONSE_TIMEOUT'
    | 'USER_ABORTED'
    | 'ENGINE_FAILURE';
  /** Short cause slug for audit `outcome`/fields. */
  cause: 'connect-timeout' | 'idle-timeout' | 'absolute-timeout' | 'response-timeout' | 'user-abort' | 'provider-error';
  /** The deadline that expired, when one did. */
  limitMs?: number;
}

/**
 * Name the cause of a provider failure.
 *
 * Everything used to collapse into `ENGINE_FAILURE` carrying a bare `AbortError`,
 * so a fixed-total-deadline defect was indistinguishable from the user pressing
 * Stop or from the model crashing. Operators could not tell those apart, and the
 * audit trail recorded only `outcome: 'error'`.
 */
export function classifyProviderFailure(err: unknown): ProviderFailure {
  if (err instanceof ProviderTimeoutError) {
    const byPhase = {
      connect: { code: 'PROVIDER_CONNECT_TIMEOUT', cause: 'connect-timeout' },
      idle: { code: 'PROVIDER_IDLE_TIMEOUT', cause: 'idle-timeout' },
      absolute: { code: 'PROVIDER_ABSOLUTE_TIMEOUT', cause: 'absolute-timeout' },
      // Distinct from connect: the provider answered, the generation did not finish.
      response: { code: 'PROVIDER_RESPONSE_TIMEOUT', cause: 'response-timeout' },
    } as const;
    return { ...byPhase[err.phase], limitMs: err.limitMs };
  }
  if (err instanceof ProviderAbortedError) return { code: 'USER_ABORTED', cause: 'user-abort' };
  // An unclassified abort is still more likely a cancellation than an engine bug.
  if (isAbort(err)) return { code: 'USER_ABORTED', cause: 'user-abort' };
  return { code: 'ENGINE_FAILURE', cause: 'provider-error' };
}
