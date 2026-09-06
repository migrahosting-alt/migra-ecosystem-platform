/**
 * THE ROUTER GATHERS FACTS. IT DOES NOT DECIDE POLICY.
 *
 * ---------------------------------------------------------------------------
 * THE BOUNDARY THIS FILE EXISTS TO HOLD
 *
 * Every gate below is answered by an injected resolver and handed, unchanged, to
 * `decideToolInvocation`. The router contains no `if (!authorized) refuse`, no
 * "well, it's read-only so let it through", no shortcut for a tool it happens to
 * trust. If policy lived here as well as in the decider, the two would drift and
 * the answer to "who is allowed to do this?" would depend on which one you read.
 *
 * The one thing it DOES decide is how far to walk: resolvers are called in gate
 * order and it stops as soon as the decision is blocked. That is scheduling, not
 * policy — asking a connector whether an account is linked, for a capability the
 * platform cannot offer at all, is work nobody needs done.
 *
 * ---------------------------------------------------------------------------
 * WHY THE INPUT IS HASHED TWICE
 *
 * Consent is bound to an exact normalized input. Between the moment a user
 * approves and the moment the side effect runs, the request can change — a
 * recipient re-resolved, a path expanded, a default filled in. So the input is
 * normalized and hashed to REQUEST consent, and normalized and hashed again
 * immediately before execution; if the two disagree the approval is refused.
 *
 * The hash must be taken of the input that will ACTUALLY EXECUTE, not of the
 * request as it arrived. Hashing the raw request and executing the normalized
 * one would produce an approval that binds nothing.
 * ---------------------------------------------------------------------------
 */

import { createHash } from 'node:crypto';

import { toolManifest } from './toolManifest.js';
import {
  decideToolInvocation,
  type ConnectionState,
  type ConsentState,
  type PreflightState,
  type ToolDecision,
} from './toolDecision.js';

/** What the registry reports. Four distinct states, never collapsed to a boolean. */
export type CapabilityState = 'unknown' | 'ungranted' | 'backend_unavailable' | 'available';

export interface AuthorizationFact {
  authorized: boolean;
  /** session | workspace-role | entitlement | ownership | … Never a secret. */
  basis: string;
}

export interface ConnectionFact {
  state: ConnectionState;
  /** Which account is linked, for provenance. An address or handle, never a token. */
  identity?: string;
}

export interface PreflightFact {
  state: PreflightState;
  reason?: string;
}

export interface ConsentFact {
  state: ConsentState;
  approvalId?: string;
  inputHash?: string;
}

export interface RouterResolvers<TInput> {
  /** CapabilityRegistry: existence, grant, and runtime reachability. */
  capabilityState(capability: string, toolId: string): Promise<CapabilityState> | CapabilityState;
  /** Provider/account specific. Never overloaded into authorization. */
  connectionState(toolId: string): Promise<ConnectionFact> | ConnectionFact;
  /** The product's auth context, with an explicit basis. */
  authorization(toolId: string): Promise<AuthorizationFact> | AuthorizationFact;
  /**
   * The exact input that will execute. Normalization happens here so the hash
   * binds what runs, not what was asked for.
   */
  normalize(input: TInput): Promise<TInput> | TInput;
  /** Side-effect FREE. Schema, recipients, existence, limits, safe dry-run. */
  preflight(input: TInput): Promise<PreflightFact> | PreflightFact;
  /** toolApprovalStore, looked up for this exact input hash. */
  consent(toolId: string, inputHash: string): Promise<ConsentFact> | ConsentFact;
}

/**
 * A routing request.
 *
 * 🚨 IT CANNOT DECLARE MUTABILITY, and it cannot name its own capability. Both
 * come from the canonical manifest, looked up by `toolId`. The first shape of
 * this interface carried `mutating`, which meant a caller could skip the consent
 * gate by declaring itself read-only — a bypass with a polite name. What a
 * request may say is which tool, and with what input.
 */
export interface ToolRequest<TInput> {
  toolId: string;
  input: TInput;
}

/**
 * One evidence object per routing attempt.
 *
 * Every gate's raw finding, plus the decision computed from them. This is what a
 * UI renders and what a debugger reads, so the two can never disagree about
 * "can I use this?" — the failure of having five places each interpret the
 * question their own way.
 *
 * It carries no secrets and no internal identifiers beyond the tool's own id.
 */
export interface RoutedDecision<TInput> {
  decisionId: string;
  capabilityState: CapabilityState;
  connectionState: ConnectionFact;
  authorizationState: AuthorizationFact | null;
  preflightState: PreflightFact;
  consentState: ConsentFact;
  /** The normalized input, and the hash consent is bound to. */
  normalizedInput: TInput | null;
  inputHash: string | null;
  decision: ToolDecision;
}

/** Stable hash of the normalized input. Key order must not change the result. */
export function hashInput(input: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, canonical(val)]),
      );
    }
    return v;
  };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(input))).digest('hex')}`;
}

const UNRESOLVED_CONNECTION: ConnectionFact = { state: 'not_required' };
const UNRESOLVED_PREFLIGHT: PreflightFact = { state: 'not_run' };
const UNRESOLVED_CONSENT: ConsentFact = { state: 'absent' };

const fromCapabilityState = (s: CapabilityState) => ({
  registered: s !== 'unknown',
  grantHeld: s !== 'unknown' && s !== 'ungranted',
  backendAvailable: s === 'available',
});

/**
 * Resolve the four authorities, in gate order, and decide.
 *
 * Stops at the first blocked gate — so a capability the platform cannot offer
 * never triggers a connector lookup, and a user who is not authorized is never
 * asked to approve anything.
 */
export async function routeToolInvocation<TInput>(
  request: ToolRequest<TInput>,
  resolvers: RouterResolvers<TInput>,
  mkId: () => string = () => `dec_${createHash('sha256').update(String(Math.random())).digest('hex').slice(0, 12)}`,
): Promise<RoutedDecision<TInput>> {
  const decisionId = mkId();
  const { toolId } = request;

  /*
   * The manifest is consulted FIRST, and an unknown tool is refused rather than
   * defaulted. Treating an undeclared tool as read-only would reopen the bypass
   * this table exists to close, by a different road.
   */
  const manifest = toolManifest(toolId);
  if (!manifest) {
    return {
      decisionId,
      capabilityState: 'unknown',
      connectionState: UNRESOLVED_CONNECTION,
      authorizationState: null,
      preflightState: UNRESOLVED_PREFLIGHT,
      consentState: UNRESOLVED_CONSENT,
      normalizedInput: null,
      inputHash: null,
      decision: decideToolInvocation({
        capability: toolId,
        toolId,
        registered: false,
        grantHeld: false,
        backendAvailable: false,
        connection: 'not_required',
        userAuthorized: false,
        mutating: false,
      }),
    };
  }

  const capability = manifest.capability;
  const mutating = manifest.mutating;

  const capabilityState = await resolvers.capabilityState(capability, toolId);
  const caps = fromCapabilityState(capabilityState);

  const shell = (
    connection: ConnectionFact,
    authorization: AuthorizationFact | null,
    preflight: PreflightFact,
    consent: ConsentFact,
    normalizedInput: TInput | null,
    inputHash: string | null,
  ): RoutedDecision<TInput> => ({
    decisionId,
    capabilityState,
    connectionState: connection,
    authorizationState: authorization,
    preflightState: preflight,
    consentState: consent,
    normalizedInput,
    inputHash,
    decision: decideToolInvocation({
      capability,
      toolId,
      ...caps,
      connection: connection.state,
      userAuthorized: authorization?.authorized ?? false,
      ...(authorization?.basis ? { authorizationBasis: authorization.basis } : {}),
      preflight,
      mutating,
      ...(inputHash ? { inputHash } : {}),
      ...(mutating ? { consent } : {}),
    }),
  });

  // Gate 1 — the platform. No point asking anything else until it can offer this.
  if (capabilityState !== 'available') {
    return shell(UNRESOLVED_CONNECTION, null, UNRESOLVED_PREFLIGHT, UNRESOLVED_CONSENT, null, null);
  }

  // Gate 2 — connection. Provider/account specific, never authorization.
  const connection = await resolvers.connectionState(toolId);
  if (connection.state === 'not_connected') {
    return shell(connection, null, UNRESOLVED_PREFLIGHT, UNRESOLVED_CONSENT, null, null);
  }

  // Gate 3 — may this user, in this context.
  const authorization = await resolvers.authorization(toolId);
  if (!authorization.authorized) {
    return shell(connection, authorization, UNRESOLVED_PREFLIGHT, UNRESOLVED_CONSENT, null, null);
  }

  /*
   * Gate 4 — preflight, on the NORMALIZED input, before any consent is sought.
   * Normalizing first is what makes the hash bind what actually runs.
   */
  const normalized = await resolvers.normalize(request.input);
  const inputHash = hashInput(normalized);
  const preflight = await resolvers.preflight(normalized);
  if (preflight.state !== 'passed' && preflight.state !== 'not_required') {
    return shell(connection, authorization, preflight, UNRESOLVED_CONSENT, normalized, inputHash);
  }

  // Gate 5 — consent, for mutating tools only, bound to that exact hash.
  const consent = mutating
    ? await resolvers.consent(toolId, inputHash)
    : ({ state: 'not_required' } as ConsentFact);

  return shell(connection, authorization, preflight, consent, normalized, inputHash);
}

/**
 * Re-check, immediately before the side effect, that nothing moved.
 *
 * The window between "the user approved this" and "this runs" is short and not
 * empty. A recipient can be re-resolved, a default filled in, a path expanded.
 * Re-normalizing and re-hashing here is the only thing that makes the approval
 * mean what the user thought it meant.
 *
 * Returns the reason it must not proceed, or null when it may.
 */
export async function verifyUnchangedBeforeExecute<TInput>(
  routed: RoutedDecision<TInput>,
  resolvers: Pick<RouterResolvers<TInput>, 'normalize'>,
  originalRequestInput: TInput,
): Promise<string | null> {
  if (!routed.decision.executable) return routed.decision.reason ?? 'This action is not permitted to run.';
  const again = hashInput(await resolvers.normalize(originalRequestInput));
  if (again !== routed.inputHash) {
    return 'This action changed since you approved it, so it needs approving again.';
  }
  return null;
}
