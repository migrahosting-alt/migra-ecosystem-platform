"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import {
  Plus,
  Users,
  Globe,
  FileText,
  Server,
  Mail,
  Megaphone,
  Workflow,
  Phone,
} from "lucide-react";

const ITEMS = [
  { label: "New Client", href: "/console/clients/new", icon: Users, accent: "text-sky-400" },
  { label: "New Domain", href: "/console/domains/new", icon: Globe, accent: "text-indigo-400" },
  { label: "New Ticket", href: "/console/support/new", icon: FileText, accent: "text-amber-400" },
  { label: "Hosting Account", href: "/console/hosting/new", icon: Server, accent: "text-cyan-400" },
  { label: "Mailbox", href: "/console/email/new", icon: Mail, accent: "text-emerald-400" },
  { label: "Intake Form", href: "/console/intake/new", icon: FileText, accent: "text-yellow-400" },
  { label: "Campaign", href: "/console/marketing/new", icon: Megaphone, accent: "text-pink-400" },
  { label: "Automation Job", href: "/console/automation/new", icon: Workflow, accent: "text-blue-400" },
  { label: "Voice Number", href: "/console/voice/new", icon: Phone, accent: "text-rose-400" },
];

export const CreateNewMenu = () => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-fuchsia-500 to-pink-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-500/30 transition hover:scale-[1.02] hover:shadow-fuchsia-500/50"
      >
        <Plus className="h-4 w-4" />
        Create New
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-52 overflow-hidden rounded-xl border border-white/10 bg-slate-900 py-1.5 shadow-xl shadow-slate-950/60">
          <p className="px-3 pb-1 pt-0.5 text-[10px] uppercase tracking-wider text-slate-600">
            Go to module
          </p>
          {ITEMS.map(({ label, href, icon: Icon, accent }) => (
            <Link
              key={label}
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 text-sm text-slate-200 transition hover:bg-white/5 hover:text-white"
            >
              <Icon className={`h-4 w-4 shrink-0 ${accent}`} />
              {label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};
