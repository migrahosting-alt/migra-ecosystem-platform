"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Filter, X } from "lucide-react";

// Mirrors ReportStatus (kept here so this client component never imports the
// server-only pale-live/pale-db module into the browser bundle).
const STATUSES = ["pending", "reviewing", "escalated", "reviewed", "dismissed", "actioned"] as const;

const FIELD = "rounded-md border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[12px] text-slate-200 focus:border-fuchsia-400/40 focus:outline-none";

export const ReportFiltersBar = ({
  status,
  type,
  from,
  to,
}: {
  status: string;
  type: string;
  from: string;
  to: string;
}) => {
  const router = useRouter();
  const [s, setS] = useState(status);
  const [t, setT] = useState(type);
  const [f, setF] = useState(from);
  const [tt, setTt] = useState(to);
  const active = !!(status || type || from || to);

  const apply = (e?: FormEvent) => {
    e?.preventDefault();
    const q = new URLSearchParams();
    if (s) q.set("status", s);
    if (t.trim()) q.set("type", t.trim());
    if (f) q.set("from", f);
    if (tt) q.set("to", tt);
    const qs = q.toString();
    router.push(`/console/pale/reports${qs ? `?${qs}` : ""}`);
  };

  const clear = () => {
    setS(""); setT(""); setF(""); setTt("");
    router.push("/console/pale/reports");
  };

  return (
    <form onSubmit={apply} className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
      <span className="inline-flex items-center gap-1 pb-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-500">
        <Filter className="h-3 w-3" /> Filters
      </span>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-600">Status</span>
        <select aria-label="Filter by status" value={s} onChange={(e) => setS(e.target.value)} className={FIELD}>
          <option value="">All</option>
          {STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-600">Target type</span>
        <input aria-label="Filter by target type" value={t} onChange={(e) => setT(e.target.value)} placeholder="user, message…" className={`${FIELD} w-32`} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-600">From</span>
        <input type="date" aria-label="Created from" value={f} onChange={(e) => setF(e.target.value)} className={FIELD} />
      </label>
      <label className="flex flex-col gap-0.5">
        <span className="text-[9px] uppercase tracking-wider text-slate-600">To</span>
        <input type="date" aria-label="Created to" value={tt} onChange={(e) => setTt(e.target.value)} className={FIELD} />
      </label>
      <button type="submit" className="rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 px-3 py-1.5 text-[11px] font-medium text-fuchsia-200 transition hover:bg-fuchsia-500/20">
        Apply
      </button>
      {active && (
        <button type="button" onClick={clear} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition hover:bg-white/10">
          <X className="h-3 w-3" /> Clear
        </button>
      )}
    </form>
  );
};
