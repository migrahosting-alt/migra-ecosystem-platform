"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { labelize, fmtDateTime } from "./annoupale-ui";
import {
  AUDIT_ACTION_FILTERS,
  complianceCaseHref,
  distinctActors,
  filterAuditEvents,
  isComplianceCaseTarget,
  type AuditEventRow,
} from "../../lib/annoupale/audit-contract";

/**
 * Client view for the AnnouPale audit log. It receives an already-SAFE, server-
 * loaded window of rows (actor redacted, target id truncated, ipHash + metadata
 * already dropped at the contract gate) and filters that window in the browser.
 *
 * Honest scope: filters narrow the LOADED window only. No filtered backend total
 * is fabricated — counts are always labelled "in the loaded window". No token,
 * assertion, session id, or requester PII is present in these props.
 */
export function AuditLogView({
  items,
  windowCapped,
}: {
  items: AuditEventRow[];
  windowCapped: boolean;
}) {
  const [action, setAction] = useState<string>("all");
  const [actor, setActor] = useState<string>("all");
  const [target, setTarget] = useState<string>("");
  const [openId, setOpenId] = useState<string | null>(null);

  const actors = useMemo(() => distinctActors(items), [items]);
  const filtered = useMemo(
    () => filterAuditEvents(items, { action, actor, target }),
    [items, action, actor, target],
  );

  const hasFilters = action !== "all" || actor !== "all" || target.trim() !== "";
  const clear = () => {
    setAction("all");
    setActor("all");
    setTarget("");
  };

  const selCls =
    "rounded-md border border-white/10 bg-slate-900/60 px-2 py-1.5 text-[12px] text-slate-200 focus:border-fuchsia-400/40 focus:outline-none";

  return (
    <div>
      {/* filter controls — operate on the loaded window only */}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
          Action
          <select value={action} onChange={(e) => setAction(e.target.value)} className={selCls}>
            {AUDIT_ACTION_FILTERS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
          Actor
          <select
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            className={selCls}
            disabled={actors.length === 0}
          >
            <option value="all">All actors</option>
            {actors.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[10px] uppercase tracking-wide text-slate-500">
          Target
          <input
            type="search"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder="Filter loaded window by target…"
            className={`${selCls} min-w-[160px]`}
          />
        </label>
        {hasFilters && (
          <button
            type="button"
            onClick={clear}
            className="rounded-md border border-white/10 px-3 py-1.5 text-[12px] text-slate-400 hover:text-slate-200"
          >
            Clear
          </button>
        )}
      </div>

      <p className="mb-2 text-[11px] text-slate-500">
        Showing {filtered.length} of {items.length} event{items.length === 1 ? "" : "s"} in the loaded
        24h window{windowCapped ? " (window capped — refine in AnnouPale for older events)" : ""}.
        Filters apply to the loaded window only.
      </p>

      {filtered.length === 0 ? (
        <p className="py-8 text-center text-[12px] text-slate-500">
          {hasFilters
            ? "No events in the loaded window match these filters."
            : "No audit events in the last 24 hours."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 w-6" />
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Actor</th>
                <th className="px-3 py-2">Target</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => {
                const open = openId === e.id;
                const caseHref = isComplianceCaseTarget(e.targetType)
                  ? complianceCaseHref(e.targetRef)
                  : null;
                return (
                  <FragmentRow
                    key={e.id}
                    e={e}
                    open={open}
                    onToggle={() => setOpenId(open ? null : e.id)}
                    caseHref={caseHref}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FragmentRow({
  e,
  open,
  onToggle,
  caseHref,
}: {
  e: AuditEventRow;
  open: boolean;
  onToggle: () => void;
  caseHref: string | null;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-b border-white/5 text-[12px] text-slate-300 transition hover:bg-white/[0.02]"
        onClick={onToggle}
      >
        <td className="px-3 py-2 text-slate-500">
          <ChevronRight className={`h-3.5 w-3.5 transition ${open ? "rotate-90" : ""}`} />
        </td>
        <td className="px-3 py-2 text-slate-400">{fmtDateTime(e.createdAt)}</td>
        <td className="px-3 py-2 font-mono text-fuchsia-200">{e.actionType}</td>
        <td className="px-3 py-2">{e.actor}</td>
        <td className="px-3 py-2">
          {labelize(e.targetType)}
          {e.targetId ? <span className="ml-1 font-mono text-slate-500">{e.targetId}</span> : null}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-white/5 bg-black/20 text-[12px]">
          <td />
          <td colSpan={4} className="px-3 py-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Detail label="Time" value={fmtDateTime(e.createdAt)} />
              <Detail label="Action" value={<span className="font-mono text-fuchsia-200">{e.actionType}</span>} />
              <Detail label="Actor" value={e.actor} />
              <Detail
                label="Target"
                value={
                  <>
                    {labelize(e.targetType)}
                    {e.targetId ? <span className="ml-1 font-mono text-slate-500">{e.targetId}</span> : null}
                  </>
                }
              />
            </div>
            {caseHref && (
              <Link
                href={caseHref}
                className="mt-3 inline-flex items-center gap-1 text-[12px] text-fuchsia-300 hover:text-fuchsia-200"
              >
                Open related case →
              </Link>
            )}
            <p className="mt-3 text-[11px] text-slate-600">
              Hashed IPs and raw metadata are never shown in the console.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-slate-200">{value}</div>
    </div>
  );
}
