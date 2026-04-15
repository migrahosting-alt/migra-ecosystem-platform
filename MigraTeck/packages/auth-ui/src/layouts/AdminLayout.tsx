import type { ReactNode } from "react";
import type { AuthBrandTheme } from "../lib/theme";
import { SidebarNav } from "../components/SidebarNav";
import { Card } from "../components/Card";

export function AdminLayout({
  theme,
  navItems,
  rightRail,
  children,
}: {
  theme: AuthBrandTheme;
  navItems: Array<{ href: string; label: string; badge?: string }>;
  rightRail?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[linear-gradient(180deg,#090b12_0%,#111827_50%,#090b12_100%)] px-4 py-6 text-white lg:px-6">
      <div className="mx-auto grid max-w-[96rem] gap-6 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <SidebarNav
            theme={theme}
            items={navItems}
            title="Security control"
            subtitle="Role-aware administration, audit-backed actions, and a calm operational view across MigraAuth."
          />
        </aside>
        <main className="min-w-0">{children}</main>
        <aside className="hidden xl:block xl:sticky xl:top-6 xl:self-start">
          <Card className="p-5">
            {rightRail}
          </Card>
        </aside>
      </div>
    </div>
  );
}
