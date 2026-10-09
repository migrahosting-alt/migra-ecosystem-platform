/**
 * Health contract — the only sanctioned way to express operational state.
 *
 * INVARIANT
 *   No component may claim current operational truth without fresh evidence.
 *
 * This module exists because `ecosystem.ts` previously contained:
 *
 *     for (const t of tiles) { t.status = "operational"; }
 *
 * which manufactured a healthy verdict for all eight product tiles on every
 * request where the database merely happened to be reachable. Database
 * reachability is not evidence about MigraVoice, MigraMail or Intake. Two more
 * tiles carried the literal `status: "operational"` with no probe at all.
 *
 * The fix is not to delete those lines and hope. It is to make the healthy
 * states *unconstructable* without evidence: `Health` is a discriminated union
 * whose only positive variants require `observedAt`, `source` and `expiresAt`.
 * There is no literal a future edit can assign to get green — you must produce
 * an observation, and the type system will demand its provenance.
 *
 * Pure module: no database, no network, no framework imports, so the guarantees
 * can be unit-tested without infrastructure.
 */

export type HealthState = "operational" | "degraded" | "down" | "unknown";

/** A state backed by a real observation, with the evidence attached. */
export interface ObservedHealth {
  state: "operational" | "degraded" | "down";
  /** ISO timestamp of the observation this verdict rests on. */
  observedAt: string;
  /** ISO timestamp after which the verdict is no longer current. */
  expiresAt: string;
  /** What produced it, e.g. "http_probe", "panel-api", "systemd". */
  source: string;
  latencyMs?: number;
  detail?: string;
}

/** No evidence, or evidence too old to trust. Always carries a reason. */
export interface UnknownHealth {
  state: "unknown";
  reason: string;
  observedAt: string | null;
  /** Present when this decayed from a previously good observation. */
  lastGoodAt?: string;
  source?: string;
}

export type Health = ObservedHealth | UnknownHealth;

/**
 * The only constructor for a non-unknown state. Requires provenance, so a
 * caller cannot express "operational" without saying when it was observed,
 * by what, and how long the claim remains valid.
 */
export const observed = (
  state: "operational" | "degraded" | "down",
  evidence: {
    observedAt: Date | string;
    ttlMs: number;
    source: string;
    latencyMs?: number;
    detail?: string;
  },
): ObservedHealth => {
  const at = typeof evidence.observedAt === "string" ? new Date(evidence.observedAt) : evidence.observedAt;
  if (Number.isNaN(at.getTime())) throw new Error("observed(): observedAt is not a valid date");
  if (!(evidence.ttlMs > 0)) throw new Error("observed(): ttlMs must be a positive number");
  if (!evidence.source) throw new Error("observed(): source is required");
  // tsconfig sets exactOptionalPropertyTypes, so optional fields are omitted
  // rather than set to undefined.
  return {
    state,
    observedAt: at.toISOString(),
    expiresAt: new Date(at.getTime() + evidence.ttlMs).toISOString(),
    source: evidence.source,
    ...(evidence.latencyMs === undefined ? {} : { latencyMs: evidence.latencyMs }),
    ...(evidence.detail === undefined ? {} : { detail: evidence.detail }),
  };
};

/** The default for everything without a current observation. */
export const unknown = (reason: string, extra: { lastGoodAt?: string; source?: string } = {}): UnknownHealth => ({
  state: "unknown",
  reason,
  observedAt: null,
  ...(extra.lastGoodAt === undefined ? {} : { lastGoodAt: extra.lastGoodAt }),
  ...(extra.source === undefined ? {} : { source: extra.source }),
});

/**
 * Apply expiry. HEALTHY → STALE → UNKNOWN; a verdict never stays good forever.
 * Call this at render time, never at write time, so age is evaluated against
 * the moment the operator is actually looking.
 */
export const current = (h: Health, now: Date = new Date()): Health => {
  if (h.state === "unknown") return h;
  if (new Date(h.expiresAt).getTime() <= now.getTime()) {
    return {
      state: "unknown",
      reason: "observation expired",
      observedAt: null,
      lastGoodAt: h.observedAt,
      source: h.source,
    };
  }
  return h;
};

/** True while the observation is still within its validity window. */
export const isFresh = (h: Health, now: Date = new Date()): boolean =>
  h.state !== "unknown" && new Date(h.expiresAt).getTime() > now.getTime();

/** Age with no "verified" prefix, for callers that supply their own verb
 *  ("Rendered 8s ago", "observed 3m ago"). Keeps wording from doubling up. */
export const ageOnly = (iso: string | null | undefined, now: Date = new Date()): string => {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

/** Human age for the UI. The UI must always show this next to a state. */
export const ageLabel = (h: Health, now: Date = new Date()): string => {
  const ref = h.state === "unknown" ? h.lastGoodAt : h.observedAt;
  if (!ref) return "never verified";
  const ms = now.getTime() - new Date(ref).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `verified ${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `verified ${m}m ago`;
  const hrs = Math.round(m / 60);
  if (hrs < 48) return `verified ${hrs}h ago`;
  return `verified ${Math.round(hrs / 24)}d ago`;
};

/**
 * Roll dependency observations into a product verdict.
 *
 * Dependency failure and product failure are not the same thing, so callers
 * declare which dependencies are load-bearing:
 *   - a required dependency down  -> product down
 *   - an optional dependency down -> product degraded
 *   - any required dependency unknown -> product unknown (never guess upward)
 */
export const deriveProductHealth = (
  deps: ReadonlyArray<{ health: Health; required: boolean; label: string }>,
  evidence: { observedAt: Date | string; ttlMs: number; source: string },
): Health => {
  if (deps.length === 0) return unknown("no dependency observations configured");

  const now = new Date();
  const resolved = deps.map((d) => ({ ...d, health: current(d.health, now) }));

  const unknownRequired = resolved.filter((d) => d.required && d.health.state === "unknown");
  if (unknownRequired.length > 0) {
    return unknown(
      `no current observation for required dependency: ${unknownRequired.map((d) => d.label).join(", ")}`,
    );
  }

  const downRequired = resolved.filter((d) => d.required && d.health.state === "down");
  if (downRequired.length > 0) {
    return observed("down", { ...evidence, detail: `required dependency down: ${downRequired.map((d) => d.label).join(", ")}` });
  }

  const impaired = resolved.filter((d) => d.health.state === "down" || d.health.state === "degraded");
  if (impaired.length > 0) {
    return observed("degraded", { ...evidence, detail: `impaired: ${impaired.map((d) => d.label).join(", ")}` });
  }

  return observed("operational", evidence);
};
