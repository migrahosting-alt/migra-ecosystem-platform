// MigraPilot — Brain transport, routed through the authoritative execution state.
//
// Every consequential Brain request runs as ONE operation with its own state object.
// The rules from executionState.ts are enforced here at the point of dispatch:
//
//  * nothing is sent until `mayAttemptAction()` is true — a failed precondition
//    performs ZERO fetches, it does not "send it and see";
//  * success is emitted only through `observeTerminal()`;
//  * a response arriving after cancellation is discarded and never reaches a
//    continuation callback, the UI, files, or the work report;
//  * failures are classified from STRUCTURED evidence — abort reason, undici error
//    code, HTTP status, parse outcome, process exit — not from message-string
//    matching. When the runtime does not expose enough to be sure, the category is
//    the conservative one and the raw non-secret diagnostic is preserved separately.

import {
  ExecutionStateMachine,
  type ExecutionRecord,
  type FailureCategory,
} from './executionState.js';

/** Why a transport was aborted. Kept distinct so a timeout is never reported as a
 * user cancellation, and a shutdown is never reported as either. */
export type AbortReasonKind = 'user_cancellation' | 'request_timeout' | 'connection_shutdown';

export class BrainAbortReason extends Error {
  constructor(
    readonly kind: AbortReasonKind,
    message: string,
  ) {
    super(message);
    this.name = 'BrainAbortReason';
  }
}

/** Everything observed about a failed attempt. Fields are optional because the
 * runtime does not always provide them; the classifier degrades conservatively. */
export interface FailureEvidence {
  /** The reason passed to `AbortController.abort()`, when the attempt was aborted. */
  abortReason?: unknown;
  /** `error.cause` from a rejected `fetch`. */
  cause?: { code?: string; name?: string; message?: string } | undefined;
  /** HTTP status, when a response was actually received. */
  httpStatus?: number;
  /** Set when the body could not be parsed or failed schema validation. */
  parseFailed?: boolean;
  /** Set when the Brain child process was observed to exit. */
  processExited?: boolean;
  /** Set when a cancellation was requested but never acknowledged. */
  cancellationUnacknowledged?: boolean;
}

export interface Classification {
  readonly category: FailureCategory;
  /** Raw, non-secret diagnostic preserved verbatim for the durable record. */
  readonly diagnostic: string;
  /** True when the evidence was insufficient and the category is a conservative
   * fallback rather than a positive identification. */
  readonly conservative: boolean;
}

/** undici/node connect-phase codes: nothing was ever delivered. */
const REFUSED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_SOCKET_BAD_PORT',
]);

/** Codes meaning the connection existed and then broke. */
const LOST_CODES = new Set([
  'ECONNRESET',
  'EPIPE',
  'UND_ERR_SOCKET',
  'ERR_STREAM_PREMATURE_CLOSE',
  'UND_ERR_RESPONSE_STATUS_CODE',
]);

/**
 * Map observed evidence onto the taxonomy.
 *
 * Ordered by how conclusive each signal is. Abort reason wins because only the
 * caller knows whether it aborted for a timeout or because the user asked.
 */
export function classifyTransportFailure(evidence: FailureEvidence): Classification {
  const raw = [
    evidence.cause?.code && `code=${evidence.cause.code}`,
    evidence.cause?.name && `name=${evidence.cause.name}`,
    evidence.httpStatus !== undefined && `http=${evidence.httpStatus}`,
    evidence.cause?.message && `msg=${evidence.cause.message}`,
  ]
    .filter(Boolean)
    .join(' ') || 'no structured diagnostic available';

  if (evidence.cancellationUnacknowledged) {
    return { category: 'cancellation_unconfirmed', diagnostic: raw, conservative: false };
  }

  if (evidence.abortReason instanceof BrainAbortReason) {
    switch (evidence.abortReason.kind) {
      case 'request_timeout':
        return { category: 'request_timeout', diagnostic: raw, conservative: false };
      case 'connection_shutdown':
        return { category: 'connection_lost', diagnostic: raw, conservative: false };
      case 'user_cancellation':
        // Not a failure by itself — the cancellation contract owns the outcome.
        return { category: 'cancellation_unconfirmed', diagnostic: raw, conservative: true };
    }
  }

  if (evidence.processExited) {
    return { category: 'brain_process_exit', diagnostic: raw, conservative: false };
  }

  const code = evidence.cause?.code;
  if (code && REFUSED_CODES.has(code)) {
    return { category: 'connection_refused', diagnostic: raw, conservative: false };
  }
  if (code && LOST_CODES.has(code)) {
    return { category: 'connection_lost', diagnostic: raw, conservative: false };
  }

  if (evidence.parseFailed) {
    return { category: 'invalid_response', diagnostic: raw, conservative: false };
  }

  if (evidence.httpStatus !== undefined && evidence.httpStatus >= 400) {
    // A response arrived, so the transport worked; we simply cannot call it terminal.
    return { category: 'terminal_state_unverified', diagnostic: raw, conservative: false };
  }

  // Insufficient evidence. Conservative: assume the work may have been delivered and
  // its outcome is unknown — never assume it did not happen, and never assume success.
  return { category: 'terminal_state_unverified', diagnostic: raw, conservative: true };
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface BrainOperationOptions<T> {
  operationId: string;
  requestedAction: string;
  endpoint: string;
  timeoutMs: number;
  body?: unknown;
  method?: 'GET' | 'POST';
  /** Checked BEFORE dispatch. Returning false performs zero fetches. */
  precondition?: () => Promise<boolean> | boolean;
  preconditionLabel?: string;
  /** Validates/parses the payload. Throwing or returning undefined ⇒ invalid_response. */
  parse?: (raw: unknown) => T | undefined;
  /** Invoked ONLY on a genuinely observed terminal success. Never after cancellation. */
  onTerminal?: (value: T) => void;
  fetchImpl?: FetchLike;
  externalSignal?: AbortSignal;
}

export interface BrainOperationOutcome<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly record: ExecutionRecord;
  readonly statusLine: string;
}

/**
 * Run one Brain request as a governed operation.
 *
 * The machine — not this function's control flow — decides what may be reported.
 */
export async function runBrainOperation<T>(
  opts: BrainOperationOptions<T>,
  machine = new ExecutionStateMachine({
    operationId: opts.operationId,
    requestedAction: opts.requestedAction,
    brainEndpoint: opts.endpoint,
  }),
): Promise<BrainOperationOutcome<T>> {
  const doFetch = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  const finish = (ok: boolean, value?: T): BrainOperationOutcome<T> => ({
    ok,
    ...(value === undefined ? {} : { value }),
    record: machine.snapshot(),
    statusLine: machine.statusLine(),
  });

  machine.transition('connecting', 'operation start');
  machine.transition('ready', 'endpoint configured');

  // ── Phase 1–2: precondition ───────────────────────────────────────────────
  if (opts.precondition) {
    const label = opts.preconditionLabel ?? 'precondition';
    machine.requestPrecondition(label);
    let observed = false;
    try {
      observed = Boolean(await opts.precondition());
    } catch (err) {
      observed = false;
      machine.recordTransportAttempt(opts.endpoint, 'error', `precondition threw: ${String(err)}`);
    }
    if (!machine.confirmPrecondition(observed, label)) return finish(false);
  } else {
    machine.requestPrecondition('none required');
    machine.confirmPrecondition(true, 'no precondition for this action');
  }

  // ── Phase 3: the gate. Zero fetches happen if this is false. ──────────────
  if (!machine.mayAttemptAction()) return finish(false);

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new BrainAbortReason('request_timeout', `no response within ${opts.timeoutMs}ms`));
  }, opts.timeoutMs);

  const onExternalAbort = () => {
    machine.requestCancellation('user requested cancellation');
    controller.abort(new BrainAbortReason('user_cancellation', 'user requested cancellation'));
  };
  opts.externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

  machine.markActionAttempted(opts.endpoint);
  machine.transition('running', 'request dispatched');

  try {
    const response = await doFetch(opts.endpoint, {
      method: opts.method ?? 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...(opts.method === 'GET' ? {} : { body: JSON.stringify(opts.body ?? {}) }),
      signal: controller.signal,
    });

    machine.markResponseReceived();

    if (!response.ok) {
      const c = classifyTransportFailure({ httpStatus: response.status });
      machine.fail(c.category, `HTTP ${response.status}: ${c.diagnostic}`);
      return finish(false);
    }

    let parsed: T | undefined;
    try {
      const raw = await response.json();
      parsed = opts.parse ? opts.parse(raw) : (raw as T);
      if (parsed === undefined) throw new Error('parse returned undefined');
    } catch (err) {
      const c = classifyTransportFailure({ parseFailed: true, cause: { message: String(err) } });
      machine.fail(c.category, c.diagnostic);
      return finish(false);
    }

    // ── Phase 5: the ONLY route to success. Returns false if cancellation was
    // requested, in which case the continuation below must not run. ──────────
    const promoted = machine.observeTerminal(true, 'terminal response observed and parsed');
    if (!promoted) return finish(false);

    opts.onTerminal?.(parsed);
    return finish(true, parsed);
  } catch (err) {
    const e = err as { cause?: { code?: string; name?: string; message?: string }; name?: string };
    const aborted = controller.signal.aborted;
    const c = classifyTransportFailure({
      ...(aborted ? { abortReason: controller.signal.reason } : {}),
      ...(e.cause ? { cause: e.cause } : {}),
    });

    if (aborted && !timedOut && machine.state === 'cancelling') {
      // A user cancellation whose transport is conclusively dead counts as
      // acknowledged — the work cannot still be running.
      machine.resolveCancellation(true, 'transport terminated after user cancellation');
      return finish(false);
    }

    machine.fail(c.category, c.diagnostic);
    return finish(false);
  } finally {
    clearTimeout(timer);
    opts.externalSignal?.removeEventListener('abort', onExternalAbort);
  }
}
