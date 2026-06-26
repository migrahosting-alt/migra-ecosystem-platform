import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { getProductLegalHref } from "@/content/legal";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, buildSoftwareApplication, SITE_ROOT } from "@/lib/structured-data";
import { buildInquiryHref } from "@/lib/inquiry";
import ui from "@/lib/ui";
import { products } from "@/data/products";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

type ProductPageConfig = {
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  offerTitle: string;
  offerCards: Array<{ title: string; detail: string }>;
  trustTitle: string;
  trustNotes: string[];
  faqTitle: string;
  faqItems: Array<{ question: string; answer: string }>;
};

const defaultConfig: ProductPageConfig = {
  primaryCta: { label: "Request access", href: "/signup" },
  secondaryCta: { label: "Open client portal", href: "/login" },
  offerTitle: "Main offer",
  offerCards: [
    { title: "Clear entry point", detail: "Start with the core service first and add related tools when you need them." },
    { title: "Simple access", detail: "Keep sign-in, account handling, and support under one branded experience." },
    { title: "Human support path", detail: "Use the client portal or direct support channels when setup questions come up." },
  ],
  trustTitle: "Trust notes",
  trustNotes: [
    "Clear product pages and account entry points",
    "Customer-facing billing and support routes",
    "No need to decode internal platform language before you buy",
  ],
  faqTitle: "Before you start",
  faqItems: [
    {
      question: "How do I get started?",
      answer: "Use the main call to action near the top of the page, then follow the request, signup, or portal flow that matches this product.",
    },
    {
      question: "Can I manage this later in the client portal?",
      answer: "Yes. Once you have access, the portal is the place to review services, billing, and support activity.",
    },
  ],
};

const productConfigs: Record<string, ProductPageConfig> = {
  migrahosting: {
    primaryCta: { label: "Choose hosting", href: "/request-access?product=migrahosting" },
    secondaryCta: { label: "Start with a domain", href: "/products" },
    offerTitle: "What you can start with",
    offerCards: [
      { title: "Dedicated hosting", detail: "Choose hosting built for clean performance, straightforward upgrades, and real business use." },
      { title: "Domain setup", detail: "Connect the domain you already have or start with a new one before launch." },
      { title: "Portal billing and support", detail: "Keep services, invoices, and support requests in one place instead of splitting them across tools." },
    ],
    trustTitle: "Why businesses choose MigraHosting",
    trustNotes: [
      "Hosting, billing, and support follow one customer path",
      "Business-ready setup instead of a cluttered hosting stack",
      "Simple request and portal flows from the start",
    ],
    faqTitle: "Hosting questions",
    faqItems: [
      {
        question: "Do I need to start with everything at once?",
        answer: "No. You can start with hosting first, then add email, website services, or extra support as your setup grows.",
      },
      {
        question: "Where do I manage my service after signup?",
        answer: "Use the client portal to review service status, invoices, and support activity.",
      },
      {
        question: "Can I request help before purchasing?",
        answer: "Yes. Use the request-access or inquiry flow if you want help choosing the right hosting starting point.",
      },
    ],
  },
  migramail: {
    primaryCta: { label: "Get business email", href: "/signup" },
    secondaryCta: { label: "Email setup help", href: "/support/elize-foundation-mail" },
    offerTitle: "What this product covers",
    offerCards: [
      { title: "Branded inboxes", detail: "Use your own domain for a more professional client-facing email presence." },
      { title: "Setup support", detail: "Get help connecting mail on phones, desktops, and common email apps." },
      { title: "Portal access", detail: "Track services and support in the same place you handle the rest of your account." },
    ],
    trustTitle: "Why businesses choose MigraMail",
    trustNotes: [
      "Branded mailboxes tied to your business domain",
      "Clear setup help instead of trial-and-error configuration",
      "One account path across email, hosting, and support",
    ],
    faqTitle: "Email questions",
    faqItems: [
      {
        question: "Can I use my existing domain for email?",
        answer: "Yes. Business email can be paired with your current domain once the account is set up.",
      },
      {
        question: "Is there setup help available?",
        answer: "Yes. The email setup support page walks through incoming and outgoing mail settings, and the support team can help if needed.",
      },
    ],
  },
  migrapanel: {
    primaryCta: { label: "Open client portal", href: "/login" },
    secondaryCta: { label: "Create account", href: "/signup" },
    offerTitle: "What this product covers",
    offerCards: [
      { title: "Service overview", detail: "Review the products attached to your account in one place." },
      { title: "Billing visibility", detail: "See invoices and account activity without jumping across separate dashboards." },
      { title: "Support entry", detail: "Keep support and account access tied to the same portal path." },
    ],
    trustTitle: "Why businesses use MigraPanel",
    trustNotes: [
      "One portal for services, invoices, and support",
      "Cleaner post-purchase customer experience",
      "Simple account access routes for teams",
    ],
    faqTitle: "Portal questions",
    faqItems: [
      {
        question: "What is MigraPanel used for?",
        answer: "It is the client-facing portal for reviewing services, billing, and support activity after signup.",
      },
      {
        question: "Do I need a separate login?",
        answer: "Use the same account access flow provided through the MigraHosting public site and login routes.",
      },
    ],
  },
};

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const product = products.find((entry) => entry.slug === slug);
  if (!product) {
    return {};
  }

  return buildPageMetadata({
    title: `${product.name} | ${product.tagline}`,
    description: product.shortDescription,
    path: `/products/${product.slug}`,
    imagePath: product.logo,
    imageAlt: `${product.name} official logo`,
  });
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const product = products.find((entry) => entry.slug === slug);
  if (!product) {
    notFound();
  }

  const relatedProducts = product.relatedProducts
    .map((relatedSlug) => products.find((entry) => entry.slug === relatedSlug))
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const productLegalHref = getProductLegalHref(product.slug);
  const productInquiryHref = buildInquiryHref({
    plan: product.name,
    source: `Product — ${product.name}`,
    bodyLines: ["Business name:", "What you need:", "Current setup:", "Timeline:"],
  });
  const config = productConfigs[product.slug] ?? defaultConfig;

  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Products", url: absoluteUrl("/products") },
    { name: product.name, url: absoluteUrl(`/products/${product.slug}`) },
  ]);
  const softwareApp = buildSoftwareApplication(product);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(softwareApp) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden px-5 pb-14 pt-10 sm:px-6 sm:pb-16">
        <div className="gradient-orb gradient-orb-violet left-[-3rem] top-16 h-40 w-40 sm:h-52 sm:w-52" />
        <div className="gradient-orb gradient-orb-peach right-[-2rem] top-4 h-36 w-36 sm:h-44 sm:w-44" />
        <div className={cn(ui.maxW, "relative")}>
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <span className={ui.pill}>{product.category.replace(/-/g, " ")}</span>
                <span className={ui.statusBadge}>{product.status}</span>
              </div>
              <div className="mt-5 flex items-center gap-4">
                <div className={ui.logoBadgeLg}>
                  <Image src={product.logo} alt={product.name} fill sizes="56px" className="object-contain" />
                </div>
                <div>
                  <p className={ui.eyebrowBrand}>{product.tagline}</p>
                  <h1 className="mt-1 font-[var(--font-display)] text-4xl font-semibold tracking-[-0.05em] text-[var(--brand-ink)] sm:text-5xl lg:text-6xl">
                    {product.name}
                  </h1>
                </div>
              </div>
              <p className={cn(ui.body, "mt-6 max-w-2xl")}>{product.shortDescription}</p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href={config.primaryCta.href} className={ui.btnPrimary}>
                  {config.primaryCta.label}
                </Link>
                <Link href={config.secondaryCta.href} className={ui.btnSecondary}>
                  {config.secondaryCta.label}
                </Link>
              </div>
            </div>

            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>{config.offerTitle}</p>
              <div className="mt-5 space-y-4">
                {config.offerCards.map((card) => (
                  <div key={card.title} className={cn(ui.cardMuted, "p-4")}>
                    <h2 className="text-lg font-semibold text-[var(--brand-ink)]">{card.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{card.detail}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {productLegalHref ? (
        <section className="pb-4 pt-2">
          <div className={ui.maxW}>
            <div className={cn(ui.card, "p-5 sm:p-6")}>
              <p className={ui.eyebrowBrand}>Trust note</p>
              <p className="mt-3 text-sm leading-7 text-[var(--brand-muted)]">
                This service is covered by the{" "}
                <Link href="/legal/terms" className="font-semibold text-[var(--brand-violet)]">
                  Terms of Service
                </Link>
                ,{" "}
                <Link href="/legal/payment" className="font-semibold text-[var(--brand-violet)]">
                  Payment Policy
                </Link>
                ,{" "}
                <Link href="/legal/privacy" className="font-semibold text-[var(--brand-violet)]">
                  Privacy Policy
                </Link>
                , and the{" "}
                <Link href={productLegalHref} className="font-semibold text-[var(--brand-violet)]">
                  {product.name} service terms
                </Link>
                .
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className={ui.sectionPySmall}>
        <div className={ui.maxWNarrow}>
          <p className={ui.eyebrowBrand}>Main offer</p>
          <h2 className={cn(ui.h2, "mt-3")}>What {product.name} helps you do</h2>
          <p className={cn(ui.body, "mt-4")}>{product.longDescription}</p>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="grid gap-8 lg:grid-cols-[1fr_0.95fr]">
            <div>
              <p className={ui.eyebrowBrand}>Key features</p>
              <h2 className={cn(ui.h2, "mt-3")}>What you can expect</h2>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {product.capabilities.map((capability) => (
                  <div key={capability} className={cn(ui.card, "flex items-start gap-3 p-4")}>
                    <span className={ui.depthNum}>✓</span>
                    <p className="text-sm leading-6 text-[var(--brand-muted)]">{capability}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>{config.trustTitle}</p>
              <div className="mt-5 space-y-3">
                {config.trustNotes.map((note) => (
                  <div key={note} className={cn(ui.cardMuted, "flex items-start gap-3 p-4")}>
                    <span className={ui.depthNum}>•</span>
                    <p className="text-sm leading-6 text-[var(--brand-muted)]">{note}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>{config.faqTitle}</p>
              <div className="mt-5 space-y-4">
                {config.faqItems.map((item) => (
                  <div key={item.question} className={cn(ui.cardMuted, "p-4")}>
                    <h3 className="text-base font-semibold text-[var(--brand-ink)]">{item.question}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className={ui.eyebrowBrand}>Related products</p>
              <h2 className={cn(ui.h2, "mt-3")}>Add the next piece when you need it.</h2>
              <p className={cn(ui.bodySmall, "mt-4 text-base")}>
                Most customers start with one product, then add related tools once hosting, email, billing, or support needs expand.
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {relatedProducts.map((related) => (
                  <Link key={related.slug} href={`/products/${related.slug}`} className={cn(ui.card, ui.cardHover, "p-5")}>
                    <div className="flex items-center gap-3">
                      <div className={ui.logoBadge}>
                        <Image src={related.logo} alt={related.name} fill sizes="44px" className="object-contain" />
                      </div>
                      <p className="font-semibold text-[var(--brand-ink)]">{related.name}</p>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-[var(--brand-muted)]">{related.shortDescription}</p>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-10")}>
        <div className={ui.maxW}>
          <div className="page-glow overflow-hidden rounded-[36px] border border-white/80 bg-[linear-gradient(135deg,rgba(247,239,255,0.92),rgba(255,255,255,0.96)_52%,rgba(255,244,236,0.96))] px-6 py-10 text-center shadow-[var(--shadow-lg)] sm:px-10 sm:py-12">
            <p className={ui.eyebrowBrand}>Next step</p>
            <h2 className={cn(ui.h2, "mt-3")}>Ready to move forward with {product.name}?</h2>
            <p className="mx-auto mt-4 max-w-2xl text-base leading-8 text-[var(--brand-muted)]">
              Use the direct action above if you are ready, or send a quick inquiry if you want help choosing the right starting point.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href={config.primaryCta.href} className={ui.btnPrimary}>
                {config.primaryCta.label}
              </Link>
              <a href={productInquiryHref} className={ui.btnSecondary}>
                Send inquiry
              </a>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
