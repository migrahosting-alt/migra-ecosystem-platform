"use client";

import type { NavbarProps } from "@/lib/builder/types";

export function NavbarSection({ props }: { props: NavbarProps }) {
  return (
    <nav className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200">
      <div className="flex items-center gap-2">
        {props.logoUrl ? (
          <img src={props.logoUrl} alt={props.logoText} className="h-8" />
        ) : (
          <span className="text-xl font-bold text-gray-900">{props.logoText}</span>
        )}
      </div>
      <div className="hidden md:flex items-center gap-6">
        {props.links.map((link, i) => (
          <a key={i} href={link.href} className="text-sm text-gray-600 hover:text-gray-900 transition">
            {link.label}
          </a>
        ))}
        {props.ctaLabel && (
          <a
            href={props.ctaHref || "#"}
            className="rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition"
          >
            {props.ctaLabel}
          </a>
        )}
      </div>
    </nav>
  );
}
