import { redirect } from "next/navigation";

import { getSession } from "../../lib/auth";
import { AnnoupaleShell } from "../../components/annoupale/AnnoupaleShell";
import { SectionCard } from "../../components/SectionCard";
import { ANNOUPALE_BASE } from "../../lib/annoupale";
import {
  LivePill,
  PanelUnavailable,
  StatCard,
} from "../../components/annoupale/annoupale-ui";
import { adminReasonLabel } from "../../lib/annoupale/admin-fetch";
import { loadAnalytics } from "../../lib/annoupale/analytics";
import { fmtRate, fmtDelta } from "../../lib/annoupale/analytics-contract";

export const dynamic = "force-dynamic";

const labelize = (v: string) => v.replace(/_/g, " ");
const fmtInt = (n: number | null): string => (n === null ? "—" : n.toLocaleString("en-US"));

export default async function AnnoupaleAnalyticsPage() {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const result = await loadAnalytics();

  return (
    <AnnoupaleShell
      session={session}
      title="Analytics & Timeline"
      subtitle="Platform engagement, funnel health, and trend movement. Metrics are shown only when the analytics service returns them."
      actions={<LivePill connected={result.connected} label={result.connected ? "Live" : "Unavailable"} />}
    >
      {!result.connected ? (
        <SectionCard title="Analytics">
          <PanelUnavailable
            message={adminReasonLabel(result.reason)}
            fallbackHref={`${ANNOUPALE_BASE}/admin`}
            fallbackLabel="Open AnnouPale admin"
          />
        </SectionCard>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Active users"
              accent="text-emerald-300"
              unavailable={!result.realtime || result.realtime.activeUsers === null}
              value={result.realtime ? fmtInt(result.realtime.activeUsers) : "—"}
              hint="Realtime"
            />
            <StatCard
              label="Events (last hour)"
              accent="text-sky-300"
              unavailable={!result.realtime || result.realtime.eventsLastHour === null}
              value={result.realtime ? fmtInt(result.realtime.eventsLastHour) : "—"}
              hint="Realtime"
            />
            <StatCard
              label="Total events"
              accent="text-violet-300"
              unavailable={result.summary.totalEvents === null}
              value={fmtInt(result.summary.totalEvents)}
              hint="Window total"
            />
            <StatCard
              label="Window"
              accent="text-slate-200"
              value={result.summary.windowFrom ? result.summary.windowFrom.slice(0, 10) : "—"}
              hint={result.summary.windowTo ? `→ ${result.summary.windowTo.slice(0, 10)}` : undefined}
            />
          </div>

          {result.summary.cards.length > 0 && (
            <SectionCard title="Trend cards" subtitle="Current vs. previous period">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {result.summary.cards.map((c) => {
                  const value = c.format === "rate" ? fmtRate(c.current) : fmtInt(c.current);
                  const delta = fmtDelta(c.delta, c.format);
                  const up = (c.delta ?? 0) > 0;
                  const down = (c.delta ?? 0) < 0;
                  return (
                    <div key={c.key} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="text-[12px] text-slate-400">{c.label}</div>
                      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
                      {delta && (
                        <div className={`mt-0.5 text-[11px] ${up ? "text-emerald-300" : down ? "text-rose-300" : "text-slate-500"}`}>
                          {delta} vs prev
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </SectionCard>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <SectionCard title="Top events" subtitle="By volume in the window">
              {result.summary.topEvents.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-slate-500">No event counts returned.</p>
              ) : (
                <div className="space-y-1.5">
                  {result.summary.topEvents.map((e) => (
                    <div key={e.name} className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.02] px-3 py-2 text-[12px]">
                      <span className="text-slate-300">{labelize(e.name)}</span>
                      <span className="font-mono text-slate-400">{e.count.toLocaleString("en-US")}</span>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Funnel drop-off" subtitle="Largest single-step loss">
              {result.summary.topDropOff ? (
                <div className="rounded-xl border border-amber-400/20 bg-amber-500/[0.05] p-4">
                  <div className="text-[13px] font-semibold text-amber-200">
                    {labelize(result.summary.topDropOff.step)}
                  </div>
                  <div className="mt-1 text-2xl font-bold text-white">
                    {fmtRate(result.summary.topDropOff.lostRate)}
                  </div>
                  <div className="text-[11px] text-slate-400">of users lost at this step</div>
                </div>
              ) : (
                <p className="py-6 text-center text-[12px] text-slate-500">No drop-off data returned.</p>
              )}
            </SectionCard>
          </div>
        </>
      )}
    </AnnoupaleShell>
  );
}
