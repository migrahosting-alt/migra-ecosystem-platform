import Link from "next/link";
import {
  Server,
  Globe,
  Megaphone,
  Mail,
  Phone,
  FileText,
  Workflow,
} from "lucide-react";

const ACTIONS = [
  { label: "Hosting Accounts", href: "/console/hosting", icon: Server, accent: "from-sky-500 to-cyan-500" },
  { label: "Domains", href: "/console/domains", icon: Globe, accent: "from-indigo-500 to-blue-500" },
  { label: "Marketing", href: "/console/marketing", icon: Megaphone, accent: "from-pink-500 to-rose-500" },
  { label: "Email", href: "/console/email", icon: Mail, accent: "from-emerald-500 to-teal-500" },
  { label: "Intake", href: "/console/intake", icon: FileText, accent: "from-amber-500 to-yellow-500" },
  { label: "Voice", href: "/console/voice", icon: Phone, accent: "from-rose-500 to-orange-500" },
  { label: "Automation", href: "/console/automation", icon: Workflow, accent: "from-blue-500 to-indigo-500" },
];

export const QuickActions = () => {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 shadow-xl shadow-slate-950/30 backdrop-blur">
      <h2 className="mb-4 text-base font-semibold text-white">Quick Actions</h2>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        {ACTIONS.map(({ label, href, icon: Icon, accent }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-center transition hover:border-white/15 hover:bg-white/[0.04]"
          >
            <span
              className={`inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br ${accent} shadow-md transition group-hover:scale-105`}
            >
              <Icon className="h-5 w-5 text-white" />
            </span>
            <span className="text-[11px] font-medium leading-tight text-slate-300 group-hover:text-white">
              {label}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
};
