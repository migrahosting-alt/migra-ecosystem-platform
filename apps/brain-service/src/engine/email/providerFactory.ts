/**
 * CONSTRUCTING THE PROVIDER — from server-resolved state, and nothing else.
 *
 * ---------------------------------------------------------------------------
 * 🚨 THERE IS NO PARAMETER HERE THAT A BROWSER COULD FILL
 *
 * `mailProviderFor` takes a scope, a provider name, and its dependencies. It does
 * NOT take an access token, and it does not take an account address. Those come
 * out of the durable connection, opened with a key the process holds.
 *
 * This is structural on purpose. A factory that accepted an access token would
 * work identically for a legitimate caller and for a request that carried one,
 * and the difference would live in whether every route remembered not to pass
 * it through. Removing the parameter removes the question.
 *
 * ---------------------------------------------------------------------------
 * 🚨 A REQUESTED ACCOUNT IS A HINT, RE-VALIDATED — NEVER AN IDENTITY
 *
 * When a principal has connected more than one mailbox, the SERVER enumerates
 * the ones they own and the user picks. The picked value comes back through a
 * page we rendered, which is exactly why it is checked against ownership again
 * rather than trusted: a rendered list is not an authorisation, and the value
 * arrives over the same wire as anything else the client can type.
 *
 * An unrecognised request is not an error to report back either — saying "that
 * account is not yours" confirms the account exists. It resolves as though no
 * account was named.
 */

import type { Scope } from '../memory/conversationStore.js';

import type { MailConnectionStore } from './connectionStore.js';
import { GmailProvider } from './gmailProvider.js';
import {
  requireScope,
  resolveAuthorization,
  type RefreshDeps,
  type ResolvedAuthorization,
} from './tokenRefresh.js';
import type { EmailFailure, EmailProvider, EmailScopes } from './types.js';

/** One of a principal's connected accounts, as the server would offer it. */
export interface ConnectedAccount {
  providerAccountId: string;
  /** For display. The user recognises an address, not an opaque id. */
  accountAddress: string;
}

export type AccountSelection =
  | { kind: 'resolved'; providerAccountId: string }
  /** This principal has connected nothing for this provider. */
  | { kind: 'none' }
  /** Several, and none was named. The USER picks from this list. */
  | { kind: 'ambiguous'; accounts: ConnectedAccount[] };

/**
 * Decide which of a principal's mailboxes an operation means.
 *
 * 🚨 `requested` is matched against the list this scope owns. It is never used
 * to look anything up.
 */
export async function selectAccount(input: {
  scope: Scope;
  provider: string;
  store: MailConnectionStore;
  requested?: string;
}): Promise<AccountSelection> {
  const owned = await input.store.list(input.scope, input.provider);
  if (owned.length === 0) return { kind: 'none' };

  if (input.requested !== undefined) {
    const match = owned.find((c) => c.providerAccountId === input.requested);
    // Unrecognised: fall through to the ordinary rules rather than reporting a
    // mismatch, which would confirm that some other principal's account exists.
    if (match) return { kind: 'resolved', providerAccountId: match.providerAccountId };
  }

  if (owned.length === 1) return { kind: 'resolved', providerAccountId: owned[0]!.providerAccountId };

  return {
    kind: 'ambiguous',
    accounts: owned.map((c) => ({ providerAccountId: c.providerAccountId, accountAddress: c.accountAddress })),
  };
}

export interface ProviderFactoryDeps extends RefreshDeps {
  /**
   * The HTTP transport the provider uses.
   *
   * Injected for the same reason `exchangeRefresh` is: the read path is only
   * provable end-to-end if a test can decide what the provider answers. Absent
   * means the real network, which is what production leaves it as.
   */
  transport?: typeof globalThis.fetch;
  /** Provider API base. Overridden only by tests; production leaves it unset. */
  providerBaseUrl?: string;
  /**
   * False when the deployment has no OAuth client or no sealing key. Distinct
   * from "this user has not connected": one is an operator's problem and the
   * other is the user's next action.
   */
  providerConfigured: boolean;
}

export type ProviderResolution =
  | { ok: true; provider: EmailProvider; account: ConnectedAccount; scopes: EmailScopes }
  | { ok: false; failure: EmailFailure }
  /** The user must choose. Not a failure — an answerable question. */
  | { ok: false; choose: ConnectedAccount[] };

/**
 * Build a provider bound to one resolved connection.
 *
 * Named `mailProviderFor`, not `providerFor`: in this codebase that bare name
 * means "hands a caller a live MODEL adapter", and an architecture guard keys
 * on it to require admission control. Squatting on the name would have made
 * this file look like an ungated GPU path — so the guard stays keyed on a name
 * that means one thing.
 *
 * Every failure path returns before a provider exists, so there is no state in
 * which a provider is holding an unusable or someone else's credential.
 */
export async function mailProviderFor(input: {
  scope: Scope;
  provider: string;
  deps: ProviderFactoryDeps;
  /** A hint from a server-rendered list. Re-validated; never trusted. */
  requestedAccountId?: string;
  /** When given, the grant must permit this before a provider is returned. */
  needs?: keyof EmailScopes;
}): Promise<ProviderResolution> {
  if (!input.deps.providerConfigured) {
    return { ok: false, failure: { kind: 'not_configured', detail: 'Email is not set up yet.' } };
  }

  const selection = await selectAccount({
    scope: input.scope,
    provider: input.provider,
    store: input.deps.store,
    requested: input.requestedAccountId,
  });

  if (selection.kind === 'none') {
    return { ok: false, failure: { kind: 'not_connected', detail: 'Email is not connected yet.' } };
  }
  if (selection.kind === 'ambiguous') return { ok: false, choose: selection.accounts };

  const authorization = await resolveAuthorization({
    scope: input.scope,
    provider: input.provider,
    providerAccountId: selection.providerAccountId,
    deps: input.deps,
  });
  if (!authorization.ok) return { ok: false, failure: authorization.failure };

  /*
   * 🚨 The scope check happens BEFORE the provider is built, so a caller cannot
   * hold a provider it is not permitted to use and discover that only at
   * dispatch — which for send means after the user has composed and approved.
   */
  if (input.needs) {
    const permitted = requireScope(authorization.value, input.needs);
    if (!permitted.ok) return { ok: false, failure: permitted.failure };
  }

  return {
    ok: true,
    provider: buildProvider(input.provider, authorization.value, input.deps.now, {
      ...(input.deps.transport ? { fetch: input.deps.transport } : {}),
      ...(input.deps.providerBaseUrl ? { baseUrl: input.deps.providerBaseUrl } : {}),
    }),
    account: {
      providerAccountId: authorization.value.providerAccountId,
      accountAddress: authorization.value.accountAddress,
    },
    scopes: authorization.value.scopes,
  };
}

/**
 * The one place a provider is constructed from an authorization.
 *
 * Gmail is the first backend, never the contract: the product's surface is
 * `EmailProvider`, and adding a second provider is a case here rather than a
 * change anywhere a mailbox is used.
 */
function buildProvider(
  provider: string,
  authorization: ResolvedAuthorization,
  now: () => number,
  wire: { fetch?: typeof globalThis.fetch; baseUrl?: string } = {},
): EmailProvider {
  switch (provider) {
    case 'gmail':
      return new GmailProvider(
        {
          accessToken: authorization.accessToken,
          accountAddress: authorization.accountAddress,
          scopes: authorization.scopes,
          ...wire,
        },
        now,
      );
    default:
      /*
       * Refused rather than defaulted. Silently building a Gmail provider for
       * an unknown name would connect a user to the wrong service, and the
       * symptom would be an empty mailbox rather than an error.
       */
      throw new Error(`no email provider is registered for ${JSON.stringify(provider)}`);
  }
}
