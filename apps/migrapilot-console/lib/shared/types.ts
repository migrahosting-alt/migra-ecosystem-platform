export type RunnerType = "local" | "server";
export type ExecutionEnvironment = "dev" | "stage" | "staging" | "prod" | "test";

export interface OperatorIdentity {
  operatorId: string;
  role: string;
  claims?: Record<string, unknown>;
}

export interface RunOverlay {
  toolName: string;
  env: ExecutionEnvironment;
  runnerType: RunnerType;
  baseTier: number;
  effectiveTier: number;
  executionScope: "local" | "server" | "both";
  abacDecision: "allow" | "deny";
  abacReason: string;
  budgetsConsumed: {
    writes?: number;
    commands?: number;
  };
  journalEntryId?: string;
  jobId?: string;
}

export interface ToolExecutionRequest {
  toolName: string;
  input: Record<string, unknown>;
  environment: ExecutionEnvironment;
  runnerType: RunnerType;
  operator: OperatorIdentity;
  runId?: string;
  autonomyBudgetId?: string;
  humanKeyTurnCode?: string;
}

export interface ToolExecutionResult {
  ok: boolean;
  data: Record<string, unknown>;
  warnings: string[];
  error: null | {
    code: string;
    message: string;
    retryable: boolean;
  };
  journalEntryId?: string;
  verification?: Record<string, unknown>;
  rollback?: Record<string, unknown>;
}

export interface TimelineRun {
  id: string;
  createdAt: string;
  status: "running" | "completed" | "failed" | "denied";
  overlay: RunOverlay;
  input: Record<string, unknown>;
  output?: ToolExecutionResult;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  proposedToolCalls?: Array<{ toolName: string; input: Record<string, unknown> }>;
  /* ── Enterprise fields ── */
  pinned?: boolean;
  editedAt?: string | null;
  parentId?: string | null;
  reactions?: ReactionGroup[];
  bookmarked?: boolean;
  metadata?: MessageMetadata | null;
}

/** Aggregated reaction group for a single emoji */
export interface ReactionGroup {
  emoji: string;
  count: number;
  userReacted: boolean;
}

/** Per-message metadata: token cost, timing, model info */
export interface MessageMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  costUsd?: number;
  provider?: string;
  model?: string;
  durationMs?: number;
}

export interface ConversationRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
  /* ── Enterprise fields ── */
  title?: string | null;
  archived?: boolean;
  pinned?: boolean;
  tags?: string[];
  counts?: {
    messages: number;
    reactions: number;
    bookmarks: number;
  };
  lastMessage?: { role: string; preview: string; createdAt: string } | null;
  lastRun?: { model: string; totalTokens: number; status: string } | null;
}

/** Bookmark entry returned from the API */
export interface BookmarkEntry {
  id: string;
  conversationId: string;
  messageId: string;
  label?: string | null;
  note?: string | null;
  createdAt: string;
  message?: ChatMessage;
  conversation?: { id: string; title?: string | null };
}

/** Slash command definition */
export interface SlashCommand {
  name: string;
  description: string;
  category: string;
  args?: string;
}

/** Conversation usage / cost summary */
export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  runs: number;
  toolCalls: number;
  successfulTools: number;
  failedTools: number;
  estimatedCostUsd: number;
}

/** Keyboard shortcut definition */
export interface KeyboardShortcut {
  keys: string;            // e.g. "Ctrl+Enter"
  description: string;
  action: string;          // handler identifier
  scope?: "global" | "input" | "message";
}

export interface ApprovalRecord {
  id: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  toolName: string;
  runId: string;
  summary: string;
  risk: string;
  humanKeyTurnCode?: string;
  request: ToolExecutionRequest;
}
