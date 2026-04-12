import Link from "next/link";
import { buildPageMetadata } from "@/lib/metadata";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Security",
  description:
    "Security model, protections, and responsible disclosure for the MigraTeck platform.",
  path: "/security",
});

const principles = [
  { title: "Least privilege by default", desc: "Every access grant starts from zero and is scoped to the minimum required for a given role, action, or integration." },
  { title: "Defence in depth", desc: "No single layer is trusted alone. Authentication, session controls, transport encryption, and runtime isolation all reinforce each other." },
  { title: "Fail closed", desc: "Ambiguous state defaults to denial. If a token, session, or permission check cannot be resolved, access is withheld." },
  { title: "Minimal data surface", desc: "Data collection stays as narrow as possible. Platform APIs expose only the fields needed for the operation at hand." },
] as const;

const protections = [
  "TLS 1.2+ on all public endpoints",
  "Bcrypt password hashing with per-user salt",
  "Session tokens with server-side revocation",
  "CSRF protection on all state-changing routes",
  "Rate limiting on authentication and API endpoints",
  "Strict Content-Security-Policy headers",
  "Role-scoped API keys with optional IP binding",
  "Automated dependency auditing in CI",
] as const;

const accountSecurity = [
  "Unique password per account enforced",
  "Session listing and forced sign-out",
  "Audit log of administrative actions",
  "Failed login attempt limits",
  "API key rotation without downtime",
  "IP allowlist support for sensitive routes",
] as const;

export default function SecurityPage() {
  return (
    <>
      {/* hero */}
      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-0 bottom-0 h-[350px] w-[350px] rounded-full bg-green-500/10 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-24 pt-32 sm:pb-32 sm:pt-40")}>
          <div className="max-w-3xl">
            <p className="animate-fade-up text-sm font-semibold uppercase tracking-[0.2em] text-sky-400/90">
              Security
            </p>
            <h1 className="animate-fade-up-d1 mt-6 font-[var(--font-display)] text-5xl font-bold tracking-[-0.03em] text-white sm:text-6xl lg:text-7xl">
              Security is{" "}
              <span className="gradient-text-hero">a constraint, not a feature.</span>
            </h1>
            <p className="animate-fade-up-d2 mt-6 max-w-xl text-lg leading-8 text-slate-300/90">
              The platform is designed so that safe behaviour is the default path,
              not an opt-in upgrade.
            </p>
          </div>
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-white to-transparent" />
      </section>

      {/* principles */}
      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Principles</p>
          <h2 className={cn(ui.h2, "mt-3")}>Foundation</h2>
          <p className={cn(ui.body, "mt-4 max-w-xl")}>
            Four ideas underpin every security decision made across the ecosystem.
          </p>
          <div className="mt-10 grid gap-6 sm:grid-cols-2">
            {principles.map((p, i) => (
              <div key={p.title} className={cn(ui.card, "p-6")}>
                <span className={ui.depthNum}>0{i + 1}</span>
                <h3 className={cn(ui.h3, "mt-3")}>{p.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{p.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* protections – dark */}
      <section className="section-dark relative overflow-hidden">
        <div className="pointer-events-none absolute top-0 right-0 h-[300px] w-[300px] rounded-full bg-blue-500/10 blur-[80px]" />
        <div className={cn(ui.maxW, "relative py-20 sm:py-24")}>
          <p className={ui.eyebrowDark}>Implemented</p>
          <h2 className={cn(ui.h2Dark, "mt-3")}>Platform protections</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {protections.map((t) => (
              <div key={t} className={cn(ui.cardDark, "flex items-start gap-3 p-4")}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-500/20 text-green-400">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </span>
                <p className="text-sm leading-6 text-slate-300">{t}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* account security */}
      <section className={cn(ui.sectionPy, "bg-slate-50/50")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Per-account</p>
          <h2 className={cn(ui.h2, "mt-3")}>Account security</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accountSecurity.map((s) => (
              <div key={s} className={cn(ui.card, "flex items-start gap-3 p-4")}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600/10 text-blue-600">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                </span>
                <p className="text-sm leading-6 text-slate-700">{s}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* disclosure */}
      <section className="section-dark-blue relative overflow-hidden">
        <div className={cn(ui.maxW, "relative py-20 text-center sm:py-24")}>
          <h2 className={ui.h2Dark}>Responsible disclosure</h2>
          <p className={cn(ui.bodyDark, "mx-auto mt-4 max-w-lg")}>
            If you believe you have found a vulnerability, report it to{" "}
            <a href="mailto:security@migrateck.com" className="text-sky-400 underline underline-offset-2">
              security@migrateck.com
            </a>
            . We will respond within 48 hours and keep you updated on resolution.
          </p>
          <div className="mt-8 flex justify-center gap-4">
            <Link href="/platform" className={ui.btnPrimaryLight}>Platform overview</Link>
            <Link href="/products" className={ui.btnSecondaryDark}>All products</Link>
          </div>
        </div>
      </section>
    </>
  );
}
