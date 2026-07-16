// pilot-api transport (see docs/pilot-api-integration-plan.md §1–§6).
//
// Intentionally free of any `vscode` import so the transport core is unit
// testable under plain `node --test` against a deterministic mock. The
// extension wires a vscode-backed PilotApiConfig (SecretStorage token, settings
// URL/timeout, output-channel log) in a thin adapter added in a later slice.

import {
  type CapabilityState,
  CONSERVATIVE_CAPABILITIES,
  CapabilityParseError,
  isProtocolCompatible,
  parseCapabilities,
} from './capabilities.js';
import { REQUEST_ID_HEADER, newRequestId } from './correlation.js';
import { PilotError, type PilotErrorCode } from './pilotErrors.js';

export interface PilotApiConfig {
  baseUrl(): string;
  /** Bearer token, or undefined when unauthenticated (authMode 'none' / dev). */
  token(): Promise<string | undefined> | string | undefined;
  authMode(): 'bearer' | 'none';
  timeoutMs(): number;
  log(message: string): void;
}

export interface PilotRequestOptions {
  body?: unknown;
  /** Caller-supplied cancellation signal (bridged from vscode CancellationToken). */
  signal?: AbortSignal;
  /** When set, sent as the idempotency key header for mutating actions. */
  idempotencyKey?: string;
  /** Overrides the auto-minted requestId (defaults to a fresh UUID). */
  requestId?: string;
  /** Skip Bearer auth for this call (used only for unauthenticated /health). */
  anonymous?: boolean;
}

export interface ChatStreamEvent {
  event: string;
  data: unknown;
}

const HEALTH_READY_PATH = '/health/ready';
const CAPABILITIES_PATH = '/api/pilot/v1/capabilities';
const CHAT_STREAM_PATH = '/api/pilot/chat/stream';

export class PilotApiClient {
  constructor(private readonly cfg: PilotApiConfig) {}

  private base(): string {
    return this.cfg.baseUrl().replace(/\/+$/, '');
  }

  private async authHeaders(opts: PilotRequestOptions): Promise<Record<string, string>> {
    const headers: Record<string, string> = {};
    if (!opts.anonymous && this.cfg.authMode() === 'bearer') {
      const token = await this.cfg.token();
      if (token) {
        headers['authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  }

  /** Combine caller signal with a timeout signal so either aborts the request.
   * `timedOut()` disambiguates a timeout abort from a user cancellation (the
   * thrown AbortError doesn't carry the abort reason). */
  private withTimeout(signal: AbortSignal | undefined): {
    signal: AbortSignal;
    done: () => void;
    timedOut: () => boolean;
  } {
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
    return {
      signal: controller.signal,
      done: () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      },
      timedOut: () => timedOut,
    };
  }

  private mapAbort(timedOut: boolean, requestId: string): PilotError {
    if (timedOut) {
      return new PilotError('TIMEOUT', 'Pilot request timed out.', { retriable: true, requestId });
    }
    return new PilotError('CANCELLED', 'Request cancelled.', { requestId });
  }

  /** Low-level JSON request. Throws PilotError on any failure — never returns
   * a stub-shaped success (no silent fallback). */
  async request<T>(method: 'GET' | 'POST', path: string, opts: PilotRequestOptions = {}): Promise<T> {
    const requestId = opts.requestId ?? newRequestId();
    const url = `${this.base()}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      [REQUEST_ID_HEADER]: requestId,
      ...(await this.authHeaders(opts)),
    };
    if (opts.idempotencyKey) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }
    this.cfg.log(`${method} ${url} [${requestId}]`);

    const { signal, done, timedOut } = this.withTimeout(opts.signal);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
        signal,
      });
    } catch (err) {
      done();
      if (isAbort(err)) {
        throw this.mapAbort(timedOut(), requestId);
      }
      throw new PilotError('NETWORK', `Could not reach Pilot at ${this.base()}.`, {
        requestId,
        cause: err,
      });
    }
    done();

    if (!res.ok) {
      throw await this.errorFromResponse(res, requestId);
    }
    return (await res.json()) as T;
  }

  private async errorFromResponse(res: Response, requestId: string): Promise<PilotError> {
    const text = await res.text().catch(() => '');
    let serverCode: string | undefined;
    try {
      serverCode = (JSON.parse(text) as { error?: string })?.error;
    } catch {
      /* non-JSON body */
    }
    const status = res.status;
    let code: PilotErrorCode;
    if (status === 401) {
      code = serverCode === 'INVALID_TOKEN' ? 'AUTH_INVALID' : 'AUTH_REQUIRED';
    } else if (status === 403) {
      code = 'AUTH_INVALID';
    } else if (status === 409 || serverCode === 'INVALID_STATE') {
      code = 'INVALID_STATE';
    } else if (status === 429) {
      code = 'RATE_LIMITED';
    } else if (status === 503) {
      code = 'NOT_READY';
    } else if (status >= 500) {
      code = 'SERVER_ERROR';
    } else {
      code = 'SERVER_ERROR';
    }
    return new PilotError(code, `Pilot responded ${status}${serverCode ? ` (${serverCode})` : ''}.`, {
      httpStatus: status,
      retriable: status === 429 || status === 503,
      requestId,
    });
  }

  /** GET /health/ready — reachability/readiness (separate from capabilities). */
  async ready(signal?: AbortSignal): Promise<boolean> {
    try {
      await this.request<{ ok?: boolean }>('GET', HEALTH_READY_PATH, { anonymous: true, signal });
      return true;
    } catch (err) {
      if (err instanceof PilotError && err.code === 'NOT_READY') {
        return false;
      }
      throw err;
    }
  }

  /**
   * Negotiate capabilities into one of four defined states (see
   * docs/pilot-api-capabilities.v1.md). Never throws for the missing/malformed/
   * incompatible/unauthorized cases — it returns a state the router acts on.
   * Genuinely unexpected transport errors still throw as PilotError.
   */
  async negotiateCapabilities(signal?: AbortSignal): Promise<CapabilityState> {
    let raw: unknown;
    try {
      raw = await this.request<unknown>('GET', CAPABILITIES_PATH, { signal });
    } catch (err) {
      if (err instanceof PilotError) {
        if (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_INVALID') {
          return { status: 'unauthorized' };
        }
        // Missing route (404) surfaces as SERVER_ERROR from errorFromResponse's
        // default branch; treat 404 explicitly as the "missing" degrade.
        if (err.httpStatus === 404 || err.httpStatus === 501) {
          this.cfg.log('capabilities endpoint absent — degrading to conservative set');
          return { status: 'degraded', reason: 'missing', caps: CONSERVATIVE_CAPABILITIES };
        }
      }
      throw err;
    }

    try {
      const caps = parseCapabilities(raw);
      if (!isProtocolCompatible(caps)) {
        this.cfg.log(`capabilities protocolVersion ${caps.protocolVersion} incompatible`);
        return { status: 'incompatible', observedProtocolVersion: caps.protocolVersion };
      }
      return { status: 'ready', caps };
    } catch (err) {
      if (err instanceof CapabilityParseError) {
        this.cfg.log(`capabilities malformed: ${err.message} — degrading to conservative set`);
        return { status: 'degraded', reason: 'malformed', caps: CONSERVATIVE_CAPABILITIES };
      }
      throw err;
    }
  }

  /**
   * Stream a chat turn as SSE. Yields parsed { event, data } frames in order and
   * completes when the stream closes. Aborting the signal cancels server work
   * (pilot-api cancels on response close).
   */
  async *chatStream(body: unknown, signal?: AbortSignal): AsyncGenerator<ChatStreamEvent> {
    yield* this.openSse('POST', CHAT_STREAM_PATH, { body, signal });
  }

  /**
   * Open an SSE stream against pilot-api and yield parsed { event, data } frames
   * in order. Aborting the signal cancels client streaming (and server work,
   * since pilot-api cancels on response close). A dropped connection throws a
   * NETWORK PilotError — callers reconcile via runId rather than assume outcome.
   */
  async *openSse(
    method: 'GET' | 'POST',
    path: string,
    opts: { body?: unknown; signal?: AbortSignal } = {},
  ): AsyncGenerator<ChatStreamEvent> {
    const requestId = newRequestId();
    const url = `${this.base()}${path}`;
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      [REQUEST_ID_HEADER]: requestId,
      ...(await this.authHeaders({})),
    };
    this.cfg.log(`${method} ${url} [${requestId}] (sse)`);

    const { signal: combined, done, timedOut } = this.withTimeout(opts.signal);
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'GET' ? undefined : JSON.stringify(opts.body ?? {}),
        signal: combined,
      });
    } catch (err) {
      done();
      if (isAbort(err)) {
        throw this.mapAbort(timedOut(), requestId);
      }
      throw new PilotError('NETWORK', `Could not reach Pilot at ${this.base()}.`, { requestId, cause: err });
    }
    if (!res.ok) {
      done();
      throw await this.errorFromResponse(res, requestId);
    }
    if (!res.body) {
      done();
      throw new PilotError('SERVER_ERROR', 'Pilot returned an empty stream.', { requestId });
    }

    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let sep: number;
        // SSE frames are separated by a blank line.
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const parsed = parseSseFrame(frame);
          if (parsed) {
            yield parsed;
          }
        }
      }
    } catch (err) {
      if (isAbort(err)) {
        throw this.mapAbort(timedOut(), requestId);
      }
      throw new PilotError('NETWORK', 'Pilot stream interrupted.', { requestId, cause: err });
    } finally {
      done();
    }
  }
}

function parseSseFrame(frame: string): ChatStreamEvent | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice('event:'.length).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }
  if (dataLines.length === 0) {
    return null;
  }
  const dataStr = dataLines.join('\n');
  let data: unknown = dataStr;
  try {
    data = JSON.parse(dataStr);
  } catch {
    /* leave as string */
  }
  return { event, data };
}

function isAbort(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
