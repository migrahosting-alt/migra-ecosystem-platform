import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Security",
  description:
    "See how MigraHosting approaches account security, billing protection, secure sign-in, and responsible support.",
  path: "/security",
});

const protections = [
  {
    title: "Secure sign-in",
    description: "Login routes, sessions, and account access are built to keep customer entry points protected.",
  },
  {
    title: "Billing protection",
    description: "Billing and account workflows are handled through controlled routes instead of scattered customer tools.",
  },
  {
    title: "Customer data care",
    description: "The goal is to keep the customer-facing data surface narrow and the support path clearer.",
  },
  {
    title: "Support visibility",
    description: "When something needs attention, customers still have a direct portal and support route to work from.",
  },
] as const;

const customerChecks = [
  "Use a unique password for your account",
  "Review your client portal sessions regularly",
  "Keep billing and account messages inside your official support path",
  "Contact support if access or billing behavior looks unusual",
] as const;

const faqItems = [
  {
    question: "Where should I manage account access?",
    answer: "Use the client portal and official login routes rather than relying on old bookmarks or scattered service entry points.",
  },
  {
    question: "How should I report a security concern?",
    answer: "Email the security contact directly so the issue can be reviewed through the correct support path.",
  },
  {
    question: "Does security apply to billing and support too?",
    answer: "Yes. Secure account access matters just as much for invoices, support, and service management as it does for login itself.",
  },
] as const;

export default function SecurityPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Security", url: absoluteUrl("/security") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden px-5 pb-14 pt-10 sm:px-6 sm:pb-16">
        <div className="gradient-orb gradient-orb-violet left-[-3rem] top-16 h-40 w-40 sm:h-52 sm:w-52" />
        <div className="gradient-orb gradient-orb-peach right-[-2rem] top-4 h-36 w-36 sm:h-44 sm:w-44" />
        <div className={cn(ui.maxW, "relative")}>
          <div className="grid gap-8 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
            <div>
              <p className={ui.eyebrowBrand}>Security</p>
              <h1 className={cn(ui.h1, "mt-4 max-w-3xl")}>Security should feel clear and dependable, not complicated.</h1>
              <p className={cn(ui.body, "mt-6 max-w-2xl")}>
                This page exists so customers can understand how account access, billing, and support are treated, without needing to decode internal platform terms.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link href="/login" className={ui.btnPrimary}>
                  Open client portal
                </Link>
                <a href="mailto:security@migrateck.com" className={ui.btnSecondary}>
                  Contact security
                </a>
              </div>
            </div>

            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>What matters most</p>
              <div className="mt-5 space-y-4">
                {protections.slice(0, 2).map((item) => (
                  <div key={item.title} className={cn(ui.cardMuted, "p-4")}>
                    <h2 className="text-lg font-semibold text-[var(--brand-ink)]">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{item.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="mx-auto max-w-3xl text-center">
            <p className={ui.eyebrowBrand}>Security overview</p>
            <h2 className={cn(ui.h2, "mt-3")}>How MigraHosting approaches customer-facing security.</h2>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {protections.map((item, index) => (
              <div key={item.title} className={cn(ui.card, "p-6")}>
                <div className={ui.depthNum}>{index + 1}</div>
                <h3 className="mt-4 text-xl font-semibold text-[var(--brand-ink)]">{item.title}</h3>
                <p className="mt-2 text-sm leading-7 text-[var(--brand-muted)]">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={ui.sectionPySmall}>
        <div className={ui.maxW}>
          <div className="grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>What customers should do</p>
              <h2 className={cn(ui.h2, "mt-3")}>Good habits that help keep the account secure.</h2>
            </div>

            <div className="grid gap-4">
              {customerChecks.map((item) => (
                <div key={item} className={cn(ui.card, "flex items-start gap-3 p-4")}>
                  <span className={ui.depthNum}>✓</span>
                  <p className="text-sm leading-6 text-[var(--brand-muted)]">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-10")}>
        <div className={ui.maxW}>
          <div className="grid gap-5 lg:grid-cols-[1fr_0.95fr]">
            <div className={cn(ui.cardStrong, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>Questions and trust notes</p>
              <div className="mt-5 space-y-4">
                {faqItems.map((item) => (
                  <div key={item.question} className={cn(ui.cardMuted, "p-4")}>
                    <h3 className="text-base font-semibold text-[var(--brand-ink)]">{item.question}</h3>
                    <p className="mt-2 text-sm leading-6 text-[var(--brand-muted)]">{item.answer}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="page-glow overflow-hidden rounded-[36px] border border-white/80 bg-[linear-gradient(135deg,rgba(247,239,255,0.92),rgba(255,255,255,0.96)_52%,rgba(255,244,236,0.96))] px-6 py-10 shadow-[var(--shadow-lg)] sm:px-8 sm:py-12">
              <p className={ui.eyebrowBrand}>Responsible disclosure</p>
              <h2 className={cn(ui.h2, "mt-3")}>Report a security concern directly.</h2>
              <p className="mt-4 text-base leading-8 text-[var(--brand-muted)]">
                If you believe you found a vulnerability or suspicious account behavior, email{" "}
                <a href="mailto:security@migrateck.com" className="font-semibold text-[var(--brand-violet)]">
                  security@migrateck.com
                </a>
                .
              </p>
              <div className="mt-8 flex flex-col gap-3">
                <Link href="/login" className={ui.btnPrimary}>
                  Open client portal
                </Link>
                <Link href="/products" className={ui.btnSecondary}>
                  Back to products
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
