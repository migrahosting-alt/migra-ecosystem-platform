import Link from "next/link";
import Image from "next/image";
import { productsByKey } from "@/data/products";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Platform",
  description:
    "The MigraHosting platform gives customers one place to manage domains, hosting, email, websites, billing, and support.",
  path: "/platform",
});

const platformAreas = [
  {
    name: "Domains",
    desc: "Search, register, renew, and manage DNS records from the same account.",
  },
  {
    name: "Hosting",
    desc: "Launch shared or managed hosting with plan details, billing, and support in one place.",
  },
  {
    name: "Email",
    desc: "Set up business mailboxes, manage access, and find support guides without leaving the portal.",
  },
  {
    name: "Websites",
    desc: "Review website service requests, launch work, and ongoing updates from a single account.",
  },
  {
    name: "Billing",
    desc: "View invoices, payment history, renewals, and service status with clear account context.",
  },
  {
    name: "Support",
    desc: "Use one support path for hosting, websites, billing questions, and account help.",
  },
] as const;

const customerFlow = [
  "Pick a product or service from the public site.",
  "Create an account or sign in to the client portal.",
  "Choose a plan, request setup, or open the right support path.",
  "Manage renewals, service details, and billing from the same account.",
] as const;

const trustNotes = [
  "One customer account across domains, hosting, websites, and email.",
  "Direct links into billing, renewals, service access, and support.",
  "Shared security and login paths without making the public site feel technical.",
] as const;

const linkedProducts = [
  productsByKey.migrahosting,
  productsByKey.migramail,
  productsByKey.migrapanel,
] as const;

export default function PlatformPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Platform", url: absoluteUrl("/platform") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-5rem] top-28 h-72 w-72 rounded-full bg-violet-300/30 blur-[95px]" />
        <div className="pointer-events-none absolute right-[-4rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/35 blur-[110px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-3xl">
            <p className={ui.eyebrowBrand}>Client platform</p>
            <h1 className={cn(ui.h1, "mt-5 max-w-2xl")}>
              One place to manage domains, hosting, email, websites, billing, and support.
            </h1>
            <p className={cn(ui.body, "mt-6 max-w-2xl")}>
              The MigraHosting platform keeps the customer side simple. You can buy services
              from the public site, then manage them through one client portal with clear
              billing, account access, and support paths.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/login" className={ui.btnPrimary}>
                Open client portal
              </Link>
              <Link href="/request-access" className={ui.btnSecondary}>
                Request access
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>What the platform covers</p>
          <h2 className={cn(ui.h2, "mt-3")}>Everything customers need to manage after purchase.</h2>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {platformAreas.map((area) => (
              <div key={area.name} className={cn(ui.card, ui.cardHover, "p-6")}>
                <h3 className={cn(ui.h3, "text-[1.35rem]")}>{area.name}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-600">{area.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[1fr_1.05fr]">
            <div className={cn(ui.cardStrong, "p-8 sm:p-10")}>
              <p className={ui.eyebrowBrand}>Customer flow</p>
              <h2 className={cn(ui.h2, "mt-3 max-w-lg")}>
                The public site and portal are designed to work together.
              </h2>
              <div className="mt-8 space-y-4">
                {customerFlow.map((step, index) => (
                  <div key={step} className={cn(ui.cardMuted, "flex items-start gap-4 p-4")}>
                    <span className={ui.depthNum}>{index + 1}</span>
                    <p className="pt-1 text-sm leading-6 text-slate-700">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={cn(ui.card, "p-8 sm:p-10")}>
              <p className={ui.eyebrowBrand}>Why it works</p>
              <h2 className={cn(ui.h2, "mt-3 max-w-lg")}>Simple for customers, structured behind the scenes.</h2>
              <div className="mt-8 space-y-4">
                {trustNotes.map((note) => (
                  <div key={note} className="flex items-start gap-3">
                    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-fuchsia-600">
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <p className="text-sm leading-6 text-slate-700">{note}</p>
                  </div>
                ))}
              </div>

              <div className="mt-8 grid gap-4 sm:grid-cols-3">
                {linkedProducts.map((product) => (
                  <Link key={product.key} href={`/products/${product.slug}`} className={cn(ui.cardMuted, "block p-4")}>
                    <div className="flex items-center gap-3">
                      <div className={ui.logoBadge}>
                        <Image src={product.logo} alt={product.name} fill sizes="44px" className="object-contain p-1" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-[var(--brand-ink)]">{product.name}</p>
                        <p className="text-xs text-slate-500">View details</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className={cn(ui.card, "p-8 text-center sm:p-10")}>
            <p className={ui.eyebrowBrand}>Start here</p>
            <h2 className={cn(ui.h2, "mt-3")}>Need a new account or want to manage an existing service?</h2>
            <p className={cn(ui.body, "mx-auto mt-4 max-w-2xl")}>
              Use the public site to choose a service, then move into the client portal for
              account access, service management, and support.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/products" className={ui.btnPrimary}>
                Browse products
              </Link>
              <Link href="/login" className={ui.btnSecondary}>
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
