/**
 * The console navigation registry.
 *
 * THE single source of truth for what appears in the sidebar. `Sidebar.tsx` renders this and
 * remains the rendering authority; this module exists only so the registry and its visibility
 * rules can be unit-tested without rendering React.
 *
 * It deliberately replaces the orphaned `nav-items.ts`, which was a SECOND route registry
 * imported by an orphaned `MobileNav`. Two registries drift: that one had already lost
 * `/console/settings/plan` and never gained the annoupale routes. One registry, or none.
 */

/**
 * Console capabilities used for sidebar visibility.
 *
 * Deliberately narrow and enumerated. There is no wildcard, no `isAdmin`, and no "role implies
 * everything" shortcut — that shape is what later grows an accidental bypass. A capability is
 * granted only by the explicit checks in `Sidebar.tsx`, which delegate to `pale-rbac.ts`.
 *
 * VISIBILITY IS CONVENIENCE, NOT ENFORCEMENT. Every destination re-checks authorization
 * server-side and redirects on failure; hiding a link only avoids offering a door that would
 * be shut. `nav-authorization.test.ts` asserts both halves of that.
 */
export type NavCapability = "pale.accounts.read" | "pale.reports.read";

export type NavItem = {
  label: string;
  href: string;
  icon?: string;
  logoSrc?: string;
  /** Absent = visible to any authenticated console user (the canonical default). */
  capability?: NavCapability;
  /** Rendered as an indented group beneath the parent. */
  children?: ReadonlyArray<NavItem>;
};

/**
 * `icon` is a lucide export NAME rather than a component, so this module stays free of React
 * and JSX imports and can be loaded by `node --test`. `Sidebar.tsx` maps names to components.
 */
export const NAV: ReadonlyArray<NavItem> = [
  { label: "Overview", href: "/console", icon: "LayoutDashboard" },
  { label: "Ecosystem", href: "/console/ecosystem", icon: "Boxes" },
  { label: "Hosting", href: "/console/hosting", icon: "Server" },
  { label: "Domains", href: "/console/domains", icon: "Globe" },
  { label: "Email", href: "/console/email", icon: "Mail" },
  { label: "Voice", href: "/console/voice", icon: "Phone" },
  { label: "Intake", href: "/console/intake", icon: "FileText" },
  { label: "Marketing", href: "/console/marketing", icon: "Megaphone" },
  { label: "Automation", href: "/console/automation", icon: "Workflow" },
  { label: "Billing", href: "/console/billing", icon: "Receipt" },
  { label: "Clients", href: "/console/clients", icon: "Users" },
  { label: "Support", href: "/console/support", icon: "LifeBuoy" },
  { label: "Activity", href: "/console/activity", icon: "Activity" },
  { label: "Analytics", href: "/console/analytics", icon: "BarChart3" },
  { label: "Security", href: "/console/security", icon: "Shield" },
  { label: "Team", href: "/console/team", icon: "UsersRound" },
  {
    // The INTERNAL Trust & Operations console for AnnouPale. This is not annoupale.com:
    // the outbound public/service links live on the Ecosystem tile, which is where the
    // "external product" framing belongs. Keeping them apart is why this group carries only
    // /console/* destinations and no outbound href.
    label: "AnnouPale",
    href: "/console/annoupale",
    logoSrc: "/brands/products/annoupale.png",
    children: [
      { label: "Compliance Cases", href: "/console/annoupale/compliance", icon: "ClipboardCheck" },
      { label: "Appeals", href: "/console/annoupale/appeals", icon: "Scale" },
      { label: "Moderation", href: "/console/annoupale/moderation", icon: "Flag" },
      { label: "Audit Log", href: "/console/annoupale/audit", icon: "ScrollText" },
      { label: "Analytics & Timeline", href: "/console/annoupale/analytics", icon: "LineChart" },
      { label: "Staff & Access", href: "/console/annoupale/staff", icon: "UsersRound" },
      { label: "Settings", href: "/console/annoupale/settings", icon: "Settings" },
    ],
  },
  {
    label: "Pale",
    href: "/console/pale",
    logoSrc: "/brands/products/pale.png",
    children: [
      { label: "Accounts", href: "/console/pale/users", icon: "UsersRound", capability: "pale.accounts.read" },
      { label: "Reports", href: "/console/pale/reports", icon: "Flag", capability: "pale.reports.read" },
    ],
  },
  { label: "Settings", href: "/console/settings", icon: "Settings" },
];

/**
 * Filter the registry to what a viewer may see.
 *
 * A parent with no capability of its own stays visible even when every child is filtered out —
 * the parent is its own destination, not merely a container. A hidden child never leaks its
 * label or href into the rendered tree.
 */
export const visibleNav = (granted: ReadonlySet<NavCapability>): NavItem[] =>
  NAV.filter((item) => !item.capability || granted.has(item.capability)).map((item) =>
    item.children
      ? { ...item, children: item.children.filter((c) => !c.capability || granted.has(c.capability)) }
      : item,
  );

/** Every href in the registry, parents and children, for inventory and dead-link checks. */
export const allNavHrefs = (): string[] =>
  NAV.flatMap((i) => [i.href, ...(i.children ?? []).map((c) => c.href)]);
