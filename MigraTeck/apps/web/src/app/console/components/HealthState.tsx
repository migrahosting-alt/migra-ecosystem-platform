import type { Health, HealthState } from "../lib/fleet/health-contract";
import { ageLabel, current } from "../lib/fleet/health-contract";

/**
 * The ONE vocabulary for operational state in the Control Center.
 *
 * WHY THIS FILE EXISTS
 *
 * Two panels on the Overview page rendered the same `HealthState` union with two
 * different words. `UniversePanels.tsx` mapped `operational` to "Healthy";
 * `EcosystemGrid.tsx` mapped it to "Operational". Both read the same contract,
 * both were internally consistent, and an operator comparing them had no way to
 * know the two words meant one state.
 *
 * Duplicated presentation drifts exactly the way duplicated logic does — it just
 * takes longer to notice, because nothing fails. So the label map, the dot
 * colour and the provenance line live here, once, and every surface imports
 * them. A new panel cannot invent a third word without deleting this import.
 *
 * Expiry is applied HERE, at render time, so a verdict ages while the operator
 * is looking at it. Callers must not pre-resolve.
 */

export const STATE_LABEL: Record<HealthState, string> = {
  operational: "Healthy",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

export const STATE_DOT: Record<HealthState, string> = {
  operational: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-rose-400",
  unknown: "bg-slate-500",
};

/**
 * The provenance line that must accompany every state.
 *
 * A state is never shown alone: either how recently it was verified and by
 * what, or why it is unknown. This is the rule that makes an Unknown
 * actionable — "no probe target" and "observation expired" are different
 * problems and the operator has to be able to tell them apart.
 */
export const provenanceOf = (h: Health): string =>
  h.state === "unknown"
    ? h.reason
    : `${h.source} · ${ageLabel(h)}`;

/**
 * Badge treatment of the same vocabulary.
 *
 * The Ecosystem page had its own `STATUS_BADGE` map AND rendered `health.state`
 * raw with `capitalize`, so the operator read "Operational" there and "Healthy"
 * on the Overview grid — the same state, the same release, the same instant.
 * Centralising the colour as well as the word means a second presentation
 * cannot drift into a second vocabulary again.
 */
export const STATE_BADGE: Record<HealthState, string> = {
  operational: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300",
  degraded: "border-amber-400/20 bg-amber-500/10 text-amber-300",
  down: "border-rose-400/20 bg-rose-500/10 text-rose-300",
  unknown: "border-slate-400/20 bg-slate-500/10 text-slate-400",
};

/** Pill form: bordered badge carrying dot + the canonical word. */
export const HealthPill = ({ health }: { health: Health }) => {
  const h = current(health);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${STATE_BADGE[h.state]}`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[h.state]}`} />
      {STATE_LABEL[h.state]}
    </span>
  );
};

/** State dot + word. Resolves expiry itself; pass the raw Health. */
export const HealthBadge = ({ health }: { health: Health }) => {
  const h = current(health);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATE_DOT[h.state]}`} />
      <span className="text-slate-300">{STATE_LABEL[h.state]}</span>
    </span>
  );
};
