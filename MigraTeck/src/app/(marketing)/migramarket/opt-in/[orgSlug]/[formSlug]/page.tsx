import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MigraMarketOptInForm } from "@/components/marketing/migramarket-opt-in-form";
import { prisma } from "@/lib/prisma";

interface OptInPageProps {
  params: Promise<{
    orgSlug: string;
    formSlug: string;
  }>;
}

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default async function MigraMarketOptInPage({ params }: OptInPageProps) {
  const { orgSlug, formSlug } = await params;

  const form = await prisma.migraMarketLeadCaptureForm.findFirst({
    where: {
      slug: formSlug,
      active: true,
      smsConsentEnabled: true,
      org: {
        slug: orgSlug,
      },
    },
    include: {
      org: {
        include: {
          migraMarketAccount: true,
        },
      },
    },
  });

  if (!form) {
    notFound();
  }

  const brandName = form.org.migraMarketAccount?.messagingBrandName || form.org.name;
  const supportEmail = form.org.migraMarketAccount?.messagingSupportEmail || null;
  const thankYouMessage = form.thankYouMessage || "Thanks, your SMS consent has been recorded.";
  const consentLabel =
    form.smsConsentLabel ||
    `I agree to receive SMS and MMS marketing messages, updates, and offers from ${brandName}.`;

  return (
    <section className="relative overflow-hidden px-6 py-16">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.14),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.14),transparent_36%),linear-gradient(180deg,#f7f7f2_0%,#eef5f4_100%)]" />
      <div className="relative mx-auto max-w-4xl">
        <MigraMarketOptInForm
          orgSlug={form.org.slug}
          formSlug={form.slug}
          orgName={form.org.name}
          brandName={brandName}
          supportEmail={supportEmail}
          thankYouMessage={thankYouMessage}
          consentLabel={consentLabel}
        />
      </div>
    </section>
  );
}
