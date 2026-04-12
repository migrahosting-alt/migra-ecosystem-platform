import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { AnimatedSection } from "@/components/marketing/animated-section";
import { LinkButton } from "@/components/ui/button";

const portfolioTitle = "MigraHosting Corporate Portfolio";
const portfolioDescription =
  "Public corporate portfolio for MigraHosting and the broader MigraTeck ecosystem, including the live deck and downloadable PDF.";
const portfolioDeckPath = "/portfolio/migrahosting-corporate-portfolio/index.html";
const portfolioPdfPath = "/portfolio/migrahosting-corporate-portfolio/MigraHosting-Corporate-Portfolio.pdf";
const portfolioImagePath = "/portfolio/migrahosting-corporate-portfolio/assets/migrahosting-og-image.png";

const portfolioStructuredData = {
  "@context": "https://schema.org",
  "@type": "CreativeWork",
  name: portfolioTitle,
  description: portfolioDescription,
  url: "https://migrateck.com/portfolio",
  image: `https://migrateck.com${portfolioImagePath}`,
  encodingFormat: "text/html",
  isAccessibleForFree: true,
  about: ["MigraHosting", "MigraTeck", "MigaPanel", "MigraPanel"],
  hasPart: [
    {
      "@type": "MediaObject",
      name: "MigraHosting Corporate Portfolio PDF",
      contentUrl: `https://migrateck.com${portfolioPdfPath}`,
      encodingFormat: "application/pdf",
    },
  ],
  publisher: {
    "@type": "Organization",
    name: "MigraTeck LLC",
    url: "https://migrateck.com",
  },
};

export const metadata: Metadata = {
  title: "Corporate Portfolio",
  description: portfolioDescription,
  alternates: {
    canonical: "/portfolio",
  },
  openGraph: {
    title: portfolioTitle,
    description: portfolioDescription,
    url: "https://migrateck.com/portfolio",
    siteName: "MigraTeck",
    type: "website",
    images: [
      {
        url: portfolioImagePath,
        width: 1200,
        height: 630,
        alt: "MigraHosting portfolio hero visual",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: portfolioTitle,
    description: portfolioDescription,
    images: [portfolioImagePath],
  },
};

const ecosystemSurfaces = [
  "MigraHosting commercial hosting and migration services",
  "MigaPanel internal control-plane operations",
  "MigraPanel public SaaS and client portal surfaces",
  "MigraMail, MigraVoice, MigraDrive, and shared ecosystem services",
  "AI Website Builder and AI Content Generator managed service systems",
];

const portfolioStats = [
  { value: "16", label: "deck pages" },
  { value: "HTML + PDF", label: "public formats" },
  { value: "2026", label: "current edition" },
];

const portfolioHighlights = [
  {
    title: "Commercial narrative",
    description: "Explains MigraHosting as the commercial face of the wider MigraTeck delivery stack.",
  },
  {
    title: "Operational proof",
    description: "Covers Cloud Pods, control-plane workflows, migration model, and security posture.",
  },
  {
    title: "Buyer-facing packaging",
    description: "Frames the ecosystem, including the new AI service systems, in terms customers and enterprise reviewers can assess quickly.",
  },
];

const portfolioSections = [
  "Company overview and executive summary",
  "Ecosystem map across commercial, control-plane, and infrastructure layers",
  "Cloud Pods, MigaPanel, MigraPanel, MigraMail, MigraVoice, and expansion service coverage",
  "Security, reliability, migration playbook, and competitive story",
  "Delivery model, adoption proof, and closing contact panel",
];

const portfolioUseCases = [
  "Sales conversations that need one authoritative deck",
  "Partnership and reseller introductions",
  "Enterprise buyer diligence and procurement review",
  "Internal alignment across MigraTeck product and infrastructure teams",
];

export default function PortfolioPage() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(portfolioStructuredData),
        }}
      />
      <section className="px-6 py-16">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
          <AnimatedSection>
            <div className="rounded-3xl border border-[var(--line)] bg-white p-8 shadow-sm">
              <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--ink-muted)]">
                    Public Portfolio Surface
                  </p>
                  <h1 className="mt-3 text-4xl font-black tracking-tight text-[var(--ink)]">{portfolioTitle}</h1>
                  <p className="mt-4 max-w-3xl text-lg leading-relaxed text-[var(--ink-muted)]">
                    Published on migrateck.com as the canonical public entry point for the MigraHosting corporate deck.
                    This surface now works as a proper portfolio hub, with direct access to the live deck, downloadable
                    PDF, and a quick summary of what enterprise reviewers will find inside.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <LinkButton href={portfolioDeckPath}>Open Web Deck</LinkButton>
                    <LinkButton href={portfolioPdfPath} variant="secondary">
                      Download PDF
                    </LinkButton>
                    <LinkButton href="/company" variant="ghost">
                      View Company Profile
                    </LinkButton>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                  {portfolioStats.map((stat) => (
                    <div key={stat.label} className="rounded-2xl bg-[var(--surface-2)] px-4 py-4">
                      <div className="text-2xl font-black tracking-tight text-[var(--ink)]">{stat.value}</div>
                      <div className="mt-1 text-sm text-[var(--ink-muted)]">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </AnimatedSection>

          <div className="grid gap-6 md:grid-cols-3">
            {portfolioHighlights.map((highlight, index) => (
              <AnimatedSection key={highlight.title} delay={0.04 * (index + 1)}>
                <div className="h-full rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-bold text-[var(--ink)]">{highlight.title}</h2>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--ink-muted)]">{highlight.description}</p>
                </div>
              </AnimatedSection>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <AnimatedSection delay={0.06}>
              <div className="overflow-hidden rounded-3xl border border-[var(--line)] bg-white shadow-sm">
                <div className="border-b border-[var(--line)] px-5 py-4">
                  <h2 className="text-xl font-bold text-[var(--ink)]">Deck Preview</h2>
                  <p className="mt-1 text-sm text-[var(--ink-muted)]">
                    Preview image for the published deck bundle, with direct links to the full HTML deck and PDF.
                  </p>
                </div>
                <div className="relative h-[720px] w-full">
                  <Image
                    src={portfolioImagePath}
                    alt="MigraHosting corporate portfolio preview"
                    fill
                    sizes="(max-width: 1024px) 100vw, 60vw"
                    className="object-cover object-top"
                    priority
                  />
                </div>
                <div className="border-t border-[var(--line)] px-5 py-4 text-sm text-[var(--ink-muted)]">
                  The full deck remains available at
                  {" "}
                  <Link href={portfolioDeckPath} className="font-semibold text-[var(--ink)] hover:underline">
                    the published web portfolio
                  </Link>
                  {" "}
                  and as a
                  {" "}
                  <Link href={portfolioPdfPath} className="font-semibold text-[var(--ink)] hover:underline">
                    downloadable PDF
                  </Link>
                  .
                </div>
              </div>
            </AnimatedSection>

            <div className="space-y-6">
              <AnimatedSection delay={0.12}>
                <div className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-bold text-[var(--ink)]">Canonical Surfaces</h2>
                  <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[var(--ink-muted)]">
                    {ecosystemSurfaces.map((surface) => (
                      <li key={surface} className="rounded-2xl bg-[var(--surface-2)] px-4 py-3">
                        {surface}
                      </li>
                    ))}
                  </ul>
                </div>
              </AnimatedSection>

              <AnimatedSection delay={0.18}>
                <div className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-bold text-[var(--ink)]">Stable Public URLs</h2>
                  <div className="mt-4 space-y-3 text-sm text-[var(--ink-muted)]">
                    <div>
                      <p className="font-semibold text-[var(--ink)]">Landing page</p>
                      <Link href="/portfolio" className="hover:text-[var(--ink)] hover:underline">
                        https://migrateck.com/portfolio
                      </Link>
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--ink)]">Web deck</p>
                      <Link href={portfolioDeckPath} className="hover:text-[var(--ink)] hover:underline">
                        {`https://migrateck.com${portfolioDeckPath}`}
                      </Link>
                    </div>
                    <div>
                      <p className="font-semibold text-[var(--ink)]">PDF artifact</p>
                      <Link href={portfolioPdfPath} className="hover:text-[var(--ink)] hover:underline">
                        {`https://migrateck.com${portfolioPdfPath}`}
                      </Link>
                    </div>
                  </div>
                </div>
              </AnimatedSection>

              <AnimatedSection delay={0.24}>
                <div className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
                  <h2 className="text-xl font-bold text-[var(--ink)]">What’s Inside</h2>
                  <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[var(--ink-muted)]">
                    {portfolioSections.map((section) => (
                      <li key={section} className="rounded-2xl bg-[var(--surface-2)] px-4 py-3">
                        {section}
                      </li>
                    ))}
                  </ul>
                </div>
              </AnimatedSection>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
            <AnimatedSection delay={0.28}>
              <div className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-[var(--ink)]">Best Use Cases</h2>
                <ul className="mt-4 space-y-3 text-sm leading-relaxed text-[var(--ink-muted)]">
                  {portfolioUseCases.map((useCase) => (
                    <li key={useCase} className="rounded-2xl bg-[var(--surface-2)] px-4 py-3">
                      {useCase}
                    </li>
                  ))}
                </ul>
              </div>
            </AnimatedSection>

            <AnimatedSection delay={0.32}>
              <div className="rounded-3xl border border-[var(--line)] bg-white p-6 shadow-sm">
                <h2 className="text-xl font-bold text-[var(--ink)]">Distribution Guidance</h2>
                <p className="mt-3 text-sm leading-relaxed text-[var(--ink-muted)]">
                  Use the landing page when you want a stable public URL with canonical metadata. Use the web deck for
                  browser-based review and the PDF artifact when procurement, email outreach, or offline handoff needs a
                  single immutable file.
                </p>
                <div className="mt-5 rounded-2xl bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-muted)]">
                  <p className="font-semibold text-[var(--ink)]">Recommended share order</p>
                  <ol className="mt-2 list-decimal space-y-2 pl-5">
                    <li>Send the landing page for general discovery.</li>
                    <li>Send the web deck when the recipient wants live browser review.</li>
                    <li>Send the PDF when a fixed attachment is required.</li>
                  </ol>
                </div>
              </div>
            </AnimatedSection>
          </div>
        </div>
      </section>
    </>
  );
}
