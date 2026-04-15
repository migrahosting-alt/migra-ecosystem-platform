import type { ReactNode } from "react";
import type { AuthBrandTheme } from "../lib/theme";
import { SidebarNav } from "../components/SidebarNav";
import { Card } from "../components/Card";

export function AccountLayout({
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
      <div className="mx-auto grid max-w-7xl gap-6 xl:grid-cols-[17rem_minmax(0,1fr)_18rem]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <SidebarNav
            theme={theme}
            items={navItems}
            title="Account center"
            subtitle="Review sessions, posture, and the identity controls protecting your MigraTeck account."
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
