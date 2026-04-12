"use client";

import type { FooterProps } from "@/lib/builder/types";

export function FooterSection({ props }: { props: FooterProps }) {
  return (
    <footer className="bg-gray-900 px-6 py-12 text-gray-300">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-col gap-8 md:flex-row md:justify-between">
          <div>
            <div className="text-lg font-bold text-white">{props.companyName}</div>
            {props.tagline && <p className="mt-1 text-sm text-gray-400">{props.tagline}</p>}
          </div>
          <div className="flex flex-wrap gap-6">
            {props.links.map((link, i) => (
              <a key={i} href={link.href} className="text-sm text-gray-400 hover:text-white transition">
                {link.label}
              </a>
            ))}
          </div>
          {props.socialLinks && props.socialLinks.length > 0 && (
            <div className="flex gap-4">
              {props.socialLinks.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="text-sm text-gray-400 hover:text-white transition">
                  {s.platform}
                </a>
              ))}
            </div>
          )}
        </div>
        <div className="mt-8 border-t border-gray-700 pt-6 text-center text-xs text-gray-500">
          {props.copyright || `© ${new Date().getFullYear()} ${props.companyName}. All rights reserved.`}
        </div>
      </div>
    </footer>
  );
}
