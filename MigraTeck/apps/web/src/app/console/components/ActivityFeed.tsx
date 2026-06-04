import Link from "next/link";
import { Server, Receipt, Megaphone, Phone, Inbox, ShieldAlert, FileText } from "lucide-react";

export type ActivityEvent = {
  id: string;
  kind: "hosting" | "billing" | "marketing" | "voice" | "intake" | "security" | "dns";
  title: string;
  context?: string;
  actor?: string;
  isoTime: string;
  relativeTime: string;
};

const ICONS: Record<ActivityEvent["kind"], { icon: React.ComponentType<{ className?: string }>; tone: string }> = {
  hosting: { icon: Server, tone: "from-sky-500/20 to-cyan-500/20 text-sky-300" },
  billing: { icon: Receipt, tone: "from-emerald-500/20 to-teal-500/20 text-emerald-300" },
  marketing: { icon: Megaphone, tone: "from-pink-500/20 to-rose-500/20 text-pink-300" },
  voice: { icon: Phone, tone: "from-rose-500/20 to-orange-500/20 text-rose-300" },
  intake: { icon: Inbox, tone: "from-amber-500/20 to-yellow-500/20 text-amber-300" },
  security: { icon: ShieldAlert, tone: "from-violet-500/20 to-purple-500/20 text-violet-300" },
  dns: { icon: FileText, tone: "from-indigo-500/20 to-blue-500/20 text-indigo-300" },
};

export const ActivityFeed = ({ events }: { events: ReadonlyArray<ActivityEvent> }) => {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">Unified Activity Feed</h2>
        <Link
          href="/console/analytics"
          className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200"
        >
          View All
        </Link>
      </div>

      {events.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-xs text-slate-500">
          No activity yet. As the ecosystem operates, events will appear here.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {events.map((evt) => {
            const Icon = ICONS[evt.kind].icon;
            return (
              <li key={evt.id} className="flex items-start gap-3">
                <span
                  className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${ICONS[evt.kind].tone}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-white">{evt.title}</p>
                  <p className="truncate text-[11px] text-slate-500">
                    {evt.context && <span>{evt.context}</span>}
                    {evt.context && evt.actor && <span> · </span>}
                    {evt.actor && <span>by {evt.actor}</span>}
                  </p>
                </div>
                <time className="shrink-0 text-[11px] text-slate-500" dateTime={evt.isoTime}>
                  {evt.relativeTime}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};
