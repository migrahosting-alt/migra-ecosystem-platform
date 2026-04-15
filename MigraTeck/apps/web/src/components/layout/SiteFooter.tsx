import Image from "next/image";
import Link from "next/link";
import type { AccountLinks } from "@/lib/account-links";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

function buildColumns(accountLinks: AccountLinks) {
  return [
    {
      title: "Public site",
      links: [
        { href: "/portfolio", label: "Portfolio" },
        { href: "/pricing", label: "Pricing" },
        { href: "/products", label: "All products" },
        { href: "/services", label: "Services" },
      ],
    },
    {
      title: "Platform",
      links: [
        { href: "/platform", label: "Architecture" },
        { href: "/developers", label: "Documentation" },
        { href: "/downloads", label: "Downloads" },
        { href: "/security", label: "Security" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/legal/terms", label: "Terms of Service" },
        { href: "/legal/privacy", label: "Privacy Policy" },
        { href: "/legal/payment", label: "Payment Policy" },
        { href: "/legal/acceptable-use", label: "Acceptable Use" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: "/company", label: "Company" },
        { href: "/legal", label: "Legal center" },
        { href: "/.well-known/security.txt", label: "security.txt" },
        { href: "mailto:support@migrateck.com", label: "Support" },
      ],
    },
    {
      title: "Account",
      links: [
        { href: accountLinks.login, label: "Log in" },
        { href: accountLinks.signup, label: "Create account" },
        { href: accountLinks.forgotPassword, label: "Reset password" },
        { href: accountLinks.sessions, label: "Sessions" },
      ],
    },
  ] as const;
}

export function SiteFooter({ accountLinks }: { accountLinks: AccountLinks }) {
  const columns = buildColumns(accountLinks);

  return (
    <footer className="px-6 pb-12 pt-4 sm:pb-14">
      <div className="mx-auto max-w-7xl overflow-hidden rounded-[2rem] border border-slate-700 bg-[radial-gradient(circle_at_top_left,rgba(26,168,188,0.18),transparent_30%),radial-gradient(circle_at_top_right,rgba(251,191,36,0.14),transparent_24%),linear-gradient(180deg,#080b20,#122033)] text-white shadow-[0_30px_80px_rgba(10,22,40,0.3)]">
      <div className={cn(ui.maxW, "pb-12 pt-16 sm:pb-16 sm:pt-20")}>
        <div className="grid gap-12 lg:grid-cols-[1.5fr_2fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-3">
              <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-white/10 bg-white/10 p-1">
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
              One platform story across products, services, pricing, developer entry,
              and verified software distribution.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3 lg:grid-cols-5">
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

        <div className="mt-12 flex items-center justify-between border-t border-white/[0.06] pt-8">
          <p className="text-xs text-slate-500">
            © {new Date().getFullYear()} MigraTeck. All rights reserved.
          </p>
          <div className="flex gap-2">
            {["Platform", "Commercial", "Verified distribution"].map((tag) => (
              <span key={tag} className={ui.pillDark}>{tag}</span>
            ))}
          </div>
        </div>
      </div>
      </div>
    </footer>
  );
}
