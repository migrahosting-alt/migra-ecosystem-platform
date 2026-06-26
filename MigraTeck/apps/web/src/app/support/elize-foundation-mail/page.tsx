import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";

export const metadata = buildPageMetadata({
  title: "Elize Foundation Mail Setup",
  description:
    "Set up Elize Foundation email in Outlook, Apple Mail, Thunderbird, iPhone, Android, and other mail clients with automatic discovery or manual IMAP and SMTP settings.",
  path: "/support/elize-foundation-mail",
});

const autoSetupClients = [
  "Microsoft Outlook",
  "Mozilla Thunderbird",
  "Apple Mail",
  "iPhone and iPad Mail",
  "Android mail apps",
  "Most modern IMAP clients",
] as const;

const manualSettings = [
  { label: "Incoming server", value: "mail.migrahosting.com" },
  { label: "Incoming protocol", value: "IMAP" },
  { label: "Incoming port", value: "993" },
  { label: "Incoming security", value: "SSL/TLS" },
  { label: "Outgoing server", value: "mail.migrahosting.com" },
  { label: "Outgoing protocol", value: "SMTP" },
  { label: "Outgoing port", value: "587" },
  { label: "Outgoing security", value: "STARTTLS" },
  { label: "Username", value: "Your full email address" },
  { label: "Password", value: "Your mailbox password" },
  { label: "SMTP authentication", value: "Required" },
] as const;

const appGuides = [
  {
    name: "Outlook",
    steps: [
      "Open Outlook and choose Add Account.",
      "Enter your full Elize Foundation email address.",
      "Allow Outlook to discover the mailbox settings automatically.",
      "If Outlook asks for server details, use the manual settings listed below.",
    ],
  },
  {
    name: "Thunderbird",
    steps: [
      "Open Account Settings and choose Add Mail Account.",
      "Enter your name, full email address, and mailbox password.",
      "Select Continue so Thunderbird can detect the configuration automatically.",
      "If needed, switch to Manual Config and use the IMAP and SMTP settings below.",
    ],
  },
  {
    name: "Apple Mail",
    steps: [
      "Open Mail and choose Add Account.",
      "Select Other Mail Account and enter your full email address and password.",
      "If Apple Mail does not complete setup automatically, enter the manual IMAP and SMTP settings.",
    ],
  },
  {
    name: "iPhone and iPad",
    steps: [
      "Open Settings, then Mail, then Accounts, then Add Account.",
      "Choose Other, then Add Mail Account.",
      "Enter your mailbox details and continue.",
      "If auto-setup does not finish, choose IMAP and enter the manual settings below.",
    ],
  },
  {
    name: "Android",
    steps: [
      "Open your mail app and choose Add Account.",
      "Enter your full email address and password.",
      "Select IMAP if the app asks which account type to use.",
      "If discovery fails, enter the manual IMAP and SMTP settings below.",
    ],
  },
] as const;

const troubleshooting = [
  "Always use your full email address as the username.",
  "If setup fails, confirm the password by signing in through webmail first.",
  "Use IMAP on port 993 with SSL/TLS for incoming mail.",
  "Use SMTP on port 587 with STARTTLS for outgoing mail.",
  "Make sure SMTP authentication is enabled and uses the same full email address and password.",
] as const;

export default function ElizeFoundationMailPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "Support", url: absoluteUrl("/support/elize-foundation-mail") },
    { name: "Elize Foundation Mail Setup", url: absoluteUrl("/support/elize-foundation-mail") },
  ]);

  const faqStructuredData = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What username should I use for Elize Foundation email?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Use your full email address as the username in every mail application.",
        },
      },
      {
        "@type": "Question",
        name: "What are the manual mail server settings?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Incoming mail uses IMAP on mail.migrahosting.com port 993 with SSL/TLS. Outgoing mail uses SMTP on mail.migrahosting.com port 587 with STARTTLS and authentication.",
        },
      },
      {
        "@type": "Question",
        name: "Does Outlook or Thunderbird support automatic setup?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Yes. Outlook can use autodiscover and Thunderbird can use autoconfig. Most modern mail apps should detect the mailbox settings automatically.",
        },
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqStructuredData) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-5rem] top-24 h-72 w-72 rounded-full bg-violet-300/25 blur-[90px]" />
        <div className="pointer-events-none absolute right-[-5rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/35 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-3xl">
            <p className={ui.eyebrowBrand}>Elize Foundation Mail</p>
            <h1 className={cn(ui.h1, "mt-5 max-w-2xl")}>
              Set up your mailbox in the apps people already use every day.
            </h1>
            <p className={cn(ui.body, "mt-6 max-w-2xl")}>
              Elize Foundation email supports automatic setup in modern mail clients, with
              manual IMAP and SMTP settings available when a device needs them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="https://mail.migrahosting.com" className={ui.btnPrimary}>
                Open webmail
              </a>
              <Link href="/security" className={ui.btnSecondary}>
                View security
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Automatic setup</p>
          <h2 className={cn(ui.h2, "mt-3")}>Most clients should detect the mailbox settings automatically.</h2>
          <p className={cn(ui.body, "mt-4 max-w-2xl")}>
            Start with your full Elize Foundation email address and mailbox password before
            entering manual server values.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {autoSetupClients.map((client) => (
              <div key={client} className={cn(ui.card, "flex items-start gap-3 p-5")}>
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
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
                <p className="text-sm leading-6 text-slate-700">{client}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>Manual settings</p>
          <h2 className={cn(ui.h2, "mt-3")}>Use these exact values if your mail app asks for server details.</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {manualSettings.map((item) => (
              <div key={item.label} className={cn(ui.cardStrong, "p-5")}>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {item.label}
                </p>
                <p className="mt-3 text-base font-semibold text-[var(--brand-ink)]">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <p className={ui.eyebrowBrand}>App guides</p>
          <h2 className={cn(ui.h2, "mt-3")}>Quick setup by device or mail app.</h2>
          <div className="mt-10 grid gap-6 lg:grid-cols-2">
            {appGuides.map((guide) => (
              <div key={guide.name} className={cn(ui.card, "p-6")}>
                <h3 className={cn(ui.h3, "text-[1.4rem]")}>{guide.name}</h3>
                <ol className="mt-4 space-y-3 text-sm leading-6 text-slate-700">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="flex gap-3">
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#7c3aed,#fb7185)] text-xs font-semibold text-slate-50">
                        {index + 1}
                      </span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={cn(ui.sectionPy, "pt-0")}>
        <div className={ui.maxW}>
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className={cn(ui.cardStrong, "p-6 sm:p-8")}>
              <p className={ui.eyebrowBrand}>Troubleshooting</p>
              <h2 className={cn(ui.h2, "mt-3 max-w-xl")}>If setup does not finish cleanly.</h2>
              <div className="mt-8 space-y-4">
                {troubleshooting.map((item) => (
                  <div key={item} className={cn(ui.cardMuted, "flex items-start gap-3 p-4")}>
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                      <svg
                        className="h-3 w-3"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={3}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </span>
                    <p className="text-sm leading-6 text-slate-700">{item}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className={cn(ui.card, "p-6 sm:p-7")}>
              <p className={ui.eyebrowBrand}>Need a fallback?</p>
              <h3 className={cn(ui.h3, "mt-4 text-[1.55rem]")}>Webmail is always available.</h3>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                If a local mail app is still not behaving, sign in through webmail first to
                confirm the mailbox and password are working.
              </p>
              <div className="mt-6 space-y-3">
                <a href="https://mail.migrahosting.com" className={ui.btnPrimary}>
                  Go to webmail
                </a>
                <p className="text-sm text-slate-600">
                  Incoming: <span className="font-semibold text-slate-700">mail.migrahosting.com:993</span>
                  <br />
                  Outgoing: <span className="font-semibold text-slate-700">mail.migrahosting.com:587</span>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
