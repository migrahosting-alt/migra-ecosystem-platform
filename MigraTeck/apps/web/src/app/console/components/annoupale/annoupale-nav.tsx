import {
  LayoutDashboard,
  ClipboardCheck,
  Scale,
  Flag,
  ScrollText,
  LineChart,
  UsersRound,
  Settings,
} from "lucide-react";

/**
 * Single source of truth for AnnouPale Trust & Operations navigation, shared by
 * the desktop sidebar and the mobile/tablet nav so they never drift.
 */

export type AnnoupaleNavItem = {
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

export type AnnoupaleNavGroup = { heading: string; items: ReadonlyArray<AnnoupaleNavItem> };

export const ANNOUPALE_NAV_GROUPS: ReadonlyArray<AnnoupaleNavGroup> = [
  {
    heading: "Operations",
    items: [
      { label: "Overview", href: "/console/annoupale", icon: LayoutDashboard },
      { label: "Compliance Cases", href: "/console/annoupale/compliance", icon: ClipboardCheck },
      { label: "Appeals", href: "/console/annoupale/appeals", icon: Scale },
      { label: "Moderation", href: "/console/annoupale/moderation", icon: Flag },
      { label: "Audit Log", href: "/console/annoupale/audit", icon: ScrollText },
      { label: "Analytics & Timeline", href: "/console/annoupale/analytics", icon: LineChart },
    ],
  },
  {
    heading: "Administration",
    items: [
      { label: "Staff & Access", href: "/console/annoupale/staff", icon: UsersRound },
      { label: "Settings", href: "/console/annoupale/settings", icon: Settings },
    ],
  },
];

/** Flat list (used by the mobile nav). */
export const ANNOUPALE_NAV_ITEMS: ReadonlyArray<AnnoupaleNavItem> =
  ANNOUPALE_NAV_GROUPS.flatMap((g) => g.items);

export function isActiveNav(pathname: string, href: string): boolean {
  if (href === "/console/annoupale") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
