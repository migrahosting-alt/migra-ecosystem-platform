import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { products } from "@/data/products";
import { getAccountLinks } from "@/lib/account-links";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata: Metadata = buildPageMetadata({
  title: "MigraHosting | Domains, hosting, email, websites, and support",
  description:
    "Everything you need online in one place: domains, hosting, business email, websites, billing, and support through one simple client portal.",
  path: "/",
});

const productCards = [
  {
    title: "Domains",
    description: "Register, connect, and manage the address your business needs online.",
    href: "/products/migrahosting",
    icon: "globe",
  },
  {
    title: "Hosting",
    description: "Launch fast hosting with room to grow when your site gets serious.",
    href: "/products/migrahosting",
    icon: "server",
  },
  {
    title: "Email",
    description: "Set up branded inboxes that look professional from day one.",
    href: "/products/migramail",
    icon: "mail",
  },
  {
    title: "Websites",
    description: "Get a clean business website live without piecing together five services.",
    href: "/services",
    icon: "layout",
  },
  {
    title: "Security",
    description: "Protect logins, billing, and customer data with sensible safeguards.",
    href: "/security",
    icon: "shield",
  },
  {
    title: "Client Portal",
    description: "Manage services, invoices, and support tickets from one simple dashboard.",
    href: "/login",
    icon: "panel",
  },
] as const;

const previewCards = [
  {
    title: "Hosting",
    price: "From $3.99/mo",
    description: "Dedicated VPS plans for businesses that want reliable performance and clear upgrade paths.",
    href: "/products/migrahosting",
    action: "Choose Hosting",
  },
  {
    title: "Business Email",
    price: "From $7/mo",
    description: "Professional email with your own domain, sensible mailbox options, and setup help if you need it.",
    href: "/products/migramail",
    action: "View Email Plans",
  },
  {
    title: "Website Service",
    price: "Launch packages",
    description: "Get a polished site, connected domain, business email, and support without a long project cycle.",
    href: "/services",
    action: "See Website Service",
  },
] as const;

const reasons = [
  {
    title: "Fast setup",
    description: "Start with the essentials quickly instead of stitching together vendors and waiting on handoffs.",
  },
  {
    title: "Secure infrastructure",
    description: "Keep accounts, billing, and customer access inside a setup built with security in mind.",
  },
  {
    title: "Real support",
    description: "When you need help, you talk to a team that understands hosting, email, and launch work together.",
  },
  {
    title: "Simple billing",
    description: "Track services and invoices in one portal instead of chasing billing across separate tools.",
  },
] as const;

function ProductIcon({ icon }: { icon: (typeof productCards)[number]["icon"] }) {
  const shared = "h-6 w-6 text-[var(--brand-violet)]";

  switch (icon) {
    case "globe":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
          <path d="M3 12h18M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9Z" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      );
    case "server":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
          <rect x="4" y="4" width="16" height="6" rx="2" />
          <rect x="4" y="14" width="16" height="6" rx="2" />
          <path d="M8 7h.01M8 17h.01M12 7h4M12 17h4" />
        </svg>
      );
    case "mail":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
          <rect x="3" y="5" width="18" height="14" rx="3" />
          <path d="m6 8 6 5 6-5" />
        </svg>
      );
    case "layout":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M3 10h18M9 10v10" />
        </svg>
      );
    case "shield":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
          <path d="M12 3 5 6v6c0 4.4 2.7 8.4 7 10 4.3-1.6 7-5.6 7-10V6l-7-3Z" />
          <path d="m9.5 12 1.7 1.7 3.3-3.4" />
        </svg>
      );
    case "panel":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={shared}>
          <rect x="3" y="4" width="18" height="16" rx="3" />
          <path d="M8 4v16M3 10h18" />
        </svg>
      );
  }
}

export default function HomePage() {
  const accountLinks = getAccountLinks();
  const migraHosting = products.find((product) => product.slug === "migrahosting");
  const migraMail = products.find((product) => product.slug === "migramail");

  return (
    <>
      <section className="hero-gradient hero-mesh relative overflow-hidden px-5 pb-16 pt-10 sm:px-6 sm:pb-20">
        <div className="gradient-orb gradient-orb-violet left-[-3rem] top-24 h-40 w-40 sm:h-56 sm:w-56" />
        <div className="gradient-orb gradient-orb-peach right-[-2rem] top-6 h-36 w-36 sm:h-48 sm:w-48" />
        <div className="gradient-orb gradient-orb-pink bottom-10 right-[22%] h-28 w-28 sm:h-40 sm:w-40" />

        <div className={cn(ui.maxW, "relative")}>
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="animate-fade-up">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/82 px-4 py-2 text-sm font-medium text-[var(--brand-muted)] shadow-[0_10px_28px_rgba(109,40,217,0.08)]">
                <span className="h-2 w-2 rounded-full bg-[var(--brand-violet)]" />
                One simple client portal for hosting, email, and support
              </div>

              <h1 className={cn(ui.h1, "mt-6 max-w-3xl")}>
                Everything you need online. <span className="gradient-text">All in one place.</span>
              </h1>
              <p className={cn(ui.body, "mt-6 max-w-2xl")}>
                Domains, hosting, email, websites, billing, and support from one simple client portal.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/products/migrahosting" className={ui.btnPrimary}>
                  Search Domain
                </Link>
                <Link href="/products/migrahosting" className={ui.btnSecondary}>
                  Choose Hosting
                </Link>
              </div>

              <div className="mt-8 grid max-w-2xl gap-3 sm:grid-cols-3">
                {[
                  "Register and manage domains",
                  "Launch hosting and business email",
                  "Pay invoices and get support in one place",
                ].map((item) => (
                  <div key={item} className="rounded-[22px] border border-white/80 bg-white/74 px-4 py-4 text-sm text-[var(--brand-muted)] shadow-[0_10px_26px_rgba(109,40,217,0.06)]">
                    {item}
                  </div>
                ))}
              </div>
            </div>

            <div className="animate-fade-up-d2">
              <div className="page-glow relative overflow-hidden rounded-[34px] border border-white/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(250,244,255,0.92)_58%,rgba(255,247,241,0.92))] p-6 shadow-[var(--shadow-lg)] sm:p-7">
                <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-fuchsia-100/70 blur-3xl" />
                <div className="pointer-events-none absolute bottom-0 left-0 h-32 w-32 rounded-full bg-orange-100/70 blur-3xl" />

                <div className="flex items-center gap-4">
                  <div className={ui.logoBadgeLg}>
                    <Image
                      src="/brands/products/migrateck-official.png"
                      alt="MigraHosting"
                      fill
                      sizes="56px"
                      className="object-contain"
                    />
                  </div>
                  <div>
                    <p className={ui.eyebrowBrand}>MigraHosting</p>
                    <h2 className="mt-1 font-[var(--font-display)] text-2xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)]">
                      Everything you need online.
                    </h2>
                  </div>
                </div>

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {productCards.map((card) => (
                    <Link
                      key={card.title}
                      href={card.href}
                      className="surface-card rounded-[24px] p-4 transition duration-200 hover:-translate-y-1 hover:bg-white/90"
                    >
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,rgba(124,58,237,0.14),rgba(251,146,60,0.14))]">
                        <ProductIcon icon={card.icon} />
                      </div>
                      <h3 className="mt-4 text-lg font-semibold text-[var(--brand-ink)]">{card.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{card.description}</p>
                    </Link>
                  ))}
                </div>

                <div className="mt-5 rounded-[24px] border border-white/80 bg-white/82 px-5 py-4 shadow-[0_12px_30px_rgba(109,40,217,0.06)]">
                  <p className="text-sm font-semibold text-[var(--brand-ink)]">Blazing fast setup. Secure access. Real support.</p>
                  <p className="mt-1 text-sm text-[var(--brand-muted)]">
                    Build your online presence with one team handling the hosting, billing, and support path.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPySmall, "section-wash")}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-3xl text-center">
            <p className={ui.eyebrowBrand}>Product preview</p>
            <h2 className={cn(ui.h2, "mt-3")}>Start with the products most businesses need first.</h2>
            <p className={cn(ui.bodySmall, "mx-auto mt-4 max-w-2xl text-base")}>
              Pick the part you need today, then add email, website services, or client access as you grow.
            </p>
          </div>

          <div className="mt-10 grid gap-5 lg:grid-cols-3">
            {previewCards.map((card) => (
              <article key={card.title} className={cn(ui.cardStrong, "p-6 sm:p-7")}>
                <p className={ui.eyebrowBrand}>{card.title}</p>
                <h3 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-[var(--brand-ink)]">{card.price}</h3>
                <p className="mt-3 text-sm leading-7 text-[var(--brand-muted)]">{card.description}</p>
                <Link href={card.href} className="mt-6 inline-flex text-sm font-semibold text-[var(--brand-violet)]">
                  {card.action}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <p className={ui.eyebrowBrand}>Why MigraHosting</p>
              <h2 className={cn(ui.h2, "mt-3")}>A cleaner way to buy and manage hosting services.</h2>
              <p className={cn(ui.body, "mt-4 max-w-xl")}>
                Visitors should know what they can buy quickly, and customers should know where to manage it after checkout. That is the whole point of this experience.
              </p>

              <div className="mt-6 space-y-4">
                {[
                  `Hosting from ${migraHosting?.name ?? "MigraHosting"}`,
                  `Professional inboxes from ${migraMail?.name ?? "MigraMail"}`,
                  "Simple access to billing and support",
                ].map((line) => (
                  <div key={line} className="flex items-center gap-3 text-sm font-medium text-[var(--brand-ink)]">
                    <span className={ui.depthNum}>✓</span>
                    <span>{line}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {reasons.map((reason, index) => (
                <article key={reason.title} className={cn(ui.card, ui.cardHover, "p-5 sm:p-6")}>
                  <div className={ui.depthNum}>{index + 1}</div>
                  <h3 className="mt-4 text-xl font-semibold text-[var(--brand-ink)]">{reason.title}</h3>
                  <p className="mt-2 text-sm leading-7 text-[var(--brand-muted)]">{reason.description}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-10")}>
        <div className={ui.maxW}>
          <div className="page-glow overflow-hidden rounded-[36px] border border-white/80 bg-[linear-gradient(135deg,rgba(247,239,255,0.92),rgba(255,255,255,0.96)_52%,rgba(255,244,236,0.96))] px-6 py-10 text-center shadow-[var(--shadow-lg)] sm:px-10 sm:py-12">
            <p className={ui.eyebrowBrand}>Ready to start</p>
            <h2 className={cn(ui.h2, "mt-3")}>Start with your domain today.</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-[var(--brand-muted)]">
              Search for your next name, choose the hosting plan that fits, and keep your billing and support in one place from day one.
            </p>

            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/products/migrahosting" className={ui.btnPrimary}>
                Search Domain
              </Link>
              <Link href={accountLinks.login} className={ui.btnSecondary}>
                Open Client Portal
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
