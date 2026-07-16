// pilot-api capability contract v1 — see docs/pilot-api-capabilities.v1.md.
// The extension CONSUMES capabilities; it never infers them from serverVersion
// or hardcoded assumptions. A non-conforming response resolves into one of four
// defined states, none of which silently falls back to the local stub.

export const SUPPORTED_PROTOCOL_VERSION = 1;

export type ChatTransport = 'sse' | 'ndjson' | 'buffered';

export interface PilotCapabilities {
  protocolVersion: number;
  serverVersion?: string;
  chatTransport: ChatTransport;
  streaming: boolean;
  approvals: boolean;
  rejectResumeReplay: { reject: boolean; resume: boolean; replay: boolean };
  cancellation: boolean;
  correlation: { requestIdHeader: string | null; echoesRequestId: boolean };
  idempotency: { supported: boolean; keyHeader: string | null; scopes: string[] };
  operationClasses: string[];
  limits: {
    maxRequestBytes: number | null;
    maxRunDurationMs: number | null;
    streamIdleTimeoutMs: number | null;
    maxConcurrentRuns: number | null;
  };
  deprecated: Array<{ capability: string; removeAfterProtocolVersion: number; note?: string }>;
  unavailable: string[];
}

/** Conservative capability set assumed when the real capabilities can't be
 * trusted (missing/malformed). Everything advanced is OFF. */
export const CONSERVATIVE_CAPABILITIES: PilotCapabilities = {
  protocolVersion: SUPPORTED_PROTOCOL_VERSION,
  chatTransport: 'buffered',
  streaming: false,
  approvals: false,
  rejectResumeReplay: { reject: false, resume: false, replay: false },
  cancellation: false,
  correlation: { requestIdHeader: null, echoesRequestId: false },
  idempotency: { supported: false, keyHeader: null, scopes: [] },
  operationClasses: [],
  limits: {
    maxRequestBytes: null,
    maxRunDurationMs: null,
    streamIdleTimeoutMs: null,
    maxConcurrentRuns: null,
  },
  deprecated: [],
  unavailable: [],
};

export type CapabilityState =
  | { status: 'ready'; caps: PilotCapabilities }
  | { status: 'degraded'; reason: 'missing' | 'malformed'; caps: PilotCapabilities }
  | { status: 'incompatible'; observedProtocolVersion: number }
  | { status: 'unauthorized' };

export class CapabilityParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityParseError';
  }
}

function asBool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') {
    throw new CapabilityParseError(`expected boolean at ${path}`);
  }
  return v;
}

function asStringArray(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
    throw new CapabilityParseError(`expected string[] at ${path}`);
  }
  return v as string[];
}

function numOrNull(v: unknown, path: string): number | null {
  if (v === null || v === undefined) {
    return null;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new CapabilityParseError(`expected number|null at ${path}`);
  }
  return v;
}

/**
 * Validate + normalize a raw capabilities body. Throws CapabilityParseError on
 * anything malformed — the caller must NOT partially trust a bad body.
 */
export function parseCapabilities(raw: unknown): PilotCapabilities {
  if (typeof raw !== 'object' || raw === null) {
    throw new CapabilityParseError('capabilities body is not an object');
  }
  const o = raw as Record<string, unknown>;

  if (typeof o.protocolVersion !== 'number' || !Number.isInteger(o.protocolVersion)) {
    throw new CapabilityParseError('missing/invalid protocolVersion');
  }
  const transport = o.chatTransport;
  if (transport !== 'sse' && transport !== 'ndjson' && transport !== 'buffered') {
    throw new CapabilityParseError('invalid chatTransport');
  }

  const rrr = (o.rejectResumeReplay ?? {}) as Record<string, unknown>;
  const corr = (o.correlation ?? {}) as Record<string, unknown>;
  const idem = (o.idempotency ?? {}) as Record<string, unknown>;
  const limits = (o.limits ?? {}) as Record<string, unknown>;

  return {
    protocolVersion: o.protocolVersion,
    serverVersion: typeof o.serverVersion === 'string' ? o.serverVersion : undefined,
    chatTransport: transport,
    streaming: asBool(o.streaming, 'streaming'),
    approvals: asBool(o.approvals, 'approvals'),
    rejectResumeReplay: {
      reject: asBool(rrr.reject, 'rejectResumeReplay.reject'),
      resume: asBool(rrr.resume, 'rejectResumeReplay.resume'),
      replay: asBool(rrr.replay, 'rejectResumeReplay.replay'),
    },
    cancellation: asBool(o.cancellation, 'cancellation'),
    correlation: {
      requestIdHeader:
        corr.requestIdHeader === null || corr.requestIdHeader === undefined
          ? null
          : String(corr.requestIdHeader),
      echoesRequestId: asBool(corr.echoesRequestId ?? false, 'correlation.echoesRequestId'),
    },
    idempotency: {
      supported: asBool(idem.supported ?? false, 'idempotency.supported'),
      keyHeader:
        idem.keyHeader === null || idem.keyHeader === undefined ? null : String(idem.keyHeader),
      scopes: idem.scopes === undefined ? [] : asStringArray(idem.scopes, 'idempotency.scopes'),
    },
    operationClasses: asStringArray(o.operationClasses ?? [], 'operationClasses'),
    limits: {
      maxRequestBytes: numOrNull(limits.maxRequestBytes, 'limits.maxRequestBytes'),
      maxRunDurationMs: numOrNull(limits.maxRunDurationMs, 'limits.maxRunDurationMs'),
      streamIdleTimeoutMs: numOrNull(limits.streamIdleTimeoutMs, 'limits.streamIdleTimeoutMs'),
      maxConcurrentRuns: numOrNull(limits.maxConcurrentRuns, 'limits.maxConcurrentRuns'),
    },
    deprecated: Array.isArray(o.deprecated)
      ? (o.deprecated as PilotCapabilities['deprecated'])
      : [],
    unavailable: Array.isArray(o.unavailable) ? asStringArray(o.unavailable, 'unavailable') : [],
  };
}

export function isProtocolCompatible(caps: PilotCapabilities): boolean {
  return caps.protocolVersion === SUPPORTED_PROTOCOL_VERSION;
}
