"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

const DEBOUNCE_MS = 250;

export const ActivityFilterBar = ({
  actions,
}: {
  actions: ReadonlyArray<string>;
}) => {
  const router = useRouter();
  const params = useSearchParams();
  const [q, setQ] = useState(params.get("q") || "");
  const [action, setAction] = useState(params.get("action") || "");
  const [failuresOnly, setFailuresOnly] = useState(params.get("failures") === "1");
  const [, startTransition] = useTransition();
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildUrl = (nq: string, na: string, nf: boolean): string => {
    const sp = new URLSearchParams();
    if (nq) sp.set("q", nq);
    if (na) sp.set("action", na);
    if (nf) sp.set("failures", "1");
    const qs = sp.toString();
    return qs ? `/console/activity?${qs}` : "/console/activity";
  };

  const navigate = (nq: string, na: string, nf: boolean) => {
    startTransition(() => router.replace(buildUrl(nq, na, nf)));
  };

  const onQueryChange = (next: string) => {
    setQ(next);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => navigate(next, action, failuresOnly), DEBOUNCE_MS);
  };

  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
        <input
          type="text"
          value={q}
          placeholder="Search by actor, reason, or client name…"
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full rounded-md border border-white/10 bg-white/5 pl-9 pr-9 py-2 text-xs text-white placeholder:text-slate-500 focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
        />
        {q && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-white"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <select
        value={action}
        onChange={(e) => {
          setAction(e.target.value);
          navigate(q, e.target.value, failuresOnly);
        }}
        className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-white focus:border-fuchsia-400/40 focus:outline-none focus:ring-2 focus:ring-fuchsia-400/20"
      >
        <option value="" className="bg-slate-900">All actions</option>
        {actions.map((a) => (
          <option key={a} value={a} className="bg-slate-900">{a}</option>
        ))}
      </select>
      <label className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
        <input
          type="checkbox"
          checked={failuresOnly}
          onChange={(e) => {
            setFailuresOnly(e.target.checked);
            navigate(q, action, e.target.checked);
          }}
          className="rounded border-white/20 bg-white/5"
        />
        Failures only
      </label>
    </div>
  );
};
