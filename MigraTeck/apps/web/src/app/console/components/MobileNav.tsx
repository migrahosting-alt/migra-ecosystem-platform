"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { NAV, isNavActive } from "./nav-items";

/**
 * Mobile console navigation: a hamburger trigger + slide-in drawer, shown only
 * below the `lg` breakpoint (the desktop Sidebar stays exactly as-is and is
 * hidden on small screens). Closes on nav select, backdrop click, the close
 * button, or Escape. Body scroll is locked while open.
 */
export const MobileNav = ({ activePath }: { activePath: string }) => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls="console-mobile-drawer"
        onClick={() => setOpen(true)}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white lg:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      {open && typeof document !== "undefined" && createPortal(
        // Portaled to <body> so the fixed overlay escapes the TopBar's
        // backdrop-filter, which otherwise becomes the containing block for
        // position:fixed and clamps the drawer to the header's height.
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="absolute inset-0 h-full w-full bg-slate-950/70 backdrop-blur-sm"
          />
          <aside
            id="console-mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Console navigation"
            className="absolute left-0 top-0 flex h-full w-72 max-w-[85vw] flex-col border-r border-white/10 bg-slate-950 shadow-2xl shadow-slate-950/60"
          >
            <div className="flex items-center justify-between px-5 py-5">
              <Link
                href="/console"
                onClick={() => setOpen(false)}
                className="flex items-center gap-3"
              >
                <span className="relative inline-flex h-10 w-10 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04]">
                  <Image
                    src="/brands/products/migrapanel-mark.png"
                    alt="MigraPanel"
                    fill
                    sizes="40px"
                    className="object-contain p-0.5"
                  />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-semibold text-white">MigraPanel</span>
                  <span className="block text-[10px] uppercase tracking-[0.24em] text-slate-500">Control Center</span>
                </span>
              </Link>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 pb-6">
              <ul className="space-y-0.5 text-sm">
                {NAV.map((item) => {
                  const active = isNavActive(item.href, activePath);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? "page" : undefined}
                        className={[
                          "group flex items-center gap-3 rounded-lg px-3 py-2.5 transition",
                          active
                            ? "bg-gradient-to-r from-fuchsia-500/15 via-purple-500/10 to-transparent text-white shadow-[inset_0_0_0_1px_rgba(217,70,239,0.25)]"
                            : "text-slate-400 hover:bg-white/5 hover:text-slate-100",
                        ].join(" ")}
                      >
                        {item.logoSrc ? (
                          <span className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded">
                            <Image src={item.logoSrc} alt="" fill sizes="16px" className="object-contain" />
                          </span>
                        ) : Icon ? (
                          <Icon
                            className={[
                              "h-4 w-4 shrink-0 transition",
                              active ? "text-fuchsia-300" : "text-slate-500 group-hover:text-slate-300",
                            ].join(" ")}
                          />
                        ) : null}
                        <span className="truncate">{item.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </aside>
        </div>,
        document.body,
      )}
    </>
  );
};
