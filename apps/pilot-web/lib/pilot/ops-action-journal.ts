// MigraPilot — ops action journal (Phase 11.2).
//
// DEFAULT: in-memory (globalThis, resets on restart). OPTIONAL: Postgres, dormant and env-gated
// (PILOT_OPS_ACTION_JOURNAL=postgres + DATABASE_URL), with a graceful fallback to memory unless
// PILOT_OPS_ACTION_JOURNAL_FAIL_CLOSED is set. Stores only SANITIZED records (no secrets).
//
// This phase enables NO real mutation — records are controlled no-op executions only. Exact-once
// is guaranteed by the approval system (a double approval gets 409 before the tool runs), so the
// journal never receives a duplicate create for the same execution.

export type ActionStatus = "recorded" | "verified" | "failed" | "cancelled" | "blocked";

export interface ActionRecord {
  id: string;
  actionName: string;
  category: string;
  executionMode: string;
  target: string;
  reason: string;
  mutated: boolean;
  dryRun: boolean;
  executed: boolean;
  status: ActionStatus;
  approvalId?: string;
  runId?: string;
  metadata?: Record<string, unknown>;
  summary?: string;
  verificationSummary?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActionRecordInput {
  actionName: string;
  category: string;
  executionMode: string;
  target: string;
  reason: string;
  mutated: boolean;
  dryRun: boolean;
  executed: boolean;
  status?: ActionStatus;
  approvalId?: string;
  runId?: string;
  metadata?: unknown;
  summary?: string;
}

export interface ActionJournal {
  create(rec: ActionRecord): Promise<ActionRecord>;
  get(id: string): Promise<ActionRecord | undefined>;
  listRecent(limit: number): Promise<ActionRecord[]>;
  markVerified(id: string, summary: string): Promise<ActionRecord | undefined>;
}

const SECRET_KEY_RE = /secret|token|password|key|credential|authorization|cookie|api[_-]?key/i;

export function sanitizeActionMetadata(m: unknown): Record<string, unknown> | undefined {
  if (!m || typeof m !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
    if (SECRET_KEY_RE.test(k)) continue; // never store secret-looking keys
    out[k] = typeof v === "string" && v.length > 500 ? v.slice(0, 500) : v;
  }
  return Object.keys(out).length ? out : undefined;
}

const nowIso = () => new Date().toISOString();
function pgConfigured(): boolean {
  return process.env.PILOT_OPS_ACTION_JOURNAL === "postgres" && !!process.env.DATABASE_URL;
}
function failClosed(): boolean {
  const v = process.env.PILOT_OPS_ACTION_JOURNAL_FAIL_CLOSED;
  return v === "1" || v === "true";
}

// ---- In-memory backend (default) -------------------------------------------
const gm = globalThis as unknown as { __migrapilotActionJournal?: ActionRecord[] };
function mem(): ActionRecord[] {
  return (gm.__migrapilotActionJournal ??= []);
}
const memoryJournal: ActionJournal = {
  async create(rec) {
    const a = mem();
    a.unshift(rec);
    if (a.length > 500) a.length = 500;
    return rec;
  },
  async get(id) {
    return mem().find((r) => r.id === id);
  },
  async listRecent(limit) {
    return mem().slice(0, Math.max(0, Math.min(limit, 200)));
  },
  async markVerified(id, summary) {
    const r = mem().find((x) => x.id === id);
    if (r) { r.status = "verified"; r.verificationSummary = summary; r.updatedAt = nowIso(); }
    return r;
  },
};

// ---- Dispatcher (cache the DECISION, not the object — hot-reload safe) ------
const gb = globalThis as unknown as { __migrapilotActionJournalBackend?: "memory" | "postgres" };

async function getJournal(): Promise<ActionJournal> {
  if (!pgConfigured()) {
    gb.__migrapilotActionJournalBackend = "memory";
    return memoryJournal;
  }
  try {
    const mod = await import("./ops-action-journal-pg");
    await mod.pgActionJournal.init();
    gb.__migrapilotActionJournalBackend = "postgres";
    return mod.pgActionJournal;
  } catch (e) {
    if (failClosed()) throw e;
    gb.__migrapilotActionJournalBackend = "memory";
    return memoryJournal;
  }
}

export function actionJournalStoreName(): "memory" | "postgres" {
  return gb.__migrapilotActionJournalBackend ?? (pgConfigured() ? "postgres" : "memory");
}

let counter = 0;
function actionId(): string {
  counter += 1;
  return `act_${Date.now().toString(36)}_${counter.toString(36)}`;
}

// ---- Public API ------------------------------------------------------------
export async function createActionRecord(input: ActionRecordInput): Promise<ActionRecord> {
  const ts = nowIso();
  const rec: ActionRecord = {
    id: actionId(),
    actionName: input.actionName,
    category: input.category,
    executionMode: input.executionMode,
    target: input.target,
    reason: input.reason,
    mutated: input.mutated,
    dryRun: input.dryRun,
    executed: input.executed,
    status: input.status ?? "recorded",
    approvalId: input.approvalId ? String(input.approvalId) : undefined,
    runId: input.runId ? String(input.runId) : undefined,
    metadata: sanitizeActionMetadata(input.metadata),
    summary: input.summary,
    createdAt: ts,
    updatedAt: ts,
  };
  return (await getJournal()).create(rec);
}
export async function getActionRecord(id: string): Promise<ActionRecord | undefined> {
  return (await getJournal()).get(id);
}
export async function listRecentActionRecords(limit = 20): Promise<ActionRecord[]> {
  return (await getJournal()).listRecent(limit);
}
export async function markActionVerified(id: string, summary: string): Promise<ActionRecord | undefined> {
  return (await getJournal()).markVerified(id, summary);
}
