import {
  LayoutDashboard,
  Boxes,
  Server,
  Globe,
  Mail,
  Inbox,
  Phone,
  FileText,
  Megaphone,
  Workflow,
  Receipt,
  Users,
  LifeBuoy,
  BarChart3,
  Shield,
  UsersRound,
  Settings,
  Activity,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  logoSrc?: string;
};

/** Shared console navigation — consumed by the desktop Sidebar and the mobile drawer. */
export const NAV: ReadonlyArray<NavItem> = [
  { label: "Overview", href: "/console", icon: LayoutDashboard },
  { label: "Ecosystem", href: "/console/ecosystem", icon: Boxes },
  { label: "Hosting", href: "/console/hosting", icon: Server },
  { label: "Domains", href: "/console/domains", icon: Globe },
  { label: "Email", href: "/console/email", icon: Mail },
  { label: "Mail", href: "/console/mail", icon: Inbox },
  { label: "Voice", href: "/console/voice", icon: Phone },
  { label: "Intake", href: "/console/intake", icon: FileText },
  { label: "Marketing", href: "/console/marketing", icon: Megaphone },
  { label: "Automation", href: "/console/automation", icon: Workflow },
  { label: "Billing", href: "/console/billing", icon: Receipt },
  { label: "Clients", href: "/console/clients", icon: Users },
  { label: "Support", href: "/console/support", icon: LifeBuoy },
  { label: "Activity", href: "/console/activity", icon: Activity },
  { label: "Analytics", href: "/console/analytics", icon: BarChart3 },
  { label: "Security", href: "/console/security", icon: Shield },
  { label: "Team", href: "/console/team", icon: UsersRound },
  { label: "Pale", href: "/console/pale", logoSrc: "/brands/products/pale.png" },
  { label: "Settings", href: "/console/settings", icon: Settings },
];

/** Whether a nav item is the active route for the given path. */
export const isNavActive = (href: string, activePath: string): boolean =>
  activePath === href || (href !== "/console" && activePath.startsWith(href));
