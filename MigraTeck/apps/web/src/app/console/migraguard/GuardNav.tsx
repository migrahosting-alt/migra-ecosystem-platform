"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const sections = [
  ["Overview", "/console/migraguard"],
  ["Incidents", "/console/migraguard/incidents"],
  ["Threats", "/console/migraguard/threats"],
  ["Correlations", "/console/migraguard/correlations"],
  ["Activity", "/console/migraguard/activity"],
  ["Assets", "/console/migraguard/assets"],
  ["Protection", "/console/migraguard/protection"],
  ["Identity", "/console/migraguard/protection/identity"],
  ["Edge / WAF", "/console/migraguard/protection/edge"],
  ["API", "/console/migraguard/protection/api"],
  ["Infrastructure", "/console/migraguard/protection/infrastructure"],
  ["Secrets", "/console/migraguard/protection/secrets"],
  ["Supply Chain", "/console/migraguard/protection/supply-chain"],
  ["Content", "/console/migraguard/protection/content"],
  ["Malware", "/console/migraguard/protection/malware"],
  ["Mail / DNS / TLS", "/console/migraguard/protection/mail"],
  ["Policies", "/console/migraguard/policies"],
  ["Compliance", "/console/migraguard/compliance"],
  ["Delivery", "/console/migraguard/delivery"],
  ["Response", "/console/migraguard/response"],
  ["Forensics", "/console/migraguard/forensics"],
  ["Monitoring", "/console/migraguard/monitoring"],
  ["Audit", "/console/migraguard/audit"],
] as const;

export function GuardNav() {
  const pathname=usePathname();
  return <nav aria-label="MigraGuard sections" className="guard-nav -mx-1 overflow-x-auto px-1 pb-1">
    <div className="flex min-w-max items-center gap-1 border-b border-white/10">
      {sections.map(([label,href])=>{
        const active=pathname===href;
        return <Link key={label} href={href} prefetch={false} className={`border-b-2 px-3 py-2.5 text-xs font-medium transition ${active ? "border-fuchsia-400 text-white" : "border-transparent text-slate-400 hover:border-white/20 hover:text-white"}`}>{label}</Link>;
      })}
    </div>
  </nav>;
}
