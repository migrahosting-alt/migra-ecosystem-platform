// Structured error taxonomy for pilot-api transport (see
// docs/pilot-api-integration-plan.md §6 and docs/pilot-api-capabilities.v1.md).
// Every backend failure normalizes into a PilotError so the UI layer can map a
// code → user message + action, and so a remote failure is NEVER silently
// rendered as local-stub output.

export type PilotErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'NOT_READY'
  | 'TIMEOUT'
  | 'RATE_LIMITED'
  | 'CAPABILITY_MISSING'
  | 'CAPABILITY_MALFORMED'
  | 'CAPABILITY_INCOMPATIBLE'
  | 'INVALID_STATE'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'CANCELLED';

export interface PilotErrorInit {
  httpStatus?: number;
  retriable?: boolean;
  requestId?: string;
  cause?: unknown;
}

export class PilotError extends Error {
  readonly code: PilotErrorCode;
  readonly httpStatus?: number;
  readonly retriable: boolean;
  readonly requestId?: string;
  override readonly cause?: unknown;

  constructor(code: PilotErrorCode, message: string, init: PilotErrorInit = {}) {
    super(message);
    this.name = 'PilotError';
    this.code = code;
    this.httpStatus = init.httpStatus;
    this.retriable = init.retriable ?? false;
    this.requestId = init.requestId;
    this.cause = init.cause;
  }
}

export function isPilotError(value: unknown): value is PilotError {
  return value instanceof PilotError;
}

/** User-facing message for a code (§6 table). Never includes the requestId —
 * that goes to the output channel for support correlation, not the toast. */
export function toUserMessage(code: PilotErrorCode): string {
  switch (code) {
    case 'AUTH_REQUIRED':
      return 'MigraPilot needs to sign in to the Pilot service.';
    case 'AUTH_INVALID':
      return 'Your Pilot token is invalid or expired.';
    case 'NOT_READY':
      return 'Pilot service is starting or its database is unavailable.';
    case 'TIMEOUT':
      return "The Pilot service didn't respond in time.";
    case 'RATE_LIMITED':
      return 'Pilot is rate-limiting requests; retrying shortly.';
    case 'CAPABILITY_MISSING':
      return "This action isn't supported by the connected Pilot version.";
    case 'CAPABILITY_MALFORMED':
      return 'The Pilot service returned an unreadable capability response.';
    case 'CAPABILITY_INCOMPATIBLE':
      return 'The Pilot service speaks an incompatible protocol version.';
    case 'INVALID_STATE':
      return 'This action can no longer be changed — it was already decided or has expired.';
    case 'NETWORK':
      return 'Could not reach the Pilot service.';
    case 'SERVER_ERROR':
      return 'Pilot hit an internal error.';
    case 'CANCELLED':
      return '';
  }
}

/** Suggested UI action for a code (consumed by the command/notification layer). */
export function suggestedAction(code: PilotErrorCode): 'set-token' | 'retry' | 'repair' | 'show-logs' | 'none' {
  switch (code) {
    case 'AUTH_REQUIRED':
    case 'AUTH_INVALID':
      return 'set-token';
    case 'NOT_READY':
    case 'TIMEOUT':
    case 'RATE_LIMITED':
      return 'retry';
    case 'NETWORK':
      return 'repair';
    case 'SERVER_ERROR':
      return 'show-logs';
    case 'CAPABILITY_MISSING':
    case 'CAPABILITY_MALFORMED':
    case 'CAPABILITY_INCOMPATIBLE':
    case 'INVALID_STATE':
    case 'CANCELLED':
      return 'none';
  }
}
