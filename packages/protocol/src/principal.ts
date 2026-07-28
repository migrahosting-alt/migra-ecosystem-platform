/**
 * MigraPilot protocol — OPERATOR PRINCIPAL: who is acting, established by a trusted
 * boundary rather than claimed by a caller.
 *
 * This exists because an override audit is worthless without it. "The operator approved
 * running a denied security review as untrusted advisory" means nothing if the operator id
 * came from the same request that asked for the override — a model able to write its own
 * principal could authorise itself, and a webview able to set one could be persuaded to.
 *
 * So the contract has one hard rule: A PRINCIPAL IS NEVER READ FROM THE REQUEST BODY. It is
 * established by the host process or an authenticated gateway, and anything a caller sends
 * is ignored rather than merged.
 *
 * The display name is deliberately separate from the durable identity. Names are mutable,
 * non-unique and locale-dependent; an audit trail that keys on one cannot survive a rename.
 */

/** How the principal was established. Not a preference — a statement about trust. */
export const AUTHENTICATION_METHODS = [
  /** Derived by the Brain from its own OS process context. Local, single-user. */
  'vscode-host',
  /** Asserted by an authenticated gateway that validated a credential. */
  'gateway',
  /** No trusted boundary produced one. Carries no authority whatsoever. */
  'unauthenticated',
] as const;

export type AuthenticationMethod = (typeof AUTHENTICATION_METHODS)[number];

export function isAuthenticationMethod(value: unknown): value is AuthenticationMethod {
  return typeof value === 'string' && (AUTHENTICATION_METHODS as readonly string[]).includes(value);
}

/**
 * The acting operator.
 *
 * `operatorId` is a STABLE, opaque identifier — `local:<hash>` for the host path, never a
 * display name and never a value a caller supplied.
 */
export interface OperatorPrincipal {
  operatorId: string;
  tenantId: string;
  authenticationMethod: AuthenticationMethod;
  sessionId: string;
  roles: readonly string[];
  /** Human-facing only. NEVER used as an identity or an audit key. */
  displayName?: string;
}

/**
 * True when this principal may be relied on for a governance decision.
 *
 * `unauthenticated` never can. An override recorded against an unauthenticated principal
 * would name nobody, which is worse than refusing the override — it produces a record that
 * looks like accountability and carries none.
 */
export function principalIsTrusted(p: OperatorPrincipal | undefined): boolean {
  return p !== undefined && p.authenticationMethod !== 'unauthenticated' && p.operatorId.length > 0;
}

/** The principal for a request no trusted boundary could identify. */
export function anonymousPrincipal(sessionId: string): OperatorPrincipal {
  return {
    operatorId: '',
    tenantId: 'unknown',
    authenticationMethod: 'unauthenticated',
    sessionId,
    roles: [],
  };
}

/**
 * Audit fields for a principal. Flat primitives, identity only.
 *
 * The display name is excluded on purpose: it is not the identity, and a durable record
 * that carries it invites keying on it later.
 */
export function principalAuditFields(p: OperatorPrincipal): Record<string, unknown> {
  return {
    operatorId: p.operatorId || '(none)',
    tenantId: p.tenantId,
    authenticationMethod: p.authenticationMethod,
    sessionId: p.sessionId,
    ...(p.roles.length > 0 ? { roles: [...p.roles] } : {}),
    principalTrusted: principalIsTrusted(p),
  };
}
