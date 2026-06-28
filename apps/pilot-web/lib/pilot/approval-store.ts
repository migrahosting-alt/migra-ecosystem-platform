// MigraPilot — approval store abstraction (Phase 9.9).
//
// DEFAULT: in-memory (globalThis Map, resets on restart). OPTIONAL: Postgres,
// dormant and env-gated (PILOT_APPROVAL_STORE=postgres + DATABASE_URL), with a
// graceful fallback to memory unless PILOT_APPROVAL_FAIL_CLOSED is set.
//
// Guarantees:
//   - Stores only SANITIZED args (secret-looking keys stripped) — no secrets at rest.
//   - Exact-once execution via an atomic claim (pending → approved); a second claim returns null.
//   - Stale pending approvals lazily expire after PILOT_APPROVAL_TTL_MS (default 1h).
//   - Execution always re-classifies the stored action; blocked actions never run (enforced by the route).

import { createHash } from "node:crypto";
import { store } from "./store";
import type { ApprovalRequest } from "./types";

const SECRET_KEY_RE = /secret|token|password|key|credential|authorization|cookie|api[_-]?key/i;

// Strip secret-looking keys before anything is stored or executed. The approval-gated
// tools never legitimately take such keys, so dropping them keeps stored == executed.
export function sanitizeApprovalArgs(args: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  // Cap matches the code/file content limit (256KB) so an approved code.apply / file write is
  // stored and executed EXACTLY (exact-once binding); secret-looking keys are still dropped.
  for (const [k, v] of Object.entries(args)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = typeof v === "string" && v.length > 262144 ? v.slice(0, 262144) : v;
  }
  return out;
}

function digest(obj: unknown): string {
  return createHash("sha256").update(JSON.stringify(obj ?? {})).digest("hex").slice(0, 16);
}

function ttlMs(): number {
  const v = Number(process.env.PILOT_APPROVAL_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : 60 * 60 * 1000; // default 1h
}
function failClosed(): boolean {
  const v = process.env.PILOT_APPROVAL_FAIL_CLOSED;
  return v === "1" || v === "true";
}
function pgConfigured(): boolean {
  return process.env.PILOT_APPROVAL_STORE === "postgres" && !!process.env.DATABASE_URL;
}

const nowIso = () => new Date().toISOString();

export interface ApprovalStore {
  create(rec: ApprovalRequest): Promise<ApprovalRequest>;
  get(approvalId: string): Promise<ApprovalRequest | undefined>;
  claim(approvalId: string): Promise<ApprovalRequest | null>; // pending → approved (atomic, not expired)
  cancel(approvalId: string): Promise<ApprovalRequest | null>; // pending → cancelled (atomic)
  markExecuted(approvalId: string, detail: string): Promise<void>;
  markBlocked(approvalId: string, detail: string): Promise<void>;
  listRecent(limit: number): Promise<ApprovalRequest[]>;
}

// ---- In-memory backend (default) -------------------------------------------
function expireIfStale(a: ApprovalRequest): ApprovalRequest {
  if (a.status === "pending" && a.expiresAt && Date.parse(a.expiresAt) < Date.now()) {
    a.status = "expired";
    a.updatedAt = nowIso();
    store.approvals.set(a.id, a);
  }
  return a;
}

const memoryStore: ApprovalStore = {
  async create(rec) {
    store.approvals.set(rec.id, rec);
    return rec;
  },
  async get(approvalId) {
    const a = store.approvals.get(approvalId);
    return a ? expireIfStale(a) : undefined;
  },
  // Synchronous read→write with no intervening await: atomic on Node's event loop → exact-once.
  async claim(approvalId) {
    const a = store.approvals.get(approvalId);
    if (!a) return null;
    expireIfStale(a);
    if (a.status !== "pending") return null;
    a.status = "approved";
    a.decidedAt = nowIso();
    a.updatedAt = a.decidedAt;
    store.approvals.set(a.id, a);
    return a;
  },
  async cancel(approvalId) {
    const a = store.approvals.get(approvalId);
    if (!a) return null;
    expireIfStale(a);
    if (a.status !== "pending") return null;
    a.status = "cancelled";
    a.decidedAt = nowIso();
    a.updatedAt = a.decidedAt;
    store.approvals.set(a.id, a);
    return a;
  },
  async markExecuted(approvalId, detail) {
    const a = store.approvals.get(approvalId);
    if (!a) return;
    a.status = "executed";
    a.executedAt = nowIso();
    a.updatedAt = a.executedAt;
    a.detail = detail;
    store.approvals.set(a.id, a);
  },
  async markBlocked(approvalId, detail) {
    const a = store.approvals.get(approvalId);
    if (!a) return;
    a.status = "blocked";
    a.updatedAt = nowIso();
    a.detail = detail;
    store.approvals.set(a.id, a);
  },
  async listRecent(limit) {
    return [...store.approvals.values()]
      .map(expireIfStale)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, limit));
  },
};

// ---- Backend dispatcher (cache the DECISION, not the object — hot-reload safe) ----
const gb = globalThis as unknown as { __migrapilotApprovalBackend?: "memory" | "postgres" };

async function getStore(): Promise<ApprovalStore> {
  if (!pgConfigured()) {
    gb.__migrapilotApprovalBackend = "memory";
    return memoryStore;
  }
  try {
    const mod = await import("./approval-store-pg");
    await mod.pgApprovalStore.init();
    gb.__migrapilotApprovalBackend = "postgres";
    return mod.pgApprovalStore;
  } catch (e) {
    if (failClosed()) throw e;
    gb.__migrapilotApprovalBackend = "memory";
    return memoryStore;
  }
}

export function approvalStoreName(): "memory" | "postgres" {
  return gb.__migrapilotApprovalBackend ?? (pgConfigured() ? "postgres" : "memory");
}

// ---- Public API ------------------------------------------------------------
// Sanitizes args, stamps lifecycle fields, and persists a fresh pending approval.
export async function createApproval(input: ApprovalRequest): Promise<ApprovalRequest> {
  const created = input.createdAt || nowIso();
  const args = sanitizeApprovalArgs(input.args);
  const rec: ApprovalRequest = {
    ...input,
    args,
    argsDigest: digest(args),
    status: "pending",
    createdAt: created,
    updatedAt: created,
    expiresAt: new Date(Date.now() + ttlMs()).toISOString(),
  };
  return (await getStore()).create(rec);
}

export async function getApprovalRecord(approvalId: string): Promise<ApprovalRequest | undefined> {
  return (await getStore()).get(approvalId);
}
export async function claimApproval(approvalId: string): Promise<ApprovalRequest | null> {
  return (await getStore()).claim(approvalId);
}
export async function cancelApproval(approvalId: string): Promise<ApprovalRequest | null> {
  return (await getStore()).cancel(approvalId);
}
export async function markApprovalExecuted(approvalId: string, detail: string): Promise<void> {
  return (await getStore()).markExecuted(approvalId, detail);
}
export async function markApprovalBlocked(approvalId: string, detail: string): Promise<void> {
  return (await getStore()).markBlocked(approvalId, detail);
}
export async function listRecentApprovals(limit = 20): Promise<ApprovalRequest[]> {
  return (await getStore()).listRecent(limit);
}

// Customer/UI-safe projection: never includes raw args (only the digest + sanitized summary).
export interface ApprovalSummary {
  id: string;
  runId: string;
  toolName: string;
  risk: string;
  status: string;
  reason?: string;
  expectedEffect?: string;
  argsDigest?: string;
  createdAt: string;
  updatedAt?: string;
  executedAt?: string;
  detail?: string;
}
export function toApprovalSummary(a: ApprovalRequest): ApprovalSummary {
  return {
    id: a.id,
    runId: a.runId,
    toolName: a.toolName,
    risk: a.risk,
    status: a.status,
    reason: a.reason,
    expectedEffect: a.expectedEffect,
    argsDigest: a.argsDigest,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
    executedAt: a.executedAt,
    detail: a.detail,
  };
}
