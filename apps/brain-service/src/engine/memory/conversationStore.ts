/**
 * MigraAI Engine — layered conversation memory store.
 *
 * Distinct layers, NOT one history blob: conversation messages, compressed
 * summaries, and scoped memory items (workspace facts / user preferences). Every
 * access is scoped to (owner, workspace) and enforced HERE — memory never crosses
 * a workspace or tenant boundary. Messages are immutable (a correction is a new
 * record). Deleting a conversation cascades to its messages + summaries.
 *
 * Retention follows the conversation's `memoryMode`:
 *   off      → nothing is retained
 *   session  → retained in process memory (lost on restart)
 *   durable  → retained + written through a {@link MemoryPersistence} adapter
 *
 * Redaction happens at the boundary (callers pass already-redacted content); the
 * store additionally refuses to retain anything under `off`.
 */

export type MemoryMode = 'off' | 'session' | 'durable';

export interface Scope {
  owner: string;
  workspace: string;
}

export interface Conversation {
  id: string;
  ownerScope: string;
  workspaceScope: string;
  title: string;
  memoryMode: MemoryMode;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
  /**
   * Files this conversation answers from, by library filename.
   *
   * Lives on the CONVERSATION because that is what the user experiences: they
   * attached a file to this thread, and a reload must not change what the thread
   * knows. It was previously a React ref in the browser, so refreshing the page
   * silently dropped grounding and the same question started answering "I don't
   * have access to external documents" with the earlier answers still on screen.
   */
  groundingFiles?: string[];
  /**
   * Content-addressed image refs this conversation is currently about.
   *
   * SEPARATE FROM `groundingFiles`. Those are searchable documents and drive
   * retrieval; these drive vision, reconcile against a different store, and mean
   * something different when one goes missing.
   *
   * Durable for the same reason grounding is: a follow-up asked after a reload
   * carries no upload, so the thread has to remember which picture it is about —
   * otherwise the second question is answered about nothing while looking like
   * it worked. Refs only; base64 is transport for a single turn.
   */
  imageRefs?: string[];
}

export type MessageRole = 'user' | 'assistant' | 'system';
export type MessageStatus = 'complete' | 'partial' | 'failed';

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  requestId?: string;
  modelId?: string;
  providerId?: string;
  createdAt: number;
  durable: boolean;
  /** For corrections: the message this one supersedes (originals are never edited). */
  supersedesId?: string;
}

export interface SummaryBody {
  confirmedFacts: string[];
  decisions: string[];
  questions: string[];
  projectState: string[];
  nextActions: string[];
}

export interface Summary {
  id: string;
  conversationId: string;
  sourceFromMessageId: string;
  sourceToMessageId: string;
  summary: SummaryBody;
  version: number;
  createdAt: number;
}

export interface MemoryItem {
  id: string;
  scope: { owner?: string; workspace?: string };
  category: 'workspace-fact' | 'user-preference' | 'convention' | 'architecture';
  content: string;
  confidence: number;
  sourceType: string;
  sourceId?: string;
  expiresAt?: number;
  createdAt: number;
}

/** Write-through persistence for `durable` conversations. The default is a no-op
 * (in-memory only); a disk/DB adapter can back it without changing the store. */
export interface MemoryPersistence {
  saveConversation(c: Conversation): Promise<void>;
  /**
   * SCOPE IS CARRIED, NOT RECOVERED.
   *
   * A `Message` has no owner/workspace of its own, and under PostgreSQL the
   * scope cannot be looked up from the parent conversation either: the
   * conversation tables run FORCE ROW LEVEL SECURITY whose policies read
   * `migrapilot.owner_scope`, so a connection that has not yet declared its
   * scope sees NOTHING. Reading the parent to learn the scope would require
   * BYPASSRLS or a SECURITY DEFINER lookup — punching a hole through the exact
   * boundary that makes cross-tenant reads impossible.
   *
   * So the caller passes the scope it already holds, and PostgreSQL
   * independently rejects any row that disagrees with it (`WITH CHECK`). A
   * mislabelled write fails at the database instead of being stored under the
   * wrong tenant — a stronger guarantee than an application-side lookup.
   */
  saveMessage(m: Message, scope: Scope): Promise<void>;
  saveSummary(s: Summary, scope: Scope): Promise<void>;
  /**
   * Scope is carried for the same reason the writes above carry it: under FORCE
   * row-level security a DELETE with no declared scope matches ZERO rows and
   * reports success. A durable delete that silently did nothing would resurrect
   * the conversation on the next restart.
   */
  deleteConversation(id: string, scope: Scope): Promise<void>;
  /** Optional workspace-memory persistence (a durable adapter provides it). */
  saveMemoryItem?(item: MemoryItem): Promise<void>;
}

/**
 * The no-op adapter. It is NOT a durable store and must never satisfy a durable
 * write — see {@link ConversationStore.commit}, which refuses rather than
 * letting this one silently "succeed".
 */
export const NOOP_PERSISTENCE: MemoryPersistence = {
  async saveConversation() {},
  async saveMessage() {},
  async saveSummary() {},
  async deleteConversation() {},
};

/**
 * A durable write that was NOT committed.
 *
 * WHY THIS IS AN ERROR AND NOT A DOWNGRADE. The canary caught the Brain
 * answering `{ok:true, stored:true, durable:true}` for a `memoryMode: durable`
 * write while the state database was unreadable. After recovery that
 * conversation was gone, while durable data written before the failure survived
 * intact — so the acknowledgement had been false, and the loss was silent.
 *
 * Quietly demoting a durable write to session memory would be the same lie with
 * a softer name: the caller asked for data that outlives the process and would
 * still be told "stored". A caller who is told the truth can retry, warn a user,
 * or refuse to proceed. One that is told a comforting fiction cannot.
 */
export class PersistenceUnavailableError extends Error {
  readonly code = 'PERSISTENCE_UNAVAILABLE';
  constructor(
    /** The store operation that was refused, for the audit line. */
    readonly operation: string,
    options?: { cause?: unknown },
  ) {
    super(`Durable persistence is unavailable: ${operation} was not committed.`, options);
    this.name = 'PersistenceUnavailableError';
  }
}

const DEFAULT_TTL = 24 * 60 * 60_000;
const MAX_CONVERSATIONS = 1000;

export class ConversationStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<string, Message[]>();
  private readonly summaries = new Map<string, Summary[]>();
  private readonly memoryItems: MemoryItem[] = [];

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: (p: string) => string = defaultId,
    private readonly persistence: MemoryPersistence = NOOP_PERSISTENCE,
    private readonly ttlMs = DEFAULT_TTL,
  ) {}

  /**
   * Commit a durable write, or refuse it. THE acknowledgement gate.
   *
   * `durable: true` is returned ONLY after persistence has actually committed.
   * Two distinct ways a durable write can be a lie, and both are closed here:
   *
   *  1. **The adapter fails.** An unreadable or unwritable database throws, and
   *     that used to be invisible: `MemoryPersistence` declared these methods
   *     `void` while the real adapter returns `Promise<void>`, and TypeScript's
   *     void-return bivariance accepts that silently. The promise was dropped —
   *     rejection and all — so the store never learned the write had failed.
   *     The contract now returns `Promise<void>` and this awaits it.
   *
   *  2. **There is no durable adapter at all.** `server.ts` sets `durable` to
   *     undefined when persistence is selected but unwired, which lands
   *     {@link NOOP_PERSISTENCE} here — and a no-op "succeeds" every time. A
   *     durable write against it is refused outright.
   *
   * The commit result is the ONLY authority. `/health` reports persistence
   * readiness accurately and could reject some writes earlier, but it is a
   * second source of truth about the same fact, and a write that passed a health
   * check can still fail. Nothing here is acknowledged on a prediction.
   */
  private async commit(operation: string, write: () => Promise<void>): Promise<void> {
    if (this.persistence === NOOP_PERSISTENCE) {
      throw new PersistenceUnavailableError(operation);
    }
    try {
      await write();
    } catch (cause) {
      throw new PersistenceUnavailableError(operation, { cause });
    }
  }

  /** Load durable state from persistence on startup (never re-persists what it
   * loads). Session/off conversations are not part of durable state. */
  /** Scopes already loaded from durable storage. Keyed owner\u0000workspace. */
  private readonly hydratedScopes = new Set<string>();

  /**
   * Load ONE scope's durable state, once.
   *
   * Startup used to hydrate every conversation in the database. That is invalid
   * under PostgreSQL row-level security: a connection with no declared scope
   * sees zero rows, so a global load would have booted an apparently empty Brain
   * while every row sat safe in the database.
   *
   * So hydration follows the request. Each scoped entry point calls this before
   * reading, the scope is loaded at most once, and one tenant's load never
   * populates another's cache — the cache key is the scope pair itself.
   *
   * Idempotent and safe to call on every request: the Set makes the second call
   * free.
   */
  async ensureScopeHydrated(scope: Scope): Promise<void> {
    const key = `${scope.owner}\u0000${scope.workspace}`;
    if (this.hydratedScopes.has(key)) return;

    const source = this.persistence as { loadDurableForScope?: (s: Scope) => Promise<{ conversations: Conversation[]; messages: Message[]; summaries: Summary[] }> };
    if (typeof source.loadDurableForScope !== 'function') {
      // A store without scoped loading (the in-memory default) has nothing to
      // hydrate. Marking it done keeps the call free rather than retrying.
      this.hydratedScopes.add(key);
      return;
    }

    // Marked BEFORE awaiting so concurrent requests for the same scope do not
    // each issue a load; the second caller proceeds against the same cache the
    // first is filling, which is the existing behaviour for a warm scope.
    this.hydratedScopes.add(key);
    try {
      const state = await source.loadDurableForScope(scope);
      this.hydrate(state);
    } catch (error) {
      // A failed load must not leave the scope marked as loaded — the next
      // request would then read an empty cache and report no conversations.
      this.hydratedScopes.delete(key);
      throw error;
    }
  }

  /**
   * Forget everything cached for one scope, so the next read re-loads it.
   *
   * THIS EXISTS BECAUSE THE CLAIM WRITES BEHIND THIS CACHE. Moving an anonymous
   * conversation into an account is a direct scoped transaction in PostgreSQL —
   * it has to be, because row-level security's `WITH CHECK` will not let a row
   * be rewritten into a scope other than the declared one. So the rows move and
   * this cache does not hear about it, and the result is the worst kind of
   * failure: the transfer reports success while BOTH sides still see the old
   * world. The visitor keeps reading a conversation that is no longer theirs,
   * and the account never sees the one it was just given.
   *
   * Measured on production before this existed: a claim answered
   * `claimed: true`, the anonymous cookie was revoked, and the conversation was
   * a 404 for the account and a 200 for the visitor whose authority had just
   * been taken away.
   *
   * Eviction rather than a targeted patch: the database is the authority, and
   * re-reading it cannot disagree with itself. A hand-maintained second copy of
   * the move would be a third place for the truth to live.
   *
   * The conversations are dropped from the maps BEFORE the hydration flag is
   * cleared, because `hydrate` appends to the message arrays — re-loading a
   * scope whose rows were left behind would duplicate every message in it.
   */
  evictScope(scope: Scope): void {
    for (const [id, conversation] of this.conversations) {
      if (conversation.ownerScope !== scope.owner || conversation.workspaceScope !== scope.workspace) continue;
      this.conversations.delete(id);
      this.messages.delete(id);
      this.summaries.delete(id);
    }
    this.hydratedScopes.delete(`${scope.owner}\u0000${scope.workspace}`);
  }

  hydrate(data: { conversations: Conversation[]; messages: Message[]; summaries: Summary[]; memoryItems?: MemoryItem[] }): void {
    for (const c of data.conversations) {
      this.conversations.set(c.id, c);
      if (!this.messages.has(c.id)) this.messages.set(c.id, []);
      if (!this.summaries.has(c.id)) this.summaries.set(c.id, []);
    }
    for (const m of data.messages) {
      if (this.conversations.has(m.conversationId)) (this.messages.get(m.conversationId) ?? []).push(m);
    }
    for (const s of data.summaries) {
      if (this.conversations.has(s.conversationId)) (this.summaries.get(s.conversationId) ?? []).push(s);
    }
    for (const item of data.memoryItems ?? []) this.memoryItems.push(item);
  }

  // ── Conversations ────────────────────────────────────────────────────────
  async createConversation(scope: Scope, params: { title?: string; memoryMode: MemoryMode; id?: string }): Promise<Conversation> {
    const t = this.now();
    // An explicit id lets the engine RE-ADOPT a client's still-referenced
    // conversationId after in-memory `session` state was lost (e.g. a brain
    // restart), so the client's stored id stays valid and forward turns accumulate
    // memory. Only honoured when the id is unused and shaped like our own ids.
    const reuse = params.id && /^conv_[a-z0-9]{6,}$/i.test(params.id) && !this.conversations.has(params.id) ? params.id : undefined;
    const c: Conversation = {
      id: reuse ?? this.mkId('conv'),
      ownerScope: scope.owner,
      workspaceScope: scope.workspace,
      title: params.title ?? 'New conversation',
      memoryMode: params.memoryMode,
      createdAt: t,
      updatedAt: t,
    };
    // ORDER IS THE ROLLBACK. Persist first: a refused durable write must leave no
    // conversation behind, and there is nothing to undo if it never existed.
    if (c.memoryMode === 'durable') await this.commit('createConversation', () => this.persistence.saveConversation(c));
    this.conversations.set(c.id, c);
    this.messages.set(c.id, []);
    this.summaries.set(c.id, []);
    if (this.conversations.size > MAX_CONVERSATIONS) {
      const oldest = this.conversations.keys().next().value;
      if (oldest) this.hardDelete(oldest);
    }
    return c;
  }

  /** Fetch a conversation ONLY when the scope matches — cross-workspace or
   * cross-owner access returns undefined (isolation enforced at the store). */
  getConversation(id: string, scope: Scope): Conversation | undefined {
    const c = this.conversations.get(id);
    if (!c || c.deletedAt || c.ownerScope !== scope.owner || c.workspaceScope !== scope.workspace) {
      return undefined;
    }
    return c;
  }

  listConversations(scope: Scope): Conversation[] {
    return [...this.conversations.values()]
      .filter((c) => !c.deletedAt && c.ownerScope === scope.owner && c.workspaceScope === scope.workspace)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async renameConversation(id: string, scope: Scope, title: string): Promise<Conversation | undefined> {
    const c = this.getConversation(id, scope);
    if (!c) return undefined;
    // The adapter persists the conversation OBJECT, so the new value has to be on
    // it before the commit — which makes reverting the only honest failure path.
    const previous = { title: c.title, updatedAt: c.updatedAt };
    c.title = title.slice(0, 200);
    c.updatedAt = this.now();
    if (c.memoryMode === 'durable') {
      try {
        await this.commit('renameConversation', () => this.persistence.saveConversation(c));
      } catch (error) {
        Object.assign(c, previous);
        throw error;
      }
    }
    return c;
  }

  /**
   * Replace the conversation's grounding set.
   *
   * The whole set is sent rather than add/remove deltas: a client that retries or
   * races cannot end up with a set nobody chose, and "what is this thread grounded
   * in" has exactly one answer at any moment.
   */
  async setGroundingFiles(id: string, scope: Scope, files: string[]): Promise<Conversation | undefined> {
    const c = this.getConversation(id, scope);
    if (!c) return undefined;
    // Bounded, de-duplicated, order preserved. Names come from the caller's own
    // library; anything empty or absurdly long is not a filename.
    const cleaned = [...new Set(files.filter((f) => typeof f === 'string' && f.length > 0 && f.length <= 255))].slice(0, 50);
    const previous = { groundingFiles: c.groundingFiles, updatedAt: c.updatedAt };
    c.groundingFiles = cleaned;
    c.updatedAt = this.now();
    if (c.memoryMode === 'durable') {
      try {
        await this.commit('setGroundingFiles', () => this.persistence.saveConversation(c));
      } catch (error) {
        // A grounding set the store could not persist would answer the next turn
        // from documents this thread will not remember choosing.
        Object.assign(c, previous);
        throw error;
      }
    }
    return c;
  }

  /**
   * Replace the conversation's image set.
   *
   * A MIRROR OF `setGroundingFiles`, not a reuse of it. Images and documents
   * reconcile against different stores and a missing one means something
   * different in each, so sharing a column would make every reader guess which
   * kind of name it was holding.
   *
   * Refs are validated to the content-addressed shape here as well as at intake:
   * this is the last place before durable state, and a ref that is not an id
   * cannot resolve to bytes on any later turn.
   */
  async setImageRefs(id: string, scope: Scope, refs: string[]): Promise<Conversation | undefined> {
    const c = this.getConversation(id, scope);
    if (!c) return undefined;
    const cleaned = [...new Set(refs.filter((r) => typeof r === 'string' && /^img_[0-9a-f]{32}$/.test(r)))].slice(0, 8);
    const previous = { imageRefs: c.imageRefs, updatedAt: c.updatedAt };
    c.imageRefs = cleaned;
    c.updatedAt = this.now();
    if (c.memoryMode === 'durable') {
      try {
        await this.commit('setImageRefs', () => this.persistence.saveConversation(c));
      } catch (error) {
        // An image set the store could not persist would leave the next turn
        // answering about a picture this thread will not remember.
        Object.assign(c, previous);
        throw error;
      }
    }
    return c;
  }

  /** Soft-delete + cascade: messages and summaries are dropped and the durable
   * adapter is told to remove the conversation. A deleted conversation can never
   * be reopened. */
  async deleteConversation(id: string, scope: Scope): Promise<boolean> {
    const c = this.getConversation(id, scope);
    if (!c) return false;
    // A durable delete that does not commit is the defect inverted: the
    // conversation disappears from the UI and returns after a restart. The
    // caller is told, so it can report the deletion as incomplete.
    if (c.memoryMode === 'durable') {
      await this.commit('deleteConversation', () => this.persistence.deleteConversation(id, scope));
    } else {
      // Best-effort for non-durable conversations: nothing was promised to disk,
      // so a no-op adapter refusing is not a failure worth propagating.
      await this.persistence.deleteConversation(id, scope).catch(() => undefined);
    }
    c.deletedAt = this.now();
    this.messages.delete(id);
    this.summaries.delete(id);
    return true;
  }

  // ── Messages (immutable) ─────────────────────────────────────────────────
  /** Append a message. Under `off` nothing is retained (returns null). Idempotent
   * per (requestId, role): a retried append returns the existing record rather
   * than duplicating. Callers MUST pass already-redacted content. */
  async appendMessage(
    id: string,
    scope: Scope,
    msg: { role: MessageRole; content: string; status: MessageStatus; requestId?: string; modelId?: string; providerId?: string; supersedesId?: string },
  ): Promise<Message | null> {
    const c = this.getConversation(id, scope);
    if (!c) return null;
    if (c.memoryMode === 'off') return null;

    const list = this.messages.get(id) ?? [];
    if (msg.requestId) {
      const existing = list.find((m) => m.requestId === msg.requestId && m.role === msg.role);
      if (existing) return existing;
    }
    const record: Message = {
      id: this.mkId('msg'),
      conversationId: id,
      role: msg.role,
      content: msg.content,
      status: msg.status,
      requestId: msg.requestId,
      modelId: msg.modelId,
      providerId: msg.providerId,
      supersedesId: msg.supersedesId,
      createdAt: this.now(),
      durable: c.memoryMode === 'durable',
    };
    Object.freeze(record);
    // Persist before the message is visible in memory: a durable message that
    // failed to commit must not be readable until a restart quietly loses it.
    if (record.durable) await this.commit('appendMessage', () => this.persistence.saveMessage(record, scope));
    list.push(record);
    this.messages.set(id, list);
    c.updatedAt = record.createdAt;
    return record;
  }

  getMessages(id: string, scope: Scope, opts: { limit?: number; status?: MessageStatus } = {}): Message[] {
    if (!this.getConversation(id, scope)) return [];
    let list = this.messages.get(id) ?? [];
    if (opts.status) list = list.filter((m) => m.status === opts.status);
    return opts.limit ? list.slice(-opts.limit) : [...list];
  }

  // ── Summaries ────────────────────────────────────────────────────────────
  async addSummary(id: string, scope: Scope, s: Omit<Summary, 'id' | 'conversationId' | 'createdAt' | 'version'>): Promise<Summary | null> {
    const c = this.getConversation(id, scope);
    if (!c || c.memoryMode === 'off') return null;
    const list = this.summaries.get(id) ?? [];
    const version = list.length + 1;
    const record: Summary = { ...s, id: this.mkId('sum'), conversationId: id, version, createdAt: this.now() };
    if (c.memoryMode === 'durable') await this.commit('addSummary', () => this.persistence.saveSummary(record, scope));
    list.push(record);
    this.summaries.set(id, list);
    return record;
  }

  getSummaries(id: string, scope: Scope): Summary[] {
    if (!this.getConversation(id, scope)) return [];
    return [...(this.summaries.get(id) ?? [])];
  }

  getLatestSummary(id: string, scope: Scope): Summary | undefined {
    const list = this.getSummaries(id, scope);
    return list[list.length - 1];
  }

  // ── Memory items (workspace facts / user preferences) ────────────────────
  addMemoryItem(item: Omit<MemoryItem, 'id' | 'createdAt'>): MemoryItem {
    const record: MemoryItem = { ...item, id: this.mkId('mem'), createdAt: this.now() };
    this.memoryItems.push(record);
    this.persistence.saveMemoryItem?.(record);
    return record;
  }

  /** Workspace memory for a scope — never returns another workspace's items. */
  getWorkspaceMemories(scope: Scope, limit = 8): MemoryItem[] {
    const t = this.now();
    return this.memoryItems
      .filter((m) => m.scope.workspace === scope.workspace && (!m.expiresAt || m.expiresAt > t))
      .sort((a, b) => b.confidence - a.confidence || b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  private hardDelete(id: string): void {
    this.conversations.delete(id);
    this.messages.delete(id);
    this.summaries.delete(id);
  }
}

function defaultId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 26);
}
