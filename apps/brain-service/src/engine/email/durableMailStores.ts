/**
 * The mail stores, backed by whichever canonical adapter is configured.
 *
 * 🚨 THE ADAPTER IS ASKED, NEVER ITS CLASS — the same rule the project binding
 * exists to enforce, after `instanceof SqliteDurableStore` put production on an
 * in-memory store where a connection would have vanished on the next restart
 * with no error.
 *
 * There is deliberately no in-memory branch. A store that cannot persist a
 * mail connection does not get a degraded one: the feature is refused upstream
 * and the reason is logged. For a mailbox that matters more than for a project
 * binding — a connection that silently disappears means the user reconnects
 * their email after every deploy, and the consent screen they keep seeing
 * teaches them the product is broken.
 */

import type { Scope } from '../memory/conversationStore.js';
import type {
  MailConnectionPersistence,
  MailPendingPersistence,
  SealedTokenValue,
} from '../persistence/types.js';

import type { MailConnectionRecord, MailConnectionStore } from './connectionStore.js';
import type { PendingAuthorizationStore, PendingRecord } from './pendingAuthorization.js';
import type { SealedValue } from './tokenSealing.js';

export function durableMailConnections(store: MailConnectionPersistence): MailConnectionStore {
  return {
    async list(scope: Scope, provider: string): Promise<MailConnectionRecord[]> {
      return (await store.listMailConnections(scope, provider)) as MailConnectionRecord[];
    },
    async get(scope, provider, providerAccountId) {
      return (await store.getMailConnection(scope, provider, providerAccountId)) as MailConnectionRecord | null;
    },
    async put(record) {
      await store.putMailConnection(record, { owner: record.ownerScope, workspace: record.workspaceScope });
    },
    async recordRefresh(input) {
      await store.recordMailRefresh({ ...input, sealedAccessToken: input.sealedAccessToken as SealedTokenValue });
    },
    async markAuthorizationRevoked(input) {
      await store.markMailAuthorizationRevoked(input);
    },
    async disconnect(scope, provider, providerAccountId) {
      return store.deleteMailConnection(scope, provider, providerAccountId);
    },
  };
}

export function durableMailPending(store: MailPendingPersistence): PendingAuthorizationStore {
  return {
    async put(record: PendingRecord): Promise<void> {
      await store.putMailPending(record);
    },
    async take(stateHash: string): Promise<PendingRecord | null> {
      return (await store.takeMailPending(stateHash)) as PendingRecord | null;
    },
    async pruneOlderThan(cutoff: number): Promise<number> {
      return store.pruneMailPending(cutoff);
    },
  };
}

/** Narrowing helper kept next to its one use, so the cast has a home. */
export type { SealedValue };
