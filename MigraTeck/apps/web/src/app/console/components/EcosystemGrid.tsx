import Link from "next/link";
import type { ProductTile } from "../lib/ecosystem";
// One vocabulary for operational state — this grid used to say "Operational"
// for the same state the service table called "Healthy".
import { HealthBadge, provenanceOf } from "./HealthState";
import { current } from "../lib/fleet/health-contract";
import { ProductLogo } from "./ProductLogo";

export const EcosystemGrid = ({ tiles }: { tiles: ReadonlyArray<ProductTile> }) => {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Ecosystem Control Grid</h2>
        <Link
          href="/console/ecosystem"
          className="rounded-md border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          Manage Ecosystem
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {tiles.map((t) => (
          <EcosystemTile key={t.id} tile={t} />
        ))}
      </div>
    </section>
  );
};

const EcosystemTile = ({ tile }: { tile: ProductTile }) => {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:border-white/20">
      <div className="flex items-start gap-3">
        <ProductLogo src={tile.logoSrc} alt={tile.logoAlt} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-white" title={tile.name}>{tile.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-400" title={tile.subtitle}>{tile.subtitle}</p>
        </div>
      </div>

      {/* Expiry is applied at render time, so a verdict ages while the operator
          is looking at it. A state is never shown without its provenance:
          either how recently it was verified, or why it is unknown. */}
      {(() => {
        const h = current(tile.health);
        return (
          <div className="mt-3 text-[11px]">
            <div className="flex items-center gap-1.5">
              <HealthBadge health={tile.health} />
            </div>
            <p className="mt-0.5 truncate text-[10px] text-slate-500" title={provenanceOf(h)}>
              {provenanceOf(h)}
            </p>
          </div>
        );
      })()}

      {/* REMOVED: a bare "N% Usage" figure. The percentage was real per tile but
          each denominator was different — % of users who logged in this week,
          % of websites active, audit events vs a trailing average, % of phone
          extensions enabled, % of successful job runs. Rendering all of them
          under one word "Usage" told the operator a number that answers no
          single question. It returns when each tile can state its own metric. */}

      <div className="mt-4 flex gap-2">
        <Link
          href={tile.primaryAction.href}
          className="flex-1 rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 py-1.5 text-center text-[11px] font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20"
        >
          {tile.primaryAction.label}
        </Link>
        <Link
          href={tile.secondaryAction.href}
          className="flex-1 rounded-md border border-white/10 bg-white/5 py-1.5 text-center text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
        >
          {tile.secondaryAction.label}
        </Link>
      </div>
    </div>
  );
};
