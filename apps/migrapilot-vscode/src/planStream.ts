/**
 * Execution-plan + phase stream (Phase C.6.1).
 *
 * pilot-api emits, before it touches any tool:
 *   event: plan   data: { plan: ExecutionPlan, text: string }
 *   event: phase  data: { phase: "planning"|"execution"|"completion", label?, step?, status? }
 *
 * The plan is authored server-side from the routed intent + the resolved owning
 * organization, so it can neither be lost when tools start nor hallucinated by
 * the model. This module is pure (no vscode import) so it is directly testable.
 *
 * Invariant: a plan NEVER carries an internal identifier — only an organization
 * NAME. Nothing here should ever surface a tenantId/podId/zoneId.
 */

export type PlanStepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export type PlanStatus = "dry_run" | "approved" | "executing" | "complete" | "failed";
export type StreamPhase = "planning" | "execution" | "completion";

export interface PlanStep {
  /** 1-based position. */
  index: number;
  /** User-facing step text. Never contains an internal identifier. */
  text: string;
  status: PlanStepStatus;
  /** Tool-name prefixes whose execution advances this step (live progress). */
  toolPrefixes?: string[];
}

export interface ExecutionPlan {
  /** Deterministic (server-authored) or parsed from model prose. */
  source: "deterministic" | "model";
  title: string;
  /** Resolved owning ORGANIZATION NAME — never an id. Null when unresolved. */
  org: string | null;
  domain: string | null;
  /** One-line resolution statement shown above the plan. */
  resolution: string | null;
  steps: PlanStep[];
  /** Posture. Always `dry_run` in this phase — live mutation stays disabled. */
  status: PlanStatus;
  note?: string | null;
}

export interface PhaseUpdate {
  phase: StreamPhase;
  label?: string;
  /** 1-based plan step this update refers to, when it targets one. */
  step?: number;
  status?: PlanStepStatus;
}

const STEP_STATUSES: PlanStepStatus[] = ["pending", "running", "done", "skipped", "failed"];
const PLAN_STATUSES: PlanStatus[] = ["dry_run", "approved", "executing", "complete", "failed"];
const PHASES: StreamPhase[] = ["planning", "execution", "completion"];

/** Glyph for a step's state — mirrors how a senior engineer narrates progress. */
export function planGlyph(status: PlanStepStatus): string {
  switch (status) {
    case "done": return "✓";
    case "running": return "▶";
    case "failed": return "✗";
    case "skipped": return "⊘";
    default: return "☐";
  }
}

/** Defensively parse an `event: plan` payload. Returns null if unusable. */
export function parsePlanEvent(data: unknown): ExecutionPlan | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as { plan?: unknown }).plan ?? data;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;

  const rawSteps = Array.isArray(p.steps) ? p.steps : [];
  const steps: PlanStep[] = rawSteps.map((s, i) => {
    const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const status = STEP_STATUSES.includes(o.status as PlanStepStatus)
      ? (o.status as PlanStepStatus)
      : "pending";
    return {
      index: typeof o.index === "number" ? o.index : i + 1,
      text: String(o.text ?? (typeof s === "string" ? s : "")),
      status,
      toolPrefixes: Array.isArray(o.toolPrefixes) ? o.toolPrefixes.map(String) : undefined,
    };
  }).filter((s) => s.text.length > 0);

  if (!steps.length) return null;

  return {
    source: p.source === "model" ? "model" : "deterministic",
    title: String(p.title ?? "Execution Plan"),
    org: typeof p.org === "string" && p.org ? p.org : null,
    domain: typeof p.domain === "string" && p.domain ? p.domain : null,
    resolution: typeof p.resolution === "string" && p.resolution ? p.resolution : null,
    steps,
    status: PLAN_STATUSES.includes(p.status as PlanStatus) ? (p.status as PlanStatus) : "dry_run",
    note: typeof p.note === "string" && p.note ? p.note : null,
  };
}

/** Defensively parse an `event: phase` payload. Returns null if unusable. */
export function parsePhaseEvent(data: unknown): PhaseUpdate | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!PHASES.includes(d.phase as StreamPhase)) return null;
  const status = STEP_STATUSES.includes(d.status as PlanStepStatus)
    ? (d.status as PlanStepStatus)
    : undefined;
  return {
    phase: d.phase as StreamPhase,
    label: typeof d.label === "string" ? d.label : undefined,
    step: typeof d.step === "number" ? d.step : undefined,
    status,
  };
}

/**
 * Fold a phase update into the plan, returning a NEW plan (never mutates).
 * - a step-targeted update sets that step's status
 * - entering `execution` starts step 1 if nothing is running yet
 * - `completion` marks any still-running step done and closes the plan out
 */
export function applyPhaseToPlan(plan: ExecutionPlan, update: PhaseUpdate): ExecutionPlan {
  const steps = plan.steps.map((s) => ({ ...s }));

  if (typeof update.step === "number" && update.status) {
    const target = steps.find((s) => s.index === update.step);
    if (target) target.status = update.status;
  }

  if (update.phase === "execution" && !steps.some((s) => s.status === "running")) {
    const next = steps.find((s) => s.status === "pending");
    if (next) next.status = "running";
  }

  if (update.phase === "completion") {
    for (const s of steps) if (s.status === "running") s.status = "done";
  }

  const status: PlanStatus =
    update.phase === "completion"
      ? (steps.some((s) => s.status === "failed") ? "failed" : "complete")
      : update.phase === "execution"
        ? "executing"
        : plan.status;

  return { ...plan, steps, status };
}
