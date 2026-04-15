import { headers } from "next/headers";
import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return (
    <div className="min-h-screen">
      <SiteHeader authBranding={authBranding} />
      <main>{children}</main>
      <SiteFooter authBranding={authBranding} />
    </div>
  );
}
