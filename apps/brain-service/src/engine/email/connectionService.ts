/**
 * CONNECTING A MAILBOX — begin, complete, report, disconnect.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THE ACCOUNT IDENTITY COMES FROM THE GRANT, NOT FROM THE REQUEST
 *
 * After the code is exchanged, the server asks the provider who the token
 * belongs to. Nothing about which account was connected is taken from the
 * browser — not the address, not the id. A flow that recorded a client-supplied
 * address would let someone label their own mailbox as a colleague's, and every
 * screen afterwards would agree with the label.
 *
 * ---------------------------------------------------------------------------
 * 🚨 WHAT `disconnect` DOES, AND WHAT IT HONESTLY CANNOT
 *
 * It deletes our stored authorization. It does NOT revoke the grant at Google
 * unless the provider revoke call succeeds — and that call can fail while the
 * deletion succeeds.
 *
 * So the order is: revoke first, delete second. If revocation fails we still
 * delete, because leaving a row the user asked to remove is worse — but the
 * result SAYS the grant may still be live at the provider and names where to
 * remove it. Reporting a clean disconnection we did not achieve is the one
 * outcome that would leave someone believing their mail is disconnected when
 * it is not.
 */

import type { Scope } from '../memory/conversationStore.js';

import {
  refusalForGrant,
  scopesFromGranted,
  type MailConnectionRecord,
  type MailConnectionStore,
  type StoreRefusal,
} from './connectionStore.js';
import {
  authorizationUrl,
  completeCallback,
  mintState,
  safeReturnTo,
  type CallbackRefusal,
  type PendingAuthorization,
  type TokenGrant,
} from './oauthFlow.js';
import { hashState, type PendingAuthorizationStore } from './pendingAuthorization.js';
import type { GrantKind, OAuthConfig } from './oauthConfig.js';
import { open, seal, type SealKey } from './tokenSealing.js';
import type { EmailConnection } from './types.js';

/** Who a granted token actually belongs to, per the provider. */
export interface ProviderIdentity {
  providerAccountId: string;
  accountAddress: string;
}

export interface ConnectionServiceDeps {
  config: OAuthConfig;
  key: SealKey;
  connections: MailConnectionStore;
  pending: PendingAuthorizationStore;
  /** Server-side code exchange. Carries the client secret. */
  exchange(code: string): Promise<TokenGrant>;
  /** Server-side identity lookup. The ONLY source of the account identity. */
  identify(accessToken: string): Promise<ProviderIdentity>;
  /** Best-effort provider-side revocation. Resolves false when it did not. */
  revoke(refreshToken: string): Promise<boolean>;
  now(): number;
}

export interface BeginResult {
  authorizationUrl: string;
}

/**
 * Start a connection.
 *
 * The state is minted here, hashed for storage, and sent in the clear only to
 * the browser and Google. `returnTo` is validated as a same-site path BEFORE it
 * is persisted, so an open redirect cannot be stored and replayed later.
 */
export async function beginConnection(input: {
  scope: Scope;
  provider: string;
  grants: readonly GrantKind[];
  returnTo?: string;
  loginHint?: string;
  deps: ConnectionServiceDeps;
}): Promise<BeginResult> {
  const state = mintState();
  await input.deps.pending.put({
    stateHash: hashState(state),
    ownerScope: input.scope.owner,
    workspaceScope: input.scope.workspace,
    provider: input.provider,
    grants: [...input.grants],
    // Validated at MINT time, not at redirect time: a hostile value must never
    // reach storage, where a later change to the redirect path would trust it.
    returnTo: safeReturnTo(input.returnTo),
    createdAt: input.deps.now(),
  });

  return {
    authorizationUrl: authorizationUrl({
      config: input.deps.config,
      state,
      grants: input.grants,
      ...(input.loginHint ? { loginHint: input.loginHint } : {}),
    }),
  };
}

export type CompleteResult =
  | { ok: true; returnTo: string; account: ProviderIdentity }
  | { ok: false; refusal: CallbackRefusal }
  | { ok: false; storeRefusal: StoreRefusal };

/**
 * Complete a callback.
 *
 * The order of checks lives in `completeCallback` and is not repeated here:
 * everything decidable without contacting Google happens first, so a forged
 * callback costs nothing and reveals nothing.
 */
export async function completeConnection(input: {
  scope: Scope;
  state: string | undefined;
  code: string | undefined;
  error: string | undefined;
  deps: ConnectionServiceDeps;
}): Promise<CompleteResult> {
  const { deps } = input;

  // Hashed before it touches storage or a comparison. The value in the
  // database and the value derived from the request are then two
  // independently produced things, which is what makes comparing them mean
  // something.
  const stateHash = input.state ? hashState(input.state) : undefined;

  let takenProvider: string | null = null;

  const completion = await completeCallback({
    state: stateHash,
    code: input.code,
    error: input.error,
    ownerScope: input.scope.owner,
    deps: {
      takePending: async (hash) => {
        const row = await deps.pending.take(hash);
        if (!row) return null;
        // The provider is read from the ROW, never from the callback request:
        // otherwise a callback could redirect a completed grant into a
        // different provider's slot.
        takenProvider = row.provider;
        const pending: PendingAuthorization = {
          state: row.stateHash,
          ownerScope: row.ownerScope,
          grants: row.grants,
          createdAt: row.createdAt,
          returnTo: row.returnTo,
        };
        return pending;
      },
      exchange: deps.exchange,
      now: deps.now,
    },
  });

  if (!completion.ok) return { ok: false, refusal: completion.refusal };

  const grant = completion.grant;

  /*
   * 🚨 Refused BEFORE anything is stored. A grant with no refresh token would
   * become a connection that works for an hour and then asks to be reconnected
   * forever, indistinguishable from a real revocation.
   */
  const refusal = refusalForGrant({
    hasRefreshToken: typeof grant.refreshToken === 'string' && grant.refreshToken.length > 0,
    grantedScopes: grant.grantedScopes,
  });
  if (refusal) return { ok: false, storeRefusal: refusal };

  // The provider says whose mailbox this is. The browser is not consulted.
  const identity = await deps.identify(grant.accessToken);

  const provider = takenProvider ?? 'gmail';
  const at = deps.now();
  const record: MailConnectionRecord = {
    ownerScope: input.scope.owner,
    workspaceScope: input.scope.workspace,
    provider,
    providerAccountId: identity.providerAccountId,
    accountAddress: identity.accountAddress,
    sealedAccessToken: seal(deps.key, binding(input.scope, provider, identity, 'access_token'), grant.accessToken),
    sealedRefreshToken: seal(deps.key, binding(input.scope, provider, identity, 'refresh_token'), grant.refreshToken!),
    accessTokenExpiresAt: grant.expiresAt,
    grantedScopes: grant.grantedScopes,
    authorizationRevokedAt: null,
    connectedAt: at,
    lastRefreshAt: null,
    updatedAt: at,
  };
  await deps.connections.put(record);

  return { ok: true, returnTo: safeReturnTo(completion.pending.returnTo), account: identity };
}

function binding(scope: Scope, provider: string, identity: ProviderIdentity, purpose: 'access_token' | 'refresh_token') {
  return {
    ownerScope: scope.owner,
    workspaceScope: scope.workspace,
    provider,
    providerAccountId: identity.providerAccountId,
    purpose,
  } as const;
}

/**
 * What the UI is told about a connection.
 *
 * Never a token, never a scope string, never a provider error code — those
 * describe the machinery to someone who asked about their mail.
 */
export async function connectionStatus(input: {
  scope: Scope;
  provider: string;
  providerConfigured: boolean;
  connections: MailConnectionStore;
  now(): number;
}): Promise<EmailConnection> {
  const checkedAt = new Date(input.now()).toISOString();
  if (!input.providerConfigured) {
    return {
      state: 'not_configured',
      scopes: { read: false, draft: false, send: false },
      reason: 'Email is not set up yet.',
      checkedAt,
    };
  }

  const owned = await input.connections.list(input.scope, input.provider);
  const record = owned[0];
  if (!record) {
    return {
      state: 'not_connected',
      scopes: { read: false, draft: false, send: false },
      reason: 'Email is not connected yet.',
      checkedAt,
    };
  }

  if (record.authorizationRevokedAt !== null) {
    /*
     * 🚨 No `account` field. Showing the address of a mailbox we can no longer
     * read implies access we do not have.
     */
    return {
      state: 'authorization_expired',
      scopes: { read: false, draft: false, send: false },
      reason: 'Your email account needs reconnecting.',
      checkedAt,
    };
  }

  return {
    state: 'connected',
    account: record.accountAddress,
    scopes: scopesFromGranted(record.grantedScopes),
    checkedAt,
  };
}

export interface DisconnectResult {
  removed: boolean;
  /**
   * True when we could not confirm the grant was withdrawn at the provider.
   * The user is told where to remove it themselves — reporting a clean
   * disconnection we did not achieve is the one outcome that leaves someone
   * believing their mail is disconnected when it is not.
   */
  mayRemainAtProvider: boolean;
}

/**
 * Disconnect an account this principal owns.
 *
 * Revoke first, delete second. A deletion without an attempted revocation
 * leaves a live grant at Google that nothing in this product can ever reach
 * again — invisible to the user and to us.
 */
export async function disconnectConnection(input: {
  scope: Scope;
  provider: string;
  providerAccountId: string;
  deps: Pick<ConnectionServiceDeps, 'connections' | 'key' | 'revoke'>;
}): Promise<DisconnectResult> {
  const record = await input.deps.connections.get(input.scope, input.provider, input.providerAccountId);
  if (!record) return { removed: false, mayRemainAtProvider: false };

  let revoked = false;
  const opened = openRefresh(input.deps.key, record);
  if (opened !== null) {
    try {
      revoked = await input.deps.revoke(opened);
    } catch {
      // A failed revocation must not stop the deletion the user asked for.
      revoked = false;
    }
  }

  const removed = await input.deps.connections.disconnect(input.scope, input.provider, input.providerAccountId);
  return { removed, mayRemainAtProvider: !revoked };
}

/** An unopenable token still permits deletion; it just cannot be revoked. */
function openRefresh(key: SealKey, record: MailConnectionRecord): string | null {
  const result = open(
    key,
    {
      ownerScope: record.ownerScope,
      workspaceScope: record.workspaceScope,
      provider: record.provider,
      providerAccountId: record.providerAccountId,
      purpose: 'refresh_token' as const,
    },
    record.sealedRefreshToken,
  );
  return result.ok ? result.value : null;
}
