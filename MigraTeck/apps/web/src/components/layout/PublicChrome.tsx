"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import type { AccountLinks } from "@/lib/account-links";

const INTERNAL_PREFIXES = ["/dashboard", "/builder", "/hosting", "/intake", "/app", "/console"];
const INTERNAL_NESTED_PREFIXES = ["/platform"] as const;

const NO_HEADER_PATHS: string[] = [];

function isInternalPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  if (INTERNAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }

  return INTERNAL_NESTED_PREFIXES.some((prefix) => pathname.startsWith(`${prefix}/`));
}

function isNoHeaderPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  return NO_HEADER_PATHS.includes(pathname);
}

export function PublicChrome({
  accountLinks,
  children,
}: {
  accountLinks: AccountLinks;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const internalPath = isInternalPath(pathname);
  const hideHeader = internalPath || isNoHeaderPath(pathname);

  return (
    <div className="public-shell">
      {hideHeader ? null : <SiteHeader accountLinks={accountLinks} />}
      <div className="relative">{children}</div>
      {internalPath ? null : <SiteFooter accountLinks={accountLinks} />}
    </div>
  );
}
