"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import type { AccountLinks } from "@/lib/account-links";

const INTERNAL_PREFIXES = ["/dashboard", "/platform", "/builder", "/hosting", "/intake", "/app"];

const NO_HEADER_PATHS = ["/"];

function isInternalPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  return INTERNAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
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
    <>
      {hideHeader ? null : <SiteHeader accountLinks={accountLinks} />}
      {children}
      {internalPath ? null : <SiteFooter accountLinks={accountLinks} />}
    </>
  );
}