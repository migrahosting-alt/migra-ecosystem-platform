import Link from "next/link";
import { headers } from "next/headers";
import { resolveAuthPortalBranding } from "@/lib/migradrive-auth-branding";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host");
  const authBranding = resolveAuthPortalBranding(host);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(15,122,216,0.08),transparent_34%),radial-gradient(circle_at_bottom_right,rgba(147,51,234,0.06),transparent_30%),var(--surface)]">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-6 py-6">
        <Link href={authBranding.siteUrl} className="flex flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--ink-muted)]">
            {authBranding.headerLabel}
          </span>
          <span className="mt-1 text-lg font-black tracking-tight text-[var(--ink)]">{authBranding.shortName}</span>
        </Link>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Link href="/login" className="rounded-full border border-[var(--line)] bg-white px-4 py-2 font-semibold text-[var(--ink-muted)] transition hover:text-[var(--ink)]">
            Log in
          </Link>
          <Link href="/signup" className="rounded-full bg-[linear-gradient(180deg,#0f7ad8,#0a4f99)] px-4 py-2 font-semibold text-white shadow-[0_12px_30px_rgba(15,122,216,0.24)] transition hover:-translate-y-0.5">
            Create account
          </Link>
        </div>
      </div>
      <main>{children}</main>
    </div>
  );
}
