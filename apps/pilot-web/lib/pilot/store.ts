// MigraPilot — in-memory store (Phase 1).
// Ephemeral: resets when the server restarts. Pinned to globalThis so it
// survives dev hot-reloads and is shared across route module instances.

import type { ApprovalRequest, AuditEvent, Conversation, Message, Run } from "./types";
import type { ChatMessage } from "./gateway";

type Store = {
  conversations: Map<string, Conversation>;
  messages: Map<string, Message>;
  runs: Map<string, Run>;
  approvals: Map<string, ApprovalRequest>;
  runConvos: Map<string, ChatMessage[]>;
  audit: AuditEvent[];
  counter: number;
};

const g = globalThis as unknown as { __migrapilotStore?: Store };

export const store: Store =
  g.__migrapilotStore ??
  (g.__migrapilotStore = {
    conversations: new Map(),
    messages: new Map(),
    runs: new Map(),
    approvals: new Map(),
    runConvos: new Map(),
    audit: [],
    counter: 0,
  });

// Backfill fields if an older store object survived a hot-reload (shape changed mid-session).
store.approvals ??= new Map();
store.runConvos ??= new Map();
store.audit ??= [];

export function saveApproval(a: ApprovalRequest): void {
  store.approvals.set(a.id, a);
}
export function getApproval(approvalId: string): ApprovalRequest | undefined {
  return store.approvals.get(approvalId);
}
export function setRunConvo(runId: string, convo: ChatMessage[]): void {
  store.runConvos.set(runId, convo);
}
export function getRunConvo(runId: string): ChatMessage[] | undefined {
  return store.runConvos.get(runId);
}
export function addAudit(event: AuditEvent): void {
  store.audit.push(event);
}
export function listAudit(): AuditEvent[] {
  return [...store.audit].reverse();
}

export function id(prefix: string): string {
  store.counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${store.counter.toString(36)}`;
}

export function saveRun(run: Run): void {
  store.runs.set(run.id, run);
}

export function getRun(runId: string): Run | undefined {
  return store.runs.get(runId);
}

export function listRuns(): Run[] {
  return [...store.runs.values()].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

export function saveMessage(message: Message): void {
  store.messages.set(message.id, message);
}

export function getOrCreateConversation(conversationId?: string): Conversation {
  if (conversationId) {
    const existing = store.conversations.get(conversationId);
    if (existing) return existing;
  }
  const conversation: Conversation = {
    id: conversationId ?? id("conv"),
    title: "New conversation",
    createdAt: new Date().toISOString(),
    messageIds: [],
    runIds: [],
  };
  store.conversations.set(conversation.id, conversation);
  return conversation;
}
