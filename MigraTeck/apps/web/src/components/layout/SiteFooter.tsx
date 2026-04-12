import Image from "next/image";
import Link from "next/link";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

const columns = [
  {
    title: "Products",
    links: [
      { href: "/products", label: "All products" },
      { href: "/platform", label: "Platform" },
      { href: "/downloads", label: "Downloads" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/developers", label: "Documentation" },
      { href: "/security", label: "Security" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/company", label: "About" },
      { href: "/services", label: "Services" },
      { href: "/.well-known/security.txt", label: "security.txt" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="section-dark">
      {/* top separator line */}
      <div className="glow-line mx-auto h-px max-w-5xl opacity-40" />

      <div className={cn(ui.maxW, "pb-12 pt-16 sm:pb-16 sm:pt-20")}>
        <div className="grid gap-12 lg:grid-cols-[1.5fr_2fr]">
          {/* brand */}
          <div>
            <Link href="/" className="inline-flex items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-xl">
                <Image
                  src="/brands/products/migrateck.png"
                  alt="MigraTeck"
                  fill
                  sizes="40px"
                  className="object-contain"
                />
              </div>
              <span className="font-[var(--font-display)] text-lg font-bold tracking-tight text-white">
                MigraTeck
              </span>
            </Link>
            <p className="mt-5 max-w-sm text-sm leading-6 text-slate-400">
              Enterprise infrastructure for identity, governance, product access,
              and software distribution.
            </p>
          </div>

          {/* link columns */}
          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <p className={ui.eyebrowDarkMuted}>{col.title}</p>
                <ul className="mt-4 space-y-3">
                  {col.links.map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className="text-sm text-slate-400 transition-colors duration-150 hover:text-white"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* bottom bar */}
        <div className="mt-12 flex items-center justify-between border-t border-white/[0.06] pt-8">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} MigraTeck. All rights reserved.
          </p>
          <div className="flex gap-2">
            {["10 products", "Enterprise", "API-first"].map((tag) => (
              <span key={tag} className={ui.pillDark}>{tag}</span>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
