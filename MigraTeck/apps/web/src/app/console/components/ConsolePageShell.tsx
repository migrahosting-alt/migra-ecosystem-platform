import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { panelQuery, isPanelDbConfigured } from "../lib/db";

export type ShellSession = {
  email: string;
};

const loadCounts = async (): Promise<{ notifications: number; messages: number }> => {
  if (!isPanelDbConfigured()) return { notifications: 0, messages: 0 };
  const rows = await panelQuery<{ open: string; unread: string }>(
    `SELECT
       (SELECT COUNT(*)::int FROM chat_tickets WHERE status NOT IN ('closed','resolved'))::text AS open,
       (SELECT COUNT(*)::int FROM chat_tickets WHERE status = 'new' AND assigned_to IS NULL)::text AS unread`,
  );
  const r = rows[0];
  return {
    notifications: r ? Number(r.open) : 0,
    messages: r ? Number(r.unread) : 0,
  };
};

export const ConsolePageShell = async ({
  session,
  activePath,
  title,
  subtitle,
  actions,
  children,
}: {
  session: ShellSession;
  activePath: string;
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
  children: ReactNode;
}) => {
  const display = session.email.split("@")[0] || "Admin";
  const counts = await loadCounts();

  return (
    <div className="flex min-h-screen">
      <Sidebar activePath={activePath} />
      <div className="flex flex-1 flex-col">
        <TopBar
          session={{
            displayName: display,
            email: session.email,
            role: "Administrator",
            avatarUrl: null,
          }}
          notifications={counts.notifications}
          messages={counts.messages}
        />
        <main className="flex-1 space-y-4 p-6 lg:p-8">
          <PageHeader title={title} subtitle={subtitle} actions={actions} />
          {children}
        </main>
      </div>
    </div>
  );
};

const PageHeader = ({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
}) => {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/5 pb-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-white">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
};
