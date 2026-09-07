/**
 * The binding store, backed by whichever canonical adapter is configured.
 *
 * 🚨 THE ADAPTER IS ASKED, NEVER ITS CLASS. This exists so no caller writes
 * `instanceof SqliteDurableStore` again — the mistake that put production on an
 * in-memory binding store, where a connected project would have vanished on the
 * next restart with no error.
 *
 * There is deliberately no in-memory branch here. A store that cannot persist a
 * binding does not get a degraded one; the feature is refused upstream and the
 * reason is logged, because a connection that silently disappears is worse than
 * one that was never offered.
 */
import type { ProjectBindingPersistence } from '../persistence/types.js';
import type { Scope } from '../memory/conversationStore.js';
import type { ProjectBinding, ProjectBindingStore } from './projectBinding.js';

export function durableProjectBindings(store: ProjectBindingPersistence): ProjectBindingStore {
  return {
    async get(conversationId: string, scope: Scope): Promise<ProjectBinding | null> {
      return store.getProjectBinding(conversationId, scope);
    },
    async bind(binding: ProjectBinding, scope: Scope): Promise<void> {
      await store.bindProject(binding, scope);
    },
    async unbind(conversationId: string, scope: Scope): Promise<void> {
      await store.unbindProject(conversationId, scope);
    },
  };
}
