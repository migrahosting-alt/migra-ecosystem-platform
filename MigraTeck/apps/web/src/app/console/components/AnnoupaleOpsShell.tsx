import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, Lock } from "lucide-react";

/**
 * Presentational helpers for the native AnnouPale operations shells inside the
 * MigraPanel Command Center. These pages are HONEST placeholders: they make NO
 * AnnouPale API calls, show NO live counts or case rows, and deep-link to the
 * AnnouPale fallback admin. Native data is gated on a secure per-user staff
 * SSO / token-exchange bridge (not built yet).
 */

export type OpsTone = "pending" | "fallback" | "required" | "disabled" | "enforced" | "available";

const TONE: Record<OpsTone, { dot: string; badge: string }> = {
  pending: { dot: "bg-amber-400", badge: "border-amber-400/20 bg-amber-500/10 text-amber-300" },
  fallback: { dot: "bg-sky-400", badge: "border-sky-400/20 bg-sky-500/10 text-sky-300" },
  required: { dot: "bg-violet-400", badge: "border-violet-400/20 bg-violet-500/10 text-violet-300" },
  disabled: { dot: "bg-slate-500", badge: "border-slate-400/20 bg-slate-500/10 text-slate-400" },
  enforced: { dot: "bg-emerald-400", badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" },
  available: { dot: "bg-emerald-400", badge: "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" },
};

export function OpsPill({ tone, label }: { tone: OpsTone; label: string }) {
  const t = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium ${t.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label}
    </span>
  );
}

/** A premium status card (no live data — just the honest connection state). */
export function OpsStatusCard({
  icon,
  label,
  tone,
  status,
  detail,
}: {
  icon: ReactNode;
  label: string;
  tone: OpsTone;
  status: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500/20 to-pink-500/20 text-fuchsia-200">
          {icon}
        </span>
        <OpsPill tone={tone} label={status} />
      </div>
      <p className="mt-3 text-sm font-semibold text-white">{label}</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{detail}</p>
    </div>
  );
}

/** Honest "no live data" notice shown at the top of every native ops shell. */
export function NotConnectedNotice() {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-amber-400/20 bg-amber-500/[0.06] p-4">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
      <p className="text-[12px] leading-relaxed text-amber-100/90">
        <span className="font-semibold text-amber-200">Native data connection pending secure staff SSO.</span>{" "}
        No live case data is displayed here yet. Use the fallback link below to work in AnnouPale —
        which still enforces its own staff roles (<span className="text-amber-200/90">platform_admin</span>{" "}
        / <span className="text-amber-200/90">trust_safety_admin</span>). MigraPanel never bypasses those
        checks and stores no AnnouPale tokens.
      </p>
    </div>
  );
}

/** Primary external CTA (opens AnnouPale fallback) + secondary "back to module". */
export function OpsCtaRow({ primaryHref, primaryLabel }: { primaryHref: string; primaryLabel: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a
        href={primaryHref}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1.5 text-[11px] font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20"
      >
        {primaryLabel} <ArrowUpRight className="h-3.5 w-3.5" />
      </a>
      <Link
        href="/console/annoupale"
        className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
      >
        ← Back to AnnouPale module
      </Link>
    </div>
  );
}

/** Future-state section: lists planned native features, all gated on the SSO bridge. */
export function FutureStateList({ items }: { items: string[] }) {
  return (
    <div className="-mt-1 divide-y divide-white/5">
      {items.map((it) => (
        <div key={it} className="flex items-center justify-between gap-3 py-2">
          <span className="text-[12px] text-slate-300">{it}</span>
          <OpsPill tone="required" label="SSO bridge required" />
        </div>
      ))}
      <p className="pt-2 text-[10px] leading-relaxed text-slate-500">
        Planned native panels. They will replace these deep links once the secure per-user staff
        SSO / token-exchange is in place — backed by staff-scoped AnnouPale APIs, never a shared token.
      </p>
    </div>
  );
}
