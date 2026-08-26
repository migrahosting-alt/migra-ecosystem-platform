import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type ActionStatus = "pending" | "approved" | "executed" | "rejected";

export interface HidsEdrAction {
  actionId: string;
  agentId: string;
  findingId?: string;
  action: string;
  objective: string;
  status: ActionStatus;
  requestedAt: string;
  approvedAt?: string;
  approvedBy?: string;
  executedAt?: string;
  executionNotes?: string;
}

interface ActionState {
  actions: HidsEdrAction[];
}

const statePath = path.resolve(process.cwd(), ".data", "hids-edr-actions.json");

function ensureState(): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) {
    const initial: ActionState = { actions: [] };
    fs.writeFileSync(statePath, JSON.stringify(initial, null, 2), "utf8");
  }
}

function readState(): ActionState {
  ensureState();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as ActionState;
    return { actions: Array.isArray(parsed?.actions) ? parsed.actions : [] };
  } catch {
    return { actions: [] };
  }
}

function writeState(state: ActionState): void {
  ensureState();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

export function createAction(input: {
  agentId: string;
  findingId?: string;
  action: string;
  objective: string;
}): HidsEdrAction {
  const state = readState();
  const now = new Date().toISOString();
  const record: HidsEdrAction = {
    actionId: `resp_${randomUUID()}`,
    agentId: input.agentId,
    findingId: input.findingId,
    action: input.action,
    objective: input.objective,
    status: "pending",
    requestedAt: now
  };
  state.actions.unshift(record);
  state.actions = state.actions.slice(0, 10000);
  writeState(state);
  return record;
}

export function listActions(input?: { agentId?: string; status?: ActionStatus; limit?: number }): HidsEdrAction[] {
  const state = readState();
  const limit = Math.max(1, Math.min(5000, input?.limit ?? 200));
  return state.actions
    .filter((action) => {
      if (input?.agentId && action.agentId !== input.agentId) {
        return false;
      }
      if (input?.status && action.status !== input.status) {
        return false;
      }
      return true;
    })
    .slice(0, limit);
}

export function approveAction(input: { actionId: string; approvedBy: string }): HidsEdrAction | null {
  const state = readState();
  const index = state.actions.findIndex((action) => action.actionId === input.actionId);
  if (index < 0) {
    return null;
  }
  const now = new Date().toISOString();
  const next: HidsEdrAction = {
    ...state.actions[index],
    status: "approved",
    approvedAt: now,
    approvedBy: input.approvedBy
  };
  state.actions[index] = next;
  writeState(state);
  return next;
}

export function markExecuted(input: { actionId: string; executionNotes: string }): HidsEdrAction | null {
  const state = readState();
  const index = state.actions.findIndex((action) => action.actionId === input.actionId);
  if (index < 0) {
    return null;
  }
  const now = new Date().toISOString();
  const next: HidsEdrAction = {
    ...state.actions[index],
    status: "executed",
    executedAt: now,
    executionNotes: input.executionNotes
  };
  state.actions[index] = next;
  writeState(state);
  return next;
}

export function getActionStorePath(): string {
  return statePath;
}
