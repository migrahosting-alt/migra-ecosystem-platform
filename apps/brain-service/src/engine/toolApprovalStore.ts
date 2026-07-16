/**
 * MigraAI Engine — tool approval store.
 *
 * Engine-owned, single-use approval tokens for MUTATING capability execution.
 * This moves the approval guarantees the extension proved for pilot-api UNDER the
 * new tool boundary, for locally-executed tools:
 *  - binding: an approval is bound to exactly (tool, inputHash); executing with a
 *    different tool/input is refused.
 *  - single-use: consuming transitions PENDING → CONSUMED; a second consume is a
 *    replay and is refused (INVALID_STATE).
 *  - idempotency: minting twice for the same (tool, inputHash, requestId) returns
 *    the SAME pending approval, so a retried mint never creates a second token.
 *  - expiry: approvals lapse after a TTL and are then unusable.
 *
 * In-memory + bounded — a local single-process engine. A hosted deployment can
 * swap this for a shared store without changing the route contract.
 */

export type ApprovalState = 'PENDING' | 'CONSUMED' | 'EXPIRED';

export interface ApprovalRecord {
  id: string;
  tool: string;
  inputHash: string;
  requestId: string;
  state: ApprovalState;
  createdAt: number;
  expiresAt: number;
}

export type ConsumeResult =
  | { ok: true; record: ApprovalRecord }
  | { ok: false; reason: 'unknown' | 'consumed' | 'expired' | 'mismatch' };

const DEFAULT_TTL_MS = 5 * 60_000;
const MAX_RECORDS = 500;

export class ToolApprovalStore {
  private readonly byId = new Map<string, ApprovalRecord>();

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly mkId: () => string = defaultId,
    private readonly ttlMs = DEFAULT_TTL_MS,
  ) {}

  /** Mint (or idempotently return) a PENDING approval bound to (tool, inputHash).
   * A repeat mint with the same requestId returns the existing pending token. */
  mint(params: { tool: string; inputHash: string; requestId: string }): ApprovalRecord {
    this.sweep();
    for (const rec of this.byId.values()) {
      if (
        rec.state === 'PENDING' &&
        rec.tool === params.tool &&
        rec.inputHash === params.inputHash &&
        rec.requestId === params.requestId
      ) {
        return rec;
      }
    }
    const t = this.now();
    const record: ApprovalRecord = {
      id: this.mkId(),
      tool: params.tool,
      inputHash: params.inputHash,
      requestId: params.requestId,
      state: 'PENDING',
      createdAt: t,
      expiresAt: t + this.ttlMs,
    };
    this.byId.set(record.id, record);
    if (this.byId.size > MAX_RECORDS) {
      const oldest = this.byId.keys().next().value;
      if (oldest) this.byId.delete(oldest);
    }
    return record;
  }

  /** Consume an approval for exactly (tool, inputHash). Single-use: a second
   * consume, a mismatched binding, an unknown id, or an expired token is refused. */
  consume(id: string, binding: { tool: string; inputHash: string }): ConsumeResult {
    const rec = this.byId.get(id);
    if (!rec) return { ok: false, reason: 'unknown' };
    if (rec.state === 'CONSUMED') return { ok: false, reason: 'consumed' };
    if (rec.state === 'EXPIRED' || rec.expiresAt <= this.now()) {
      rec.state = 'EXPIRED';
      return { ok: false, reason: 'expired' };
    }
    if (rec.tool !== binding.tool || rec.inputHash !== binding.inputHash) {
      return { ok: false, reason: 'mismatch' };
    }
    rec.state = 'CONSUMED';
    return { ok: true, record: rec };
  }

  get(id: string): ApprovalRecord | undefined {
    return this.byId.get(id);
  }

  private sweep(): void {
    const t = this.now();
    for (const rec of this.byId.values()) {
      if (rec.state === 'PENDING' && rec.expiresAt <= t) rec.state = 'EXPIRED';
    }
  }
}

function defaultId(): string {
  // Non-guessable enough for a local single-use token; not a secret.
  return `appr_${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`.slice(0, 28);
}

/** Stable structural hash of a tool input, so an approval binds to the exact
 * request it previewed. Key order is normalized. */
export function hashInput(input: unknown): string {
  const json = stableStringify(input);
  let h = 5381;
  for (let i = 0; i < json.length; i += 1) h = (h * 33) ^ json.charCodeAt(i);
  return (h >>> 0).toString(16);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
