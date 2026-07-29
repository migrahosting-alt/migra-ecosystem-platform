import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, TriangleAlert, Info } from "lucide-react";

/* ----------------------------------------------------------------- tokens */

export const PRIORITY_TONE: Record<string, string> = {
  urgent: "border-red-400/30 bg-red-500/10 text-red-300",
  critical: "border-red-400/30 bg-red-500/10 text-red-300",
  high: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  normal: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  low: "border-slate-400/20 bg-slate-500/10 text-slate-400",
};

export const STATUS_TONE: Record<string, string> = {
  open: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  assigned: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  investigating: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  verifying: "border-sky-400/30 bg-sky-500/10 text-sky-300",
  escalated: "border-red-400/30 bg-red-500/10 text-red-300",
  waiting_on_user: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  actioned: "border-violet-400/30 bg-violet-500/10 text-violet-300",
  closed: "border-slate-400/20 bg-slate-500/10 text-slate-400",
  denied: "border-slate-400/20 bg-slate-500/10 text-slate-400",
};

export function pill(map: Record<string, string>, v: string): string {
  return `inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-medium ${
    map[v] ?? "border-slate-400/20 bg-slate-500/10 text-slate-300"
  }`;
}

export const labelize = (v: string): string => v.replace(/_/g, " ");

export const fmtDate = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toISOString().slice(0, 10);
};

export const fmtDateTime = (iso: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : `${d.toISOString().slice(0, 16).replace("T", " ")}Z`;
};

/* ------------------------------------------------------------- components */

export function StatCard({
  label,
  value,
  href,
  hint,
  footer,
  icon,
  accent = "text-white",
  unavailable = false,
}: {
  label: string;
  value: ReactNode;
  href?: string | undefined;
  hint?: string | undefined;
  footer?: ReactNode;
  icon?: ReactNode;
  accent?: string | undefined;
  unavailable?: boolean | undefined;
}) {
  const body = (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-4 shadow-xl shadow-slate-950/30 backdrop-blur transition hover:border-fuchsia-400/30">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[12px] font-medium text-slate-400">{label}</span>
        {icon && <span className="text-slate-500">{icon}</span>}
      </div>
      {unavailable ? (
        <div className="text-sm font-medium text-slate-500">Unavailable</div>
      ) : (
        <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      )}
      {hint && !unavailable && <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>}
      {footer && <div className="mt-auto pt-3 text-[11px]">{footer}</div>}
    </div>
  );
  if (href && !unavailable) {
    return (
      <Link href={href} className="block h-full">
        {body}
      </Link>
    );
  }
  return body;
}

export function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-[12px] text-slate-200">{value || "—"}</div>
    </div>
  );
}

const ALERT_TONE: Record<
  "critical" | "warning" | "info",
  { box: string; icon: ReactNode }
> = {
  critical: {
    box: "border-red-400/30 bg-red-500/[0.07]",
    icon: <TriangleAlert className="h-4 w-4 text-red-400" />,
  },
  warning: {
    box: "border-amber-400/30 bg-amber-500/[0.06]",
    icon: <AlertTriangle className="h-4 w-4 text-amber-400" />,
  },
  info: {
    box: "border-sky-400/30 bg-sky-500/[0.06]",
    icon: <Info className="h-4 w-4 text-sky-400" />,
  },
};

export function AlertRow({
  severity,
  title,
  detail,
  href,
}: {
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  href?: string | undefined;
}) {
  const t = ALERT_TONE[severity];
  const inner = (
    <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${t.box}`}>
      <span className="mt-0.5 shrink-0">{t.icon}</span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-white">{title}</div>
        <div className="text-[11px] text-slate-400">{detail}</div>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:opacity-90">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/** Inline unavailable notice for a panel whose native endpoint didn't load. */
export function PanelUnavailable({
  message,
  fallbackHref,
  fallbackLabel,
}: {
  message: string;
  fallbackHref?: string | undefined;
  fallbackLabel?: string | undefined;
}) {
  return (
    <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] px-4 py-4 text-[12px] text-amber-200/90">
      <p>{message}</p>
      {fallbackHref && fallbackLabel && (
        <a
          href={fallbackHref}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-fuchsia-300 hover:text-fuchsia-200"
        >
          {fallbackLabel} ↗
        </a>
      )}
    </div>
  );
}

export function LivePill({ connected, label }: { connected: boolean; label?: string | undefined }) {
  return connected ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-emerald-400/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
      {label ?? "Live"}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-400/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
      {label ?? "Unavailable"}
    </span>
  );
}
