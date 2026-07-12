/**
 * Execution plan + phased streaming — pure client logic (pilot-api Phase C.6.1).
 *
 * Deliberately free of any `vscode` import so it can be unit-tested with the Node test
 * runner. `pilotClient.ts` (which does depend on vscode) re-exports these.
 *
 * BACKGROUND — the defect this client surface exists to render:
 *   pilot-api obeyed its own rule ("present a plan before you provision") but the chat
 *   transport discarded every pre-tool token the moment a tool ran, so the plan was
 *   destroyed by the very act of executing. pilot-api now emits the plan as a first-class
 *   `plan` SSE event before any tool runs, plus `phase` events (planning → execution →
 *   completion) carrying per-step progress. We render from those structured events rather
 *   than scraping prose, so the plan is exact and each step ticks independently.
 */

export type PlanStepStatus = "pending" | "running" | "done" | "skipped" | "failed";

export interface PlanStep {
  index: number;
  text: string;
  status: PlanStepStatus;
}

export interface ExecutionPlan {
  source: "deterministic" | "model";
  title: string;
  /** Owning ORGANIZATION NAME. Never an internal id — pilot-api guarantees this. */
  org: string | null;
  domain: string | null;
  resolution: string | null;
  steps: PlanStep[];
  /** Always "dry_run" — live infrastructure mutation is disabled. */
  status: "dry_run";
  note: string;
}

export type StreamPhase = "planning" | "execution" | "completion";

export interface PhaseUpdate {
  phase: StreamPhase;
  label: string;
  /** Set when this phase event reports progress on a specific plan step. */
  step?: number;
  stepText?: string;
  status?: PlanStepStatus;
}

/**
 * pilot-api streams the plan BOTH as a structured `plan` event and as prose tokens, so
 * that a client which does not understand the event still shows the user their plan. We
 * DO understand it, so we render the card and strip the duplicate prose from the body.
 *
 * The prose arrives in arbitrary chunks, so this consumes the expected text incrementally.
 * If the stream ever diverges from the expected prose, we stop skipping and show
 * everything — losing a duplicate is acceptable; losing real content is not.
 */
export function consumePlanProse(
  pending: string,
  incoming: string,
): { pending: string; visible: string } {
  if (!pending) return { pending: "", visible: incoming };
  const n = Math.min(pending.length, incoming.length);
  if (pending.slice(0, n) !== incoming.slice(0, n)) {
    return { pending: "", visible: incoming };
  }
  return { pending: pending.slice(n), visible: incoming.slice(n) };
}

/**
 * Apply a phase update to a plan, returning a NEW plan.
 *
 * Data honesty: a step is only ever marked from an explicit backend status. A phase event
 * that carries no step, or names a step that is not in the plan, changes nothing — we
 * never infer that a step "must have" completed.
 */
export function applyPhaseToPlan(plan: ExecutionPlan, update: PhaseUpdate): ExecutionPlan {
  if (!update.step || !update.status) return plan;
  const target = plan.steps.find((s) => s.index === update.step);
  if (!target) return plan;
  return {
    ...plan,
    steps: plan.steps.map((s) =>
      s.index === update.step ? { ...s, status: update.status as PlanStepStatus } : s,
    ),
  };
}

/** Glyph for a step. A ✓ appears only for a step the backend reported as done. */
export function planGlyph(status: PlanStepStatus): string {
  switch (status) {
    case "done": return "✓";
    case "running": return "▶";
    case "failed": return "✗";
    case "skipped": return "–";
    default: return "☐";
  }
}

export interface SseFrame {
  event: string;
  data: any;
}

/** Parse one SSE frame ("event: x\ndata: {...}"). Returns null for a frame we cannot use. */
export function parseSseFrame(frame: string): SseFrame | null {
  let event = "message";
  let dataStr = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataStr += line.slice(5).trim();
  }
  if (!dataStr) return null;
  try {
    return { event, data: JSON.parse(dataStr) };
  } catch {
    return null;
  }
}
