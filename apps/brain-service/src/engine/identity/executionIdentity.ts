/**
 * THE GOVERNED EXECUTION IDENTITY — who a run is acting as.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHY THIS TYPE EXISTS
 *
 * The autonomous tool loop carried NO identity. Every connected-account
 * capability was therefore denied inside it — which reads as "not available"
 * and never as a bug, because a denial is exactly what a correct system does
 * when it cannot tell who is asking.
 *
 * The tempting fix is to hand the agent the mailbox: an account id, a token, a
 * resolved provider. That creates a SECOND authorization path — one that does
 * not re-check the connection, cannot observe a disconnect, and answers to
 * whatever the model was given rather than to whoever is signed in.
 *
 * So the agent is given identity and nothing else. It carries who you are; the
 * capability executor independently resolves what that principal may currently
 * do, on every call, exactly as the HTTP path does.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT MAY NEVER BE IN HERE
 *
 * No provider account id. No access or refresh token. No resolved connection,
 * no readiness snapshot, and nothing supplied by a browser. Each of those
 * would let a run keep acting on state that has since changed — a disconnected
 * mailbox being the case that matters, because the whole point of
 * disconnecting is that the next read fails.
 *
 * `executionIdentityTest.ts` asserts the SHAPE, because a comment cannot stop
 * a field being added.
 */

/**
 * Immutable, minimal, and derived server-side.
 *
 * Named `principalId`/`workspaceId` rather than `owner`/`workspace` because
 * this is the AUTHORIZATION identity, not a data-ownership scope — the two
 * happen to coincide today and there is exactly one function below that
 * converts between them.
 */
export interface ExecutionIdentity {
  readonly principalId: string;
  readonly workspaceId: string;
}

/**
 * Derive an execution identity from a server-side scope.
 *
 * 🚨 FROZEN. A run's identity must not be mutable after it is established: a
 * long-running loop that could rewrite its own principal mid-run is the same
 * defect as taking identity from the model, reached more slowly.
 *
 * Refuses empty parts rather than producing an identity that authorizes
 * nothing in particular. An empty string is not a narrower principal — it is
 * an unknown one, and unknown must fail closed.
 */
export function executionIdentityFrom(
  scope: { owner: string; workspace: string } | null | undefined,
): ExecutionIdentity | null {
  const principalId = scope?.owner?.trim();
  const workspaceId = scope?.workspace?.trim();
  if (!principalId || !workspaceId) return null;
  return Object.freeze({ principalId, workspaceId });
}

/**
 * The executor's principal shape, from a governed identity.
 *
 * THE ONLY CONVERSION. Two names for one fact is a drift risk, so it is
 * spent in one function rather than at every call site.
 */
export function principalScopeOf(identity: ExecutionIdentity): { owner: string; workspace: string } {
  return { owner: identity.principalId, workspace: identity.workspaceId };
}
