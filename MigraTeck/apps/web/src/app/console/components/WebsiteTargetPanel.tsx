import type { TargetPlane, TargetState, TargetStatus } from "../lib/hosting/target-status";

/**
 * WEBSITE TARGET — the operator's view of which server holds a site.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THREE PLANES ARE SHOWN SEPARATELY
 *
 * `targetJson` used to hold three facts with three different lifecycles in one
 * field: what provisioning intended, what guest exists, what serves traffic.
 * premtint.com is why that stopped: desired 137 (a guest that no longer
 * exists), discovered pod 505 (a 2 GB WordPress install), active app-core (the
 * Next.js rebuild the public actually reaches). Three different correct
 * answers. Collapsing them into one number destroys the information an operator
 * needs precisely when something has gone wrong.
 *
 * So the panel never summarises them into one line. It shows all three and lets
 * the disagreement be visible.
 *
 * COLOUR IS A CLAIM
 *
 * "Reconciled" is deliberately NOT green. Green reads as "this site is healthy",
 * and reconciled means something much narrower: the platform agrees with itself
 * about which server holds the site. yvescleaningservices.com is the standing
 * reminder — the one consistent record in the estate, pointing at a pod holding
 * 12 KB and no database. Consistent is not the same as complete.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const STATE_CLASS: Record<TargetState, string> = {
  // Sky, not emerald: records agree. That is information, not health.
  RECONCILED: "border-sky-400/25 bg-sky-500/10 text-sky-200",
  // Amber + ring: the platform holds two contradictory truths. Visually distinct
  // from "we are missing something", because acting on a conflict is worse than
  // acting on a gap — either choice could send a live site to the wrong place.
  CONFLICT: "border-amber-400/40 bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/30",
  RECONCILIATION_REQUIRED: "border-rose-400/25 bg-rose-500/10 text-rose-200",
  // Slate: nothing is recorded. An absence, not a contradiction.
  NO_TARGET: "border-slate-400/25 bg-slate-500/15 text-slate-300",
};

export const TargetStatePill = ({ status }: { status: TargetStatus | null }) => {
  if (!status) {
    // The control plane could not be reached. Say that; never render silence as
    // a pass — absence of a warning must not read as a positive assurance.
    return (
      <span className="inline-flex items-center rounded-md border border-slate-400/20 bg-slate-500/10 px-2 py-0.5 text-[10px] font-medium text-slate-400">
        Unknown
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${STATE_CLASS[status.state]}`}
    >
      {status.label}
    </span>
  );
};

const when = (iso: string | null) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
};

const PlaneRow = ({
  name,
  meaning,
  plane,
}: {
  name: string;
  meaning: string;
  plane: TargetPlane | null;
}) => (
  <div className="grid grid-cols-[7rem_1fr] gap-3 border-t border-white/5 py-2.5 first:border-t-0">
    <div>
      <p className="text-[11px] font-semibold text-white">{name}</p>
      <p className="mt-0.5 text-[10px] leading-snug text-slate-500">{meaning}</p>
    </div>
    <div>
      {plane && plane.vmid != null ? (
        <>
          <p className="text-xs font-medium text-slate-100">
            {plane.label || `VM ${plane.vmid}`}
            <span className="ml-1.5 font-normal text-slate-500">VM {plane.vmid}</span>
          </p>
          {plane.source ? (
            <p className="mt-0.5 text-[10px] leading-relaxed text-slate-500">{plane.source}</p>
          ) : null}
          {when(plane.at) ? (
            <p className="mt-0.5 text-[10px] text-slate-600">Observed {when(plane.at)}</p>
          ) : null}
        </>
      ) : (
        /* NOT a blank cell. For 22 of 24 sites nothing has ever established
           these planes, and an empty space would read as "nothing wrong here". */
        <p className="text-xs text-slate-500">
          Not established
          <span className="ml-1.5 text-[10px] text-slate-600">
            — this site has not been reconciled onto the target model
          </span>
        </p>
      )}
    </div>
  </div>
);

export const WebsiteTargetPanel = ({ status }: { status: TargetStatus | null }) => {
  if (!status) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
        <p className="text-sm font-semibold text-white">Website target</p>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          The control plane could not be reached, so this site&apos;s target state is unknown. No
          assumption is being made in either direction — server-changing actions remain guarded by the
          control plane itself.
        </p>
      </div>
    );
  }

  const conflicted =
    status.discovered?.vmid != null &&
    status.active?.vmid != null &&
    status.discovered.vmid !== status.active.vmid;

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-white">Website target</p>
        <TargetStatePill status={status} />
      </div>

      {/* The explanation comes before any internals. An operator should never
          have to read a VM number to find out why a button is missing. */}
      <p className="mt-2 text-xs leading-relaxed text-slate-200">{status.headline}</p>
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{status.detail}</p>

      {conflicted ? (
        <p className="mt-2 rounded-md border border-amber-400/25 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-200">
          The server holding this site&apos;s files is not the server answering its visitors. Binding
          either one automatically could point the live site at the wrong copy, so no automatic
          binding will be created.
        </p>
      ) : null}

      <div className="mt-3 rounded-md border border-white/5 bg-black/20 px-3 py-1">
        <PlaneRow name="Desired" meaning="what the records intend" plane={status.desired} />
        <PlaneRow name="Discovered" meaning="what workload was found" plane={status.discovered} />
        <PlaneRow name="Active" meaning="what serves traffic now" plane={status.active} />
      </div>

      {status.reconciliationReason ? (
        <div className="mt-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Evidence</p>
          <p className="mt-1 text-[11px] leading-relaxed text-slate-300">{status.reconciliationReason}</p>
        </div>
      ) : null}

      {status.activeExpiresAt && when(status.activeExpiresAt) ? (
        <p className="mt-2 text-[10px] text-slate-600">
          Traffic observation valid until {when(status.activeExpiresAt)}. After that it is treated as
          stale rather than current.
        </p>
      ) : null}

      {status.technical.length > 0 ? (
        <details className="group mt-3">
          <summary className="cursor-pointer list-none text-[11px] font-medium text-slate-400 transition hover:text-slate-200">
            <span className="inline-block transition group-open:rotate-90" aria-hidden>
              ›
            </span>{" "}
            Technical details
          </summary>
          <dl className="mt-2 space-y-1 rounded-md border border-white/5 bg-black/20 px-3 py-2">
            {status.technical.map((t) => (
              <div key={t.label} className="grid grid-cols-[10rem_1fr] gap-2">
                <dt className="text-[10px] text-slate-500">{t.label}</dt>
                <dd className="break-all text-[10px] text-slate-300">{t.value}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
};
