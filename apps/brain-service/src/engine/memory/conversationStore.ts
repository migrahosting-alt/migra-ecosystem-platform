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
  saveConversation(c: Conversation): void;
  saveMessage(m: Message): void;
  saveSummary(s: Summary): void;
  deleteConversation(id: string): void;
  /** Optional workspace-memory persistence (a durable adapter provides it). */
  saveMemoryItem?(item: MemoryItem): void;
}

export const NOOP_PERSISTENCE: MemoryPersistence = {
  saveConversation() {},
  saveMessage() {},
  saveSummary() {},
  deleteConversation() {},
};

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

  /** Load durable state from persistence on startup (never re-persists what it
   * loads). Session/off conversations are not part of durable state. */
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
  createConversation(scope: Scope, params: { title?: string; memoryMode: MemoryMode; id?: string }): Conversation {
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
    this.conversations.set(c.id, c);
    this.messages.set(c.id, []);
    this.summaries.set(c.id, []);
    if (c.memoryMode === 'durable') this.persistence.saveConversation(c);
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

  renameConversation(id: string, scope: Scope, title: string): Conversation | undefined {
    const c = this.getConversation(id, scope);
    if (!c) return undefined;
    c.title = title.slice(0, 200);
    c.updatedAt = this.now();
    if (c.memoryMode === 'durable') this.persistence.saveConversation(c);
    return c;
  }

  /** Soft-delete + cascade: messages and summaries are dropped and the durable
   * adapter is told to remove the conversation. A deleted conversation can never
   * be reopened. */
  deleteConversation(id: string, scope: Scope): boolean {
    const c = this.getConversation(id, scope);
    if (!c) return false;
    c.deletedAt = this.now();
    this.messages.delete(id);
    this.summaries.delete(id);
    this.persistence.deleteConversation(id);
    return true;
  }

  // ── Messages (immutable) ─────────────────────────────────────────────────
  /** Append a message. Under `off` nothing is retained (returns null). Idempotent
   * per (requestId, role): a retried append returns the existing record rather
   * than duplicating. Callers MUST pass already-redacted content. */
  appendMessage(
    id: string,
    scope: Scope,
    msg: { role: MessageRole; content: string; status: MessageStatus; requestId?: string; modelId?: string; providerId?: string; supersedesId?: string },
  ): Message | null {
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
    list.push(record);
    this.messages.set(id, list);
    c.updatedAt = record.createdAt;
    if (record.durable) this.persistence.saveMessage(record);
    return record;
  }

  getMessages(id: string, scope: Scope, opts: { limit?: number; status?: MessageStatus } = {}): Message[] {
    if (!this.getConversation(id, scope)) return [];
    let list = this.messages.get(id) ?? [];
    if (opts.status) list = list.filter((m) => m.status === opts.status);
    return opts.limit ? list.slice(-opts.limit) : [...list];
  }

  // ── Summaries ────────────────────────────────────────────────────────────
  addSummary(id: string, scope: Scope, s: Omit<Summary, 'id' | 'conversationId' | 'createdAt' | 'version'>): Summary | null {
    const c = this.getConversation(id, scope);
    if (!c || c.memoryMode === 'off') return null;
    const list = this.summaries.get(id) ?? [];
    const version = list.length + 1;
    const record: Summary = { ...s, id: this.mkId('sum'), conversationId: id, version, createdAt: this.now() };
    list.push(record);
    this.summaries.set(id, list);
    if (c.memoryMode === 'durable') this.persistence.saveSummary(record);
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
