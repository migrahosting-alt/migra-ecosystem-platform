import Image from "next/image";
import Link from "next/link";
import type { AccountLinks } from "@/lib/account-links";
import ui from "@/lib/ui";
import { cn } from "@/lib/cn";

function buildColumns(accountLinks: AccountLinks) {
  return [
    {
      title: "Products",
      links: [
        { href: "/products/migrahosting", label: "Hosting" },
        { href: "/products/migramail", label: "Business Email" },
        { href: "/services", label: "Website Services" },
        { href: "/pricing", label: "Pricing" },
      ],
    },
    {
      title: "Support",
      links: [
        { href: accountLinks.login, label: "Client Portal" },
        { href: "/support/elize-foundation-mail", label: "Email Setup Help" },
        { href: "/security", label: "Security" },
        { href: "mailto:support@migrateck.com", label: "Contact Support" },
      ],
    },
    {
      title: "Company",
      links: [
        { href: "/company", label: "Company" },
        { href: "/products", label: "All Products" },
        { href: "/services", label: "Services" },
        { href: "/portfolio", label: "Portfolio" },
      ],
    },
    {
      title: "Legal",
      links: [
        { href: "/legal/terms", label: "Terms of Service" },
        { href: "/legal/privacy", label: "Privacy Policy" },
        { href: "/legal/payment", label: "Payment Policy" },
        { href: "/legal/acceptable-use", label: "Acceptable Use" },
        { href: "/legal/sms-terms", label: "SMS Terms" },
      ],
    },
  ] as const;
}

export function SiteFooter({ accountLinks }: { accountLinks: AccountLinks }) {
  const columns = buildColumns(accountLinks);

  return (
    <footer className="px-5 pb-10 pt-2 sm:px-6 sm:pb-14">
      <div className="mx-auto max-w-7xl">
        <div className="page-glow overflow-hidden rounded-[34px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(250,244,255,0.84)_58%,rgba(255,247,241,0.88))] shadow-[var(--shadow-lg)] backdrop-blur-xl">
          <div className={cn(ui.maxW, "pb-10 pt-12 sm:pb-12 sm:pt-14")}>
            <div className="grid gap-10 lg:grid-cols-[1.1fr_1.9fr]">
              <div>
                <Link href="/" className="inline-flex items-center gap-3">
                  <div className={ui.logoBadge}>
                    <Image
                      src="/brands/products/migrateck.png"
                      alt="MigraHosting"
                      fill
                      sizes="40px"
                      className="object-contain"
                    />
                  </div>
                  <span className="font-[var(--font-display)] text-lg font-semibold tracking-[-0.03em] text-[var(--brand-ink)]">
                    MigraHosting
                  </span>
                </Link>
                <p className="mt-5 max-w-md text-sm leading-7 text-[var(--brand-muted)]">
                  Domains, hosting, email, websites, billing, and support in one clean client experience.
                </p>
                <div className="mt-6 flex flex-wrap gap-2">
                  {["Hosting", "Email", "Websites", "Client Portal"].map((tag) => (
                    <span key={tag} className={ui.pill}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
                {columns.map((column) => (
                  <div key={column.title}>
                    <p className={ui.eyebrowBrand}>{column.title}</p>
                    <ul className="mt-4 space-y-3">
                      {column.links.map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className="text-sm text-[var(--brand-muted)] transition duration-150 hover:text-[var(--brand-ink)]"
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

            <div className="mt-10 flex flex-col gap-3 border-t border-[var(--line)] pt-6 text-sm text-[var(--brand-soft)] sm:flex-row sm:items-center sm:justify-between">
              <p>© {new Date().getFullYear()} MigraHosting. All rights reserved.</p>
              <div className="flex flex-wrap gap-3">
                <Link href={accountLinks.login} className="font-medium text-[var(--brand-ink)]">
                  Client Portal
                </Link>
                <span aria-hidden="true">|</span>
                <Link href={accountLinks.forgotPassword} className="font-medium text-[var(--brand-ink)]">
                  Forgot password
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
