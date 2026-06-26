import Link from "next/link";
import { buildPageMetadata, absoluteUrl } from "@/lib/metadata";
import { buildBreadcrumbList, SITE_ROOT } from "@/lib/structured-data";
import { cn } from "@/lib/cn";
import ui from "@/lib/ui";
import { SmsOptInForm } from "@/components/sms/SmsOptInForm";

export const metadata = buildPageMetadata({
  title: "SMS Opt-In — MigraTeck",
  description:
    "Consent to receive account verification, security, and service notification text messages from MigraTeck LLC for the Pale / AnnouPale platform.",
  path: "/sms",
});

const messageTypes = [
  {
    title: "Account verification",
    desc: "One-time codes and verification prompts used to confirm it's really you.",
  },
  {
    title: "Security alerts",
    desc: "Notifications about sign-ins, security events, and changes to your account.",
  },
  {
    title: "Service notifications",
    desc: "Updates about your Pale / AnnouPale account and the services you use.",
  },
] as const;

export default function SmsOptInPage() {
  const breadcrumb = buildBreadcrumbList([
    SITE_ROOT,
    { name: "SMS Opt-In", url: absoluteUrl("/sms") },
  ]);

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumb) }}
      />

      <section className="hero-gradient hero-mesh relative overflow-hidden">
        <div className="pointer-events-none absolute left-[-4rem] top-20 h-72 w-72 rounded-full bg-violet-300/25 blur-[90px]" />
        <div className="pointer-events-none absolute right-[-5rem] bottom-0 h-80 w-80 rounded-full bg-orange-200/35 blur-[100px]" />
        <div className={cn(ui.maxW, "relative pb-20 pt-28 sm:pb-24 sm:pt-36")}>
          <div className="max-w-3xl">
            <p className={ui.eyebrowBrand}>Pale / AnnouPale</p>
            <h1 className={cn(ui.h1, "mt-5 max-w-2xl")}>Text message opt-in</h1>
            <p className={cn(ui.body, "mt-6 max-w-2xl")}>
              MigraTeck LLC (Pale / AnnouPale) can send recurring text messages for account
              verification, security alerts, and service notifications related to your
              Pale / AnnouPale account. Consent is optional and can be withdrawn at any time.
            </p>
          </div>
        </div>
      </section>

      <section className={ui.sectionPy}>
        <div className={cn(ui.maxW, "grid gap-10 lg:grid-cols-[minmax(0,1fr)_28rem]")}>
          <div>
            <p className={ui.eyebrowBrand}>What you will receive</p>
            <h2 className={cn(ui.h2, "mt-3")}>Messages from MigraTeck LLC</h2>
            <p className={cn(ui.body, "mt-4 max-w-xl")}>
              This program is operated by MigraTeck LLC (DBA Pale) for the Pale / AnnouPale
              platform. Consent is not a condition of purchase, and you can opt out at any time.
            </p>

            <div className="mt-8 grid gap-4">
              {messageTypes.map((message) => (
                <div key={message.title} className={cn(ui.card, "flex items-start gap-3 p-5")}>
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fuchsia-100 text-fuchsia-600">
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
                  <div>
                    <p className="text-sm font-semibold text-[var(--brand-ink)]">{message.title}</p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">{message.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap gap-4 text-sm">
              <Link
                href="/legal/sms-terms"
                className="font-semibold text-fuchsia-700 underline underline-offset-2 hover:text-fuchsia-800"
              >
                SMS / Messaging Terms →
              </Link>
              <Link
                href="/legal/privacy"
                className="font-semibold text-fuchsia-700 underline underline-offset-2 hover:text-fuchsia-800"
              >
                Privacy Policy →
              </Link>
            </div>

            <div className={cn(ui.cardMuted, "mt-8 p-5")}>
              <p className="text-sm leading-6 text-slate-600">
                Reply STOP to any message to unsubscribe, or HELP for assistance. You can also
                contact us at{" "}
                <a
                  href="mailto:support@migrateck.com"
                  className="font-semibold text-fuchsia-700 underline underline-offset-2 hover:text-fuchsia-800"
                >
                  support@migrateck.com
                </a>
                . Message and data rates may apply.
              </p>
            </div>
          </div>

          <div className="lg:sticky lg:top-24 lg:self-start">
            <SmsOptInForm />
          </div>
        </div>
      </section>
    </>
  );
}
