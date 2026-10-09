import Link from "next/link";

/**
 * The one way a module says "you arrived here focused on a subset".
 *
 * WHY THIS EXISTS
 *
 * Overview's attention items and estate counts are meant to be entry points: a
 * warning that names five VMs should open those five VMs. A link that lands on
 * an unfiltered list and leaves the operator to find them by hand is the
 * navigation equivalent of a button that reports success without doing
 * anything — it looks like it worked.
 *
 * So a focused arrival must be visible and honest about three things: how many
 * objects are shown, out of how many, and WHY these. It must also always be
 * escapable, or a filtered page becomes a trap.
 *
 * Shared rather than per-page so "focused" reads identically in Infrastructure,
 * Hosting and Automation — the same reason health has one label map.
 */
export const FocusBanner = ({
  shown,
  total,
  noun,
  because,
  clearHref,
  excluded,
}: {
  shown: number;
  total: number;
  /** Plural noun for the objects being counted, e.g. "nodes", "websites". */
  noun: string;
  /** Why exactly these — stated in the operator's terms, not a filter key. */
  because: string;
  clearHref: string;
  /** Optional account of what is NOT shown. Required by the rule that a
   *  filtered view must explain its own exclusions rather than silently hide. */
  excluded?: string;
}) => (
  <section className="rounded-xl border border-fuchsia-400/25 bg-fuchsia-500/[0.06] px-4 py-3">
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <p className="text-sm font-semibold text-white">
        Showing {shown} of {total} {noun}
      </p>
      <Link
        href={clearHref}
        className="rounded-md border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition hover:bg-white/10"
      >
        Show all {noun}
      </Link>
    </div>
    <p className="mt-1 text-xs leading-relaxed text-slate-300">{because}</p>
    {excluded ? <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{excluded}</p> : null}
  </section>
);
