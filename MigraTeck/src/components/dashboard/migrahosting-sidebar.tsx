"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
};

export function MigraHostingSidebar({
  orgName,
  role,
  navItems,
  supportHref,
}: {
  orgName: string;
  role: string;
  navItems: NavItem[];
  supportHref: string;
}) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col p-5">
      <div className="mb-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-4">
        <div className="relative h-11 w-11 overflow-hidden rounded-2xl ring-1 ring-white/10">
          <Image src="/MH.png" alt="MigraHosting" fill className="object-cover" priority />
        </div>

        <div className="leading-none">
          <div className="text-[17px] font-semibold tracking-[-0.02em] text-white">
            MigraHosting
          </div>
          <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.24em] text-white/50">
            Control Plane
          </div>
        </div>
      </div>

      <div className="mb-5 rounded-2xl border border-white/10 bg-[linear-gradient(135deg,rgba(124,58,237,0.18),rgba(236,72,153,0.12))] p-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-fuchsia-200/80">
          Active workspace
        </p>
        <p className="mt-2 text-sm font-semibold text-white">{orgName}</p>
        <p className="mt-1 text-xs text-white/55">{role} access</p>
      </div>

      <nav className="space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Link
              key={item.label}
              href={item.href}
              className={[
                "group flex items-center rounded-2xl px-4 py-3 text-sm font-medium transition",
                active
                  ? "bg-[linear-gradient(135deg,rgba(124,58,237,0.22),rgba(236,72,153,0.18))] text-white ring-1 ring-white/10"
                  : "text-white/65 hover:bg-white/[0.04] hover:text-white",
              ].join(" ")}
            >
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <p className="text-sm font-semibold text-white">Need help?</p>
        <p className="mt-1 text-xs leading-5 text-white/55">
          Manage infrastructure, billing, and support from one portal.
        </p>

        <a
          href={supportHref}
          className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-3 text-sm font-medium text-white/80 transition hover:bg-white/[0.06] hover:text-white"
        >
          Contact support
        </a>
      </div>
    </div>
  );
}
