// MigraPilot — Promotion Gate Status (Phase 12.16).
//
// READ-ONLY status view over the executor pre-implementation checklist (12.15) + safety-invariant
// manifest version (12.12). It CONSUMES the existing EXECUTOR_PRECHECKS / EXECUTOR_READY data and
// duplicates nothing. It enables nothing, executes nothing, and changes no policy/eligibility/approval
// behavior — it only reports which gates are satisfied vs pending.

import { EXECUTOR_PRECHECKS, EXECUTOR_READY, EXECUTOR_PRECHECK_VERSION, MANIFEST_VERSION_REF, pendingPromotionPrechecks } from "./executor-precheck";
import { SAFETY_INVARIANTS_VERSION } from "./safety-invariants";

export interface PromotionStatus {
  executorReady: false;
  executorBlocked: boolean;
  blockedReason: string;
  precheckVersion: string;
  manifestVersionRef: string;
  manifestVersion: string;
  manifestInSync: boolean;
  totals: {
    total: number;
    standing: { total: number; satisfied: number; pending: number };
    promotion: { total: number; satisfied: number; pending: number };
  };
  satisfiedStandingPrechecks: number;
  pendingPromotionPrechecks: number;
  blockingFailures: string[];
  prechecks: { id: string; requirement: string; category: string; status: string; satisfiedBy: string }[];
  summary: string;
  generatedAt: string;
}

export function buildPromotionStatus(nowIso: string): PromotionStatus {
  const standing = EXECUTOR_PRECHECKS.filter((p) => p.category === "standing");
  const promotion = EXECUTOR_PRECHECKS.filter((p) => p.category === "promotion");
  const sSat = standing.filter((p) => p.status === "satisfied").length;
  const sPend = standing.length - sSat;
  const pSat = promotion.filter((p) => p.status === "satisfied").length;
  const pPend = pendingPromotionPrechecks().length;
  const manifestInSync = MANIFEST_VERSION_REF === SAFETY_INVARIANTS_VERSION;

  // A "blocking failure" is a regression of the cold perimeter: a standing precheck that is not
  // satisfied, or manifest-version drift. (Pending promotion prechecks are expected, not failures.)
  const blockingFailures = [
    ...standing.filter((p) => p.status !== "satisfied").map((p) => `standing precheck not satisfied: ${p.id}`),
    ...(manifestInSync ? [] : [`manifest version drift: ref ${MANIFEST_VERSION_REF} != ${SAFETY_INVARIANTS_VERSION}`]),
  ];

  const executorBlocked = EXECUTOR_READY === false || pPend > 0 || blockingFailures.length > 0;
  const blockedReason = !EXECUTOR_READY
    ? "EXECUTOR_READY is false (cold perimeter)"
    : blockingFailures.length
      ? "standing safety regression"
      : pPend > 0
        ? `${pPend} promotion prechecks pending`
        : "promotable";

  return {
    executorReady: false,
    executorBlocked,
    blockedReason,
    precheckVersion: EXECUTOR_PRECHECK_VERSION,
    manifestVersionRef: MANIFEST_VERSION_REF,
    manifestVersion: SAFETY_INVARIANTS_VERSION,
    manifestInSync,
    totals: {
      total: EXECUTOR_PRECHECKS.length,
      standing: { total: standing.length, satisfied: sSat, pending: sPend },
      promotion: { total: promotion.length, satisfied: pSat, pending: pPend },
    },
    satisfiedStandingPrechecks: sSat,
    pendingPromotionPrechecks: pPend,
    blockingFailures,
    prechecks: EXECUTOR_PRECHECKS.map((p) => ({ id: p.id, requirement: p.requirement, category: p.category, status: p.status, satisfiedBy: p.satisfiedBy })),
    summary: `Executor ${executorBlocked ? "BLOCKED" : "promotable"} — ${sSat}/${standing.length} standing satisfied, ${pPend} promotion pending; manifest ${manifestInSync ? "in sync" : "DRIFT"}.`,
    generatedAt: nowIso,
  };
}
