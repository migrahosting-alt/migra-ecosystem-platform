// MigraPilot — mode authority ceiling.
//
// WHY THIS EXISTS. The UI offers five mode chips — Inspect · Plan · Execute · Verify ·
// Review — as control over how Pilot behaves. The route parsed the choice, stored it on
// the Run, and NOTHING downstream ever read it: orchestrator, agent and gateway all
// ignored it. Inspect and Execute had identical authority, and a capability question asked
// in Inspect could reach image.generate. A control that a user can see and set, that
// changes nothing, is worse than no control — it tells them they are safe when they are
// not.
//
// This is a CEILING, not a classifier. classifyPilotAction() decides what an action IS;
// this decides what the CURRENT MODE MAY DO. A ceiling can only ever narrow authority —
// it never promotes an action, never turns a blocked call into an allowed one, and never
// converts an approval into an auto-run. Composition order is therefore fixed:
// classify first, then apply the ceiling to the result.
//
// ENFORCEMENT IS MECHANICAL, NOT LEXICAL. The system prompt is told the mode so the model
// need not waste a turn discovering it, but that sentence carries no authority: the gate
// runs on the dispatch path and refuses regardless of what the model was told, believes,
// or claims. No phrase in a prompt or a model reply may widen what a mode permits.

import type { PilotActionDecision } from "./policy";

export const PILOT_MODES = ["Inspect", "Plan", "Execute", "Verify", "Review"] as const;
export type PilotMode = (typeof PILOT_MODES)[number];

/** What a mode is allowed to reach. `read_only` admits safe_read and nothing else. */
export type ModeAuthority = "read_only" | "full";

/**
 * EXECUTE IS THE ONLY MODE THAT MAY ACT.
 *
 * The other four are named for what they do, and none of them is "change something":
 * Inspect understands state, Plan produces a plan, Verify validates a result that already
 * exists, Review analyses a run that already happened. Each is a reading of the world, so
 * each gets reading authority. Execute is the one the user picks when they mean it.
 *
 * Note that `full` is not a bypass — an Execute-mode mutation still passes the approval
 * gate and still hits the blocklist. Execute lifts the ceiling; it does not remove floors.
 */
const MODE_AUTHORITY: Record<PilotMode, ModeAuthority> = {
  Inspect: "read_only",
  Plan: "read_only",
  Execute: "full",
  Verify: "read_only",
  Review: "read_only",
};

/** Human-facing reason for each read-only mode, used verbatim in the refusal. */
const READ_ONLY_REASON: Record<string, string> = {
  Inspect: "Inspect mode understands current state and does not change it",
  Plan: "Plan mode produces a plan; carrying it out is what Execute mode is for",
  Verify: "Verify mode validates a result that already exists",
  Review: "Review mode analyses a run that already happened",
};

/**
 * FAILS CLOSED. An unrecognised, absent or malformed mode resolves to the WEAKEST
 * authority, never the strongest — the same rule the capability tier resolver follows.
 * A typo, an old client, or a hand-rolled POST must not be a route to execution.
 */
export function parseMode(raw: unknown): PilotMode | null {
  return typeof raw === "string" && (PILOT_MODES as readonly string[]).includes(raw)
    ? (raw as PilotMode)
    : null;
}

export function authorityOfMode(raw: unknown): ModeAuthority {
  const mode = parseMode(raw);
  return mode ? MODE_AUTHORITY[mode] : "read_only";
}

/**
 * Narrow a classified decision to what the run's mode permits.
 *
 * Returns the decision UNCHANGED when the mode admits it, so Execute runs exactly the
 * policy that ran before this module existed and no existing behaviour shifts under it.
 */
export function applyModeCeiling(decision: PilotActionDecision, raw: unknown): PilotActionDecision {
  if (authorityOfMode(raw) === "full") return decision;
  // safe_read is the whole of read-only authority. safe_write is still a write.
  if (decision.risk === "safe_read") return decision;
  // Already refused: leave the original reason, which is more specific than the mode's.
  if (decision.blocked) return decision;

  const mode = parseMode(raw);
  const because = mode
    ? READ_ONLY_REASON[mode]
    : `mode ${JSON.stringify(raw)} is not a recognised mode, so the weakest authority applies`;

  return {
    ...decision,
    risk: "blocked",
    blocked: true,
    requiresApproval: false, // NEVER offer approval for something the mode cannot do at all.
    reason: `${because}. "${decision.action}" would ${decision.expectedEffect
      .replace(/^Will /, "")
      .replace(/\.$/, "")}. Switch to Execute mode to run it.`,
    expectedEffect: "Refused — no change was made.",
  };
}
