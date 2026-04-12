import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { ApprovalRecord, ConversationRecord, TimelineRun } from "../shared/types";

interface BrainState {
  conversations: ConversationRecord[];
  runs: TimelineRun[];
  approvals: ApprovalRecord[];
}

function dedupeRuns(runs: TimelineRun[]): TimelineRun[] {
  const byId = new Map<string, TimelineRun>();
  for (const run of runs) {
    const existing = byId.get(run.id);
    if (!existing || run.createdAt >= existing.createdAt) {
      byId.set(run.id, run);
    }
  }
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

const statePath = path.resolve(process.cwd(), ".data", "brain-state.json");

function ensureStateFile(): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) {
    const initial: BrainState = { conversations: [], runs: [], approvals: [] };
    fs.writeFileSync(statePath, JSON.stringify(initial, null, 2), "utf8");
  }
}

function readState(): BrainState {
  ensureStateFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as BrainState;
    return {
      conversations: parsed.conversations ?? [],
      runs: parsed.runs ?? [],
      approvals: parsed.approvals ?? []
    };
  } catch {
    return { conversations: [], runs: [], approvals: [] };
  }
}

function writeState(state: BrainState): void {
  ensureStateFile();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function listConversations(): ConversationRecord[] {
  return readState().conversations.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(conversationId: string): ConversationRecord | null {
  return readState().conversations.find((item) => item.id === conversationId) ?? null;
}

export function ensureConversation(conversationId?: string): ConversationRecord {
  const state = readState();
  if (conversationId) {
    const existing = state.conversations.find((item) => item.id === conversationId);
    if (existing) {
      return existing;
    }
  }

  const now = new Date().toISOString();
  const created: ConversationRecord = {
    id: conversationId ?? `conv_${randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  state.conversations.unshift(created);
  writeState(state);
  return created;
}

export function appendMessage(
  conversationId: string,
  message: ConversationRecord["messages"][number]
): ConversationRecord {
  const state = readState();
  const conversation =
    state.conversations.find((item) => item.id === conversationId) ?? ensureConversation(conversationId);
  const found = state.conversations.find((item) => item.id === conversation.id);
  const target = found ?? conversation;
  target.messages.push(message);
  target.updatedAt = new Date().toISOString();

  if (!found) {
    state.conversations.unshift(target);
  }

  writeState(state);
  return target;
}

export function recordRun(run: TimelineRun): void {
  const state = readState();
  state.runs = dedupeRuns([run, ...state.runs]).slice(0, 500);
  writeState(state);
}

export function listRuns(limit = 100): TimelineRun[] {
  return dedupeRuns(readState().runs).slice(0, limit);
}

export function createApproval(record: Omit<ApprovalRecord, "id" | "createdAt" | "status">): ApprovalRecord {
  const state = readState();
  const created: ApprovalRecord = {
    ...record,
    id: `approval_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    status: "pending"
  };
  state.approvals.unshift(created);
  writeState(state);
  return created;
}

export function listApprovals(): ApprovalRecord[] {
  return readState().approvals;
}

export function updateApproval(
  approvalId: string,
  updates: Partial<Pick<ApprovalRecord, "status" | "humanKeyTurnCode">>
): ApprovalRecord | null {
  const state = readState();
  const approval = state.approvals.find((item) => item.id === approvalId);
  if (!approval) {
    return null;
  }
  if (updates.status) {
    approval.status = updates.status;
  }
  if (updates.humanKeyTurnCode) {
    approval.humanKeyTurnCode = updates.humanKeyTurnCode;
  }
  writeState(state);
  return approval;
}
