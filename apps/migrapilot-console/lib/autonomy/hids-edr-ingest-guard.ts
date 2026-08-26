import fs from "node:fs";
import path from "node:path";

interface IngestGuardState {
  seenEventIds: Array<{ eventId: string; ts: number }>;
  seenNonces: Array<{ nonceKey: string; ts: number }>;
}

const statePath = path.resolve(process.cwd(), ".data", "hids-edr-ingest-guard.json");
const MAX_SEEN_EVENT_IDS = 20000;
const MAX_SEEN_NONCES = 50000;
const EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const NONCE_TTL_MS = 15 * 60 * 1000;

function ensureState(): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  if (!fs.existsSync(statePath)) {
    const initial: IngestGuardState = { seenEventIds: [], seenNonces: [] };
    fs.writeFileSync(statePath, JSON.stringify(initial, null, 2), "utf8");
  }
}

function readState(): IngestGuardState {
  ensureState();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as IngestGuardState;
    return {
      seenEventIds: Array.isArray(parsed?.seenEventIds) ? parsed.seenEventIds : [],
      seenNonces: Array.isArray(parsed?.seenNonces) ? parsed.seenNonces : []
    };
  } catch {
    return { seenEventIds: [], seenNonces: [] };
  }
}

function writeState(state: IngestGuardState): void {
  ensureState();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
}

function prune(state: IngestGuardState, nowMs: number): IngestGuardState {
  const seenEventIds = state.seenEventIds
    .filter((item) => nowMs - item.ts <= EVENT_TTL_MS)
    .slice(-MAX_SEEN_EVENT_IDS);

  const seenNonces = state.seenNonces
    .filter((item) => nowMs - item.ts <= NONCE_TTL_MS)
    .slice(-MAX_SEEN_NONCES);

  return { seenEventIds, seenNonces };
}

export function registerNonce(input: {
  agentId: string;
  nonce: string;
  timestampMs: number;
  maxClockSkewMs?: number;
}): { ok: true } | { ok: false; code: "CLOCK_SKEW" | "NONCE_REPLAY"; message: string } {
  const nowMs = Date.now();
  const maxClockSkewMs = input.maxClockSkewMs ?? 5 * 60 * 1000;
  if (Math.abs(nowMs - input.timestampMs) > maxClockSkewMs) {
    return { ok: false, code: "CLOCK_SKEW", message: "timestamp outside allowed skew window" };
  }

  const nonceKey = `${input.agentId}:${input.nonce}`;
  const state = prune(readState(), nowMs);
  if (state.seenNonces.some((item) => item.nonceKey === nonceKey)) {
    return { ok: false, code: "NONCE_REPLAY", message: "nonce already used" };
  }

  state.seenNonces.push({ nonceKey, ts: nowMs });
  writeState(state);
  return { ok: true };
}

export function filterDuplicateEventIds(eventIds: string[]): {
  acceptedEventIds: string[];
  duplicateEventIds: string[];
} {
  const nowMs = Date.now();
  const state = prune(readState(), nowMs);
  const known = new Set(state.seenEventIds.map((item) => item.eventId));

  const acceptedEventIds: string[] = [];
  const duplicateEventIds: string[] = [];

  for (const eventId of eventIds) {
    if (known.has(eventId)) {
      duplicateEventIds.push(eventId);
      continue;
    }
    acceptedEventIds.push(eventId);
    known.add(eventId);
    state.seenEventIds.push({ eventId, ts: nowMs });
  }

  writeState(prune(state, nowMs));
  return { acceptedEventIds, duplicateEventIds };
}

export function getIngestGuardPath(): string {
  return statePath;
}
