"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import type { AccountLinks } from "@/lib/account-links";

const INTERNAL_PREFIXES = ["/dashboard", "/platform", "/builder", "/hosting", "/intake", "/app"];

function isInternalPath(pathname: string | null) {
  if (!pathname) {
    return false;
  }

  return INTERNAL_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
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

  return (
    <>
      {internalPath ? null : <SiteHeader accountLinks={accountLinks} />}
      {children}
      {internalPath ? null : <SiteFooter accountLinks={accountLinks} />}
    </>
  );
}