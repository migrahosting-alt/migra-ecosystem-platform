import { StatusPill } from "../components/DataTable";
import type { Alert, AlertPresentation } from "../lib/migraguard/reader";

export function Severity({severity}: {severity:Alert["severity"]}) {
  return <StatusPill status={severity} variant={severity === "critical" ? "bad" : "warn"} />;
}
export function GuardUnavailable({state}: {state:string}) {
  return <section role="status" className="border-y border-amber-400/20 py-6 text-sm">
    <h2 className="font-semibold text-amber-200">{state === "not-configured" ? "Alert feed not connected" : "Alert feed unavailable"}</h2>
    <p className="mt-2 text-slate-300">Protection status is unknown. Alert data could not be verified.</p>
  </section>;
}
export function Timestamp({value}: {value:string}) {
  const date = new Date(value);
  const display = new Intl.DateTimeFormat("en-US", {
    month:"short", day:"numeric", hour:"numeric", minute:"2-digit", timeZone:"UTC", timeZoneName:"short",
  }).format(date);
  return <time dateTime={value} title={date.toISOString()} className="text-xs text-slate-400">{display}</time>;
}

export function Metric({label,value,detail,tone="neutral"}: {
  label:string; value:string | number; detail:string; tone?:"neutral"|"good"|"warning"|"critical";
}) {
  const color=tone==="good" ? "text-emerald-300" : tone==="warning" ? "text-amber-200" : tone==="critical" ? "text-rose-300" : "text-white";
  return <div className="min-w-0 px-4 py-4 first:pl-0 last:pr-0">
    <dt className="text-xs font-medium text-slate-400">{label}</dt>
    <dd className={`mt-1 text-2xl font-semibold ${color}`}>{value}</dd>
    <p className="mt-1 text-xs leading-5 text-slate-500">{detail}</p>
  </div>;
}

export function AlertSummary({presentation}: {presentation:AlertPresentation}) {
  return <div className="min-w-0">
    <p className="break-words text-sm font-semibold text-white">{presentation.title}</p>
    <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{presentation.summary}</p>
  </div>;
}
