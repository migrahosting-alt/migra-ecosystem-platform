/**
 * MigraAI Engine — establishing the operator principal at a trusted boundary.
 *
 * The identity is DERIVED, never accepted. For the local VS Code path the Brain computes it
 * from its own OS process context — the same user that launched the process — so there is no
 * input for a webview, a prompt or a model to influence. For a future gateway path the
 * assertion is honoured only when the gateway proves itself with a shared secret that the
 * caller cannot read.
 *
 * The failure this prevents is specific. An override audit that reads
 * `body.operatorId` records whatever the requester typed, which means a model asking to
 * bypass a denial can also sign the bypass. That record would look like accountability and
 * contain none — worse than having no record, because it would be trusted.
 */

import { createHash, randomUUID } from 'node:crypto';
import { hostname, userInfo } from 'node:os';
import {
  anonymousPrincipal,
  isAuthenticationMethod,
  type AuthenticationMethod,
  type OperatorPrincipal,
} from '@migrapilot/protocol';

/** Header a trusted gateway uses to assert a principal, plus the secret that proves it. */
export const GATEWAY_PRINCIPAL_HEADER = 'x-migrapilot-principal';
export const GATEWAY_SECRET_HEADER = 'x-migrapilot-gateway-secret';

/** Fields a caller might try to send. Every one of them is IGNORED. */
export const NEVER_TRUSTED_INPUT_FIELDS = [
  'operatorId',
  'operator_id',
  'principal',
  'tenantId',
  'roles',
  'authenticationMethod',
  'sessionId',
] as const;

export interface PrincipalSources {
  /** Request headers. Only the gateway pair is ever consulted, and only with the secret. */
  headers?: Record<string, string | string[] | undefined>;
  /** Environment, for the gateway secret. */
  env?: Record<string, string | undefined>;
  /** Injected for tests; defaults to the real OS process context. */
  hostIdentity?: () => { uid: number; user: string; host: string };
  newSessionId?: () => string;
}

function realHostIdentity(): { uid: number; user: string; host: string } {
  const info = userInfo();
  return { uid: typeof info.uid === 'number' ? info.uid : -1, user: info.username, host: hostname() };
}

/**
 * A stable, opaque local id.
 *
 * Hashed rather than plain so an audit trail carries no username or hostname — those are
 * environment detail, and the identity only needs to be stable and comparable. Truncated to
 * 16 hex chars: enough to distinguish users of one workstation, short enough to read.
 */
export function localOperatorId(identity: { uid: number; user: string; host: string }): string {
  const digest = createHash('sha256').update(`${identity.uid}:${identity.user}:${identity.host}`).digest('hex');
  return `local:${digest.slice(0, 16)}`;
}

function headerValue(headers: PrincipalSources['headers'], name: string): string | undefined {
  const raw = headers?.[name];
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Establish the principal for this request.
 *
 * Resolution order, most trusted first:
 *
 *  1. A gateway assertion WITH a matching `MIGRAPILOT_GATEWAY_SECRET`. Without the secret
 *     the header is discarded — an unauthenticated header is exactly the spoofing vector
 *     this function exists to close, so it is not treated as a hint.
 *  2. The local host identity, derived from this process. Always available on the VS Code
 *     path, and unforgeable by anything that talks to the Brain over HTTP.
 *
 * The request body is not a source and is never consulted.
 */
export function resolveOperatorPrincipal(sources: PrincipalSources = {}): OperatorPrincipal {
  const newSessionId = sources.newSessionId ?? (() => randomUUID());
  const sessionId = newSessionId();

  const asserted = headerValue(sources.headers, GATEWAY_PRINCIPAL_HEADER);
  const presented = headerValue(sources.headers, GATEWAY_SECRET_HEADER);
  const expected = sources.env?.MIGRAPILOT_GATEWAY_SECRET?.trim();

  if (asserted) {
    // A gateway assertion is honoured ONLY with a matching secret. Anything else is a
    // caller claiming an identity, which is the whole thing being prevented.
    if (!expected || !presented || presented !== expected) {
      return anonymousPrincipal(sessionId);
    }
    const parsed = parseAssertion(asserted, sessionId);
    if (parsed) return parsed;
    return anonymousPrincipal(sessionId);
  }

  const identity = (sources.hostIdentity ?? realHostIdentity)();
  return {
    operatorId: localOperatorId(identity),
    tenantId: 'local',
    authenticationMethod: 'vscode-host',
    sessionId,
    roles: ['operator'],
  };
}

/** Parse a gateway assertion. Malformed ⇒ anonymous, never partially trusted. */
function parseAssertion(raw: string, sessionId: string): OperatorPrincipal | undefined {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  const operatorId = typeof o['operatorId'] === 'string' ? o['operatorId'] : '';
  const tenantId = typeof o['tenantId'] === 'string' ? o['tenantId'] : '';
  if (!operatorId || !tenantId) return undefined;
  const method: AuthenticationMethod = isAuthenticationMethod(o['authenticationMethod'])
    ? (o['authenticationMethod'] as AuthenticationMethod)
    : 'gateway';
  // A gateway may not assert `vscode-host`: that method means "derived from this process",
  // and a remote assertion of it would be a lie about how the identity was obtained.
  const safeMethod: AuthenticationMethod = method === 'vscode-host' ? 'gateway' : method;
  return {
    operatorId,
    tenantId,
    authenticationMethod: safeMethod,
    sessionId: typeof o['sessionId'] === 'string' && o['sessionId'] ? o['sessionId'] : sessionId,
    roles: Array.isArray(o['roles']) ? o['roles'].filter((r): r is string => typeof r === 'string') : [],
    ...(typeof o['displayName'] === 'string' ? { displayName: o['displayName'] } : {}),
  };
}
