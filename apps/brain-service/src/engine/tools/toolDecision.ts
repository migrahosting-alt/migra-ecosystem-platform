/**
 * CAN THIS USER RUN THIS TOOL, RIGHT NOW — one answer, computed in one place.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A PURE FUNCTION AND NOT A METHOD ON ANYTHING
 *
 * Four authorities answer four different questions, and the failure this module
 * exists to prevent is any one of them inferring another's answer:
 *
 *   CapabilityRegistry  can the platform truthfully offer this capability now?
 *   product auth        may THIS user invoke it in THIS context?
 *   toolApprovalStore   did the user consent to THIS EXACT mutating action?
 *   the invocation      did it actually execute?
 *
 * So this takes their answers as INPUTS and returns a decision. It cannot call
 * the registry, cannot read a session, cannot mint an approval, and cannot
 * execute — which means it cannot quietly substitute one layer's verdict for
 * another's. The invariants below are then properties of a value, checkable
 * without a running system.
 *
 *   registered   never implies   available
 *   available    never implies   authorized
 *   authorized   never implies   consented
 *   consented    never implies   succeeded
 *
 * The last one is why `executable: true` is phrased as *may be attempted*, never
 * as *will work*. Execution is the runtime's fact to report, not this layer's to
 * predict.
 *
 * ---------------------------------------------------------------------------
 * CONNECTION IS NOT AVAILABILITY, AND NOT AUTHORIZATION
 *
 * Gmail can be registered, granted, and perfectly healthy while this user has
 * simply never linked an account. That is not "unavailable" (the platform is
 * fine) and not "unauthorized" (they are allowed to use it). Rendering it as
 * either one tells the user something false and offers them no way forward. It
 * is its own state, and it carries its own action: **Connect Gmail**.
 * ---------------------------------------------------------------------------
 */

/** Which authority blocked. Exactly one, so a UI never has to guess. */
export type BlockedAt =
  | 'registry:unknown'
  | 'registry:no-grant'
  | 'registry:backend-unavailable'
  | 'connection:not-connected'
  | 'authorization:denied'
  | 'preflight:failed'
  | 'preflight:not-run'
  | 'consent:required'
  | 'consent:invalid';

/**
 * Whether the user's account is linked to whatever the tool acts on.
 *
 * `not_required` is the common case — a calculator has no account to connect.
 * Keeping it explicit stops "no connection recorded" from being read as "not
 * connected", which would put a Connect button under a tool that has nothing to
 * connect to.
 */
export type ConnectionState = 'not_required' | 'connected' | 'not_connected';

/**
 * The state of consent for one exact mutating invocation.
 *
 * `mismatched` is the one that matters most: an approval bound to a different
 * input is not a weaker approval, it is a different approval. If the recipient,
 * amount, path, branch, command or payload changed after the user said yes, the
 * thing they agreed to no longer exists.
 */
export type ConsentState =
  | 'not_required'
  | 'absent'
  | 'pending'
  | 'valid'
  | 'expired'
  | 'consumed'
  | 'mismatched';

/**
 * Whether the side-effect-free checks have run, and what they found.
 *
 * `not_run` is a state, not an absence. A mutating tool that reaches the consent
 * gate without preflight would ask the user to approve an action already known
 * to fail — so "nobody ran it" is reported as a fault rather than waved through,
 * which is what silently defaulting to `passed` would do.
 */
export type PreflightState = 'not_required' | 'not_run' | 'passed' | 'failed';

export interface ToolDecisionInput {
  capability: string;
  toolId: string;

  /** From CapabilityRegistry — does this capability exist at all? */
  registered: boolean;
  /** From CapabilityRegistry — is the platform grant held? */
  grantHeld: boolean;
  /**
   * From CapabilityRegistry — is the backend/connector actually reachable NOW?
   *
   * Runtime truth, not catalog existence. A capability the UI rendered ten
   * seconds ago can be unavailable by the time it is clicked, and saying so is
   * the honest outcome.
   */
  backendAvailable: boolean;

  /** From the product's connector state. `not_required` when there is nothing to link. */
  connection: ConnectionState;

  /** From the product's auth context — session, account, role, entitlement, membership. */
  userAuthorized: boolean;
  /** Why authorization was decided as it was, for provenance. Never a secret. */
  authorizationBasis?: string;

  /**
   * Side-effect-free validation: schema, recipients, existence, limits, dry-run
   * where safe. Runs BEFORE consent so the user is never asked to approve an
   * action that was going to fail for a knowable reason.
   */
  preflight?: { state: PreflightState; reason?: string };

  /** Does this tool mutate anything? Read-only tools take no consent path. */
  mutating: boolean;
  /** From toolApprovalStore, for THIS invocation's exact input. */
  consent?: { state: ConsentState; approvalId?: string; inputHash?: string };
  /** The hash of the input about to be executed. */
  inputHash?: string;
}

export interface ToolDecision {
  capability: string;
  toolId: string;

  registered: boolean;
  /** Grant held AND backend reachable. Never inferred from `registered`. */
  platformAvailable: boolean;
  connection: ConnectionState;
  userAuthorized: boolean;
  preflightState: PreflightState;
  requiresConsent: boolean;
  consentState: ConsentState;

  /**
   * Every gate passed, so the invocation MAY BE ATTEMPTED.
   *
   * Not a prediction that it will succeed — that is the runtime's to report.
   */
  executable: boolean;

  /** Set only when `executable` is false. Exactly one layer, never a guess. */
  blockedAt?: BlockedAt;
  /** One sentence a user can act on. Never an internal identifier. */
  reason?: string;
  /**
   * What the UI should offer instead of running it: `connect`, `request-access`,
   * `consent`, or nothing when the block is not the user's to clear.
   */
  action?: 'connect' | 'request-access' | 'consent' | 'retry-later';

  /** Carried into the audit record; see `provenanceOf`. */
  authorizationBasis?: string;
  approvalId?: string;
  inputHash?: string;
}

const block = (
  input: ToolDecisionInput,
  blockedAt: BlockedAt,
  reason: string,
  action?: ToolDecision['action'],
  over: Partial<ToolDecision> = {},
): ToolDecision => ({
  capability: input.capability,
  toolId: input.toolId,
  registered: input.registered,
  platformAvailable: input.registered && input.grantHeld && input.backendAvailable,
  connection: input.connection,
  userAuthorized: input.userAuthorized,
  preflightState: input.preflight?.state ?? 'not_run',
  requiresConsent: input.mutating,
  consentState: input.mutating ? (input.consent?.state ?? 'absent') : 'not_required',
  executable: false,
  blockedAt,
  reason,
  ...(action ? { action } : {}),
  ...(input.authorizationBasis ? { authorizationBasis: input.authorizationBasis } : {}),
  ...(input.consent?.approvalId ? { approvalId: input.consent.approvalId } : {}),
  ...(input.inputHash ? { inputHash: input.inputHash } : {}),
  ...over,
});

/**
 * Decide, in the fixed order the authorities are layered.
 *
 * The order is load-bearing. Asking "may this user?" about a capability the
 * platform cannot offer produces a denial that blames the user for a platform
 * fact; asking for consent before validating produces a dialog for an action
 * that was going to fail anyway. Each gate runs only once the one above it has
 * passed, and the first failure is the reported one.
 */
export function decideToolInvocation(input: ToolDecisionInput): ToolDecision {
  const label = input.capability;

  if (!input.registered) {
    return block(input, 'registry:unknown', `${label} is not a capability MigraPilot offers.`);
  }
  if (!input.grantHeld) {
    // Deliberate platform state, not a fault. It reads that way to the user.
    return block(input, 'registry:no-grant', `${label} is not enabled on this platform yet.`);
  }
  if (!input.backendAvailable) {
    /*
     * RUNTIME TRUTH. A capability can be listed and granted and still be
     * unreachable this second — the connector is down, the model host is
     * offline. Saying "unavailable right now" is honest; letting the click
     * proceed and inventing a success is the failure being prevented.
     */
    return block(
      input,
      'registry:backend-unavailable',
      `${label} is temporarily unavailable — its service is not reachable right now.`,
      'retry-later',
    );
  }
  if (input.connection === 'not_connected') {
    /*
     * NOT unavailable and NOT unauthorized. The platform is fine and the user is
     * allowed; they simply have no account linked. The only useful thing to show
     * is the way to fix it.
     */
    return block(input, 'connection:not-connected', `Connect your account to use ${label}.`, 'connect');
  }
  if (!input.userAuthorized) {
    return block(
      input,
      'authorization:denied',
      `You do not have access to ${label} in this workspace.`,
      'request-access',
    );
  }

  /*
   * PREFLIGHT, BEFORE CONSENT. Asking someone to approve a transfer to an
   * address that does not exist, or a push to a branch that is protected, spends
   * their attention on a decision that cannot matter. Everything knowable
   * without a side effect is settled first.
   */
  const preflight = input.preflight?.state ?? 'not_run';
  if (preflight === 'failed') {
    return block(input, 'preflight:failed', input.preflight?.reason ?? `${label} cannot run with these inputs.`);
  }
  if (preflight === 'not_run') {
    /*
     * A fault, reported rather than assumed away. Defaulting to `passed` here
     * would let a caller skip validation by simply not mentioning it — the same
     * shape as an exception clause in a truthfulness directive.
     */
    return block(input, 'preflight:not-run', `${label} could not be checked before running.`);
  }

  if (input.mutating) {
    const consent = input.consent?.state ?? 'absent';
    if (consent === 'valid') {
      /*
       * Bound to the EXACT input. An approval whose hash no longer matches is not
       * a weaker approval — it is an approval for something else.
       */
      const bound =
        input.consent?.inputHash !== undefined &&
        input.inputHash !== undefined &&
        input.consent.inputHash === input.inputHash;
      if (!bound) {
        return block(
          input,
          'consent:invalid',
          `This action changed since you approved it, so it needs approving again.`,
          'consent',
          { consentState: 'mismatched' },
        );
      }
    } else {
      const reason =
        consent === 'expired'
          ? 'That approval has expired. Approve it again to continue.'
          : consent === 'consumed'
            ? 'That approval was already used. Approve it again to continue.'
            : consent === 'mismatched'
              ? 'This action changed since you approved it, so it needs approving again.'
              : consent === 'pending'
                ? 'Waiting for you to approve this action.'
                : 'This action needs your approval before it can run.';
      return block(input, consent === 'absent' || consent === 'pending' ? 'consent:required' : 'consent:invalid', reason, 'consent');
    }
  }

  return {
    capability: input.capability,
    toolId: input.toolId,
    registered: true,
    platformAvailable: true,
    connection: input.connection,
    userAuthorized: true,
    preflightState: preflight,
    requiresConsent: input.mutating,
    consentState: input.mutating ? 'valid' : 'not_required',
    executable: true,
    ...(input.authorizationBasis ? { authorizationBasis: input.authorizationBasis } : {}),
    ...(input.consent?.approvalId ? { approvalId: input.consent.approvalId } : {}),
    ...(input.inputHash ? { inputHash: input.inputHash } : {}),
  };
}

export interface ToolProvenance {
  capability: string;
  toolId: string;
  authorizationBasis: string | null;
  approvalId: string | null;
  inputHash: string | null;
  invocationId: string;
  decidedAt: string;
  /** Filled by the runtime AFTER the attempt — never predicted here. */
  outcome: 'attempted';
}

/**
 * The record that travels with an invocation.
 *
 * `outcome` is fixed at `attempted` on purpose. This layer decided the call may
 * be tried; whether it worked is a fact only the runtime holds, and a decision
 * object that pre-declares success is how "consented" quietly becomes
 * "succeeded".
 */
export function provenanceOf(decision: ToolDecision, invocationId: string, now = () => Date.now()): ToolProvenance {
  return {
    capability: decision.capability,
    toolId: decision.toolId,
    authorizationBasis: decision.authorizationBasis ?? null,
    approvalId: decision.approvalId ?? null,
    inputHash: decision.inputHash ?? null,
    invocationId,
    decidedAt: new Date(now()).toISOString(),
    outcome: 'attempted',
  };
}
