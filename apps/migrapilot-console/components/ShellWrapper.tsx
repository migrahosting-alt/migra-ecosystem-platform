"use client";

import { usePathname } from "next/navigation";
import { AppShell } from "./AppShell";
import type { ReactNode } from "react";

export function ShellWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return <>{children}</>;
  return <AppShell>{children}</AppShell>;
}
