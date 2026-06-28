// MigraPilot — Phase 1 data model (in-memory).
// Read-only planning agent only. No tool execution, no production changes.

export type RunStatus = "queued" | "running" | "succeeded" | "failed" | "needs_approval";
export type StepStatus = "pending" | "running" | "done" | "failed";

export type AgentProfileId =
  | "operator"
  | "coding"
  | "deploy"
  | "billing"
  | "hosting"
  | "security"
  | "support"
  | "database";

export interface AgentProfile {
  id: AgentProfileId;
  name: string;
  purpose: string;
  scope: string;
}

export interface RunStep {
  id: string;
  index: number;
  title: string;
  status: StepStatus;
  detail?: string;
  startedAt: string;
  endedAt?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface Run {
  id: string;
  conversationId: string;
  agentProfileId: AgentProfileId;
  agentName: string;
  mode: string; // Inspect | Plan | Execute | Verify | Review
  status: RunStatus;
  userMessage: string;
  summary?: string;
  model?: string;
  tier?: string;
  pendingApprovalId?: string;
  recalled?: { count: number; sources: { title: string; path: string }[] };
  steps: RunStep[];
  createdAt: string;
  endedAt?: string;
}

export interface ApprovalRequest {
  id: string;
  runId: string;
  stepId?: string;
  toolName: string;
  args: Record<string, unknown>;
  risk: string;
  status: "pending" | "approved" | "denied";
  createdAt: string;
  decidedAt?: string;
}

export interface AuditEvent {
  id: string;
  runId: string;
  ts: string;
  kind: string; // tool.read | approval.requested | approval.approved | approval.denied | tool.executed
  detail: string;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  messageIds: string[];
  runIds: string[];
}

// --- Knowledge / memory (Phase 9) ---
export interface Source {
  id: string;
  path: string; // repo-relative
  title: string;
  hash: string; // sha256 of content
  bytes: number;
  chunkCount: number;
  createdAt: string;
}

export interface Chunk {
  id: string;
  sourceId: string;
  index: number;
  text: string;
}

export interface Embedding {
  chunkId: string;
  vector: number[];
}

export interface SearchHit {
  chunkId: string;
  sourceId: string;
  title: string;
  path: string;
  score: number;
  snippet: string;
}

// Events streamed to the UI over NDJSON (one JSON object per line).
export type PilotEvent =
  | { type: "run.created"; run: Run }
  | { type: "token"; delta: string }
  | { type: "message"; message: Message }
  | { type: "step"; step: RunStep }
  | { type: "approval.required"; approval: ApprovalRequest }
  | { type: "run.completed"; run: Run }
  | { type: "error"; error: string };
