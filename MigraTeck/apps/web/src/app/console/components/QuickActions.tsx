import Link from "next/link";
import {
  Server,
  Globe,
  Megaphone,
  Mail,
  Phone,
  FileText,
  Workflow,
  Users,
  LifeBuoy,
} from "lucide-react";

const ACTIONS = [
  {
    label: "New Client",
    href: "/console/clients/new",
    manageHref: "/console/clients",
    manageLabel: "All Clients",
    icon: Users,
    accent: "from-fuchsia-500 to-pink-500",
  },
  {
    label: "New Hosting",
    href: "/console/hosting/new",
    manageHref: "/console/hosting",
    manageLabel: "Hosting",
    icon: Server,
    accent: "from-sky-500 to-cyan-500",
  },
  {
    label: "Add Domain",
    href: "/console/domains/new",
    manageHref: "/console/domains",
    manageLabel: "Domains",
    icon: Globe,
    accent: "from-indigo-500 to-blue-500",
  },
  {
    label: "New Mailbox",
    href: "/console/email/new",
    manageHref: "/console/email",
    manageLabel: "Email",
    icon: Mail,
    accent: "from-emerald-500 to-teal-500",
  },
  {
    label: "Open Ticket",
    href: "/console/support/new",
    manageHref: "/console/support",
    manageLabel: "Support",
    icon: LifeBuoy,
    accent: "from-slate-500 to-slate-600",
  },
  {
    label: "New Form",
    href: "/console/intake/new",
    manageHref: "/console/intake",
    manageLabel: "Intake",
    icon: FileText,
    accent: "from-amber-500 to-yellow-500",
  },
  {
    label: "New Campaign",
    href: "/console/marketing/new",
    manageHref: "/console/marketing",
    manageLabel: "Marketing",
    icon: Megaphone,
    accent: "from-pink-500 to-rose-500",
  },
  {
    label: "New Job",
    href: "/console/automation/new",
    manageHref: "/console/automation",
    manageLabel: "Automation",
    icon: Workflow,
    accent: "from-blue-500 to-indigo-500",
  },
  {
    label: "Add Number",
    href: "/console/voice/new",
    manageHref: "/console/voice",
    manageLabel: "Voice",
    icon: Phone,
    accent: "from-rose-500 to-orange-500",
  },
];

export const QuickActions = () => {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-white">Quick Actions</h2>
          <p className="text-[11px] text-slate-500">Create new records directly from the command center.</p>
        </div>
        <Link href="/console/clients/new" prefetch className="text-[11px] font-medium text-fuchsia-300 hover:text-fuchsia-200">
          Start with client
        </Link>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {ACTIONS.map(({ label, href, manageHref, manageLabel, icon: Icon, accent }) => (
          <div
            key={href}
            className="rounded-xl border border-white/5 bg-white/[0.02] p-3 transition hover:border-white/15 hover:bg-white/[0.04]"
          >
            <div className="flex items-start gap-3">
              <span
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${accent} shadow-md`}
              >
                <Icon className="h-5 w-5 text-white" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-[11px] text-slate-500">{manageLabel} workspace</p>
              </div>
            </div>
            <div className="mt-3 flex gap-2">
              <Link
                href={href}
                prefetch
                className="flex-1 rounded-md border border-fuchsia-400/30 bg-fuchsia-500/10 py-1.5 text-center text-[11px] font-semibold text-fuchsia-200 transition hover:bg-fuchsia-500/20"
              >
                Create
              </Link>
              <Link
                href={manageHref}
                prefetch
                className="flex-1 rounded-md border border-white/10 bg-white/5 py-1.5 text-center text-[11px] font-medium text-slate-300 transition hover:bg-white/10"
              >
                Open
              </Link>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};
