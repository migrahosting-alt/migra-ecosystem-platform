import Link from "next/link";
import type { ProductTile } from "../lib/ecosystem";
import { ProductLogo } from "./ProductLogo";

const STATUS_DOT: Record<ProductTile["status"], string> = {
  operational: "bg-emerald-400",
  degraded: "bg-amber-400",
  down: "bg-rose-400",
  unknown: "bg-slate-500",
};

const STATUS_LABEL: Record<ProductTile["status"], string> = {
  operational: "Operational",
  degraded: "Degraded",
  down: "Down",
  unknown: "Unknown",
};

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

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
          <p className="truncate text-sm font-semibold text-white">{tile.name}</p>
          <p className="truncate text-[11px] text-slate-400">{tile.subtitle}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-[11px]">
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[tile.status]}`} />
        <span className="text-slate-300">{STATUS_LABEL[tile.status]}</span>
      </div>

      <div className="mt-3">
        <p className="text-xl font-bold text-white">
          {tile.usagePct.toFixed(1)}
          <span className="text-base font-medium text-slate-400">%</span>
        </p>
        <p className="text-[10px] uppercase tracking-wider text-slate-500">Usage</p>
      </div>

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
