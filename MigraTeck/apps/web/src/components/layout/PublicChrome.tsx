"use client";

import { usePathname } from "next/navigation";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import type { AccountLinks } from "@/lib/account-links";
import { isInternalPath } from "@/lib/chrome-visibility";

const NO_HEADER_PATHS: string[] = [];

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
