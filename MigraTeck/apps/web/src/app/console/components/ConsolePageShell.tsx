import type { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { panelQuery, isPanelDbConfigured } from "../lib/db";
import { OPEN_TICKET_PREDICATE } from "../lib/support-tickets";

export type ShellSession = {
  email: string;
};

/**
 * Badge counts for every console page that uses this shell.
 *
 * These previously counted `chat_tickets` — the retired generation of the
 * support schema (1 row, closed, last written 2026-02-09). Every page in the
 * console therefore showed 0 open tickets while 7 were genuinely open. The
 * Universe page was fixed on Day 1; this is the same defect in the shared shell,
 * which is what the other ~20 pages render through.
 *
 * Now uses the one canonical predicate (lib/support-tickets.ts), so the shell,
 * the Universe tile and /console/support cannot disagree.
 */
const loadCounts = async (): Promise<{ notifications: number; messages: number }> => {
  if (!isPanelDbConfigured()) return { notifications: 0, messages: 0 };
  try {
    const rows = await panelQuery<{ open: string; unassigned: string }>(
      `SELECT
         (SELECT COUNT(*)::int FROM chat_conversations
           WHERE ${OPEN_TICKET_PREDICATE})::text AS open,
         (SELECT COUNT(*)::int FROM chat_conversations
           WHERE ${OPEN_TICKET_PREDICATE} AND "assignedUserId" IS NULL)::text AS unassigned`,
    );
    const r = rows[0];
    if (!r) return { notifications: 0, messages: 0 };
    return { notifications: Number(r.unassigned) || 0, messages: Number(r.open) || 0 };
  } catch {
    // A badge is a convenience; a failed count must not take down every page.
    return { notifications: 0, messages: 0 };
  }
};

export const ConsolePageShell = async ({
  session,
  activePath,
  title,
  subtitle,
  actions,
  showPageHeader = true,
  viewportLocked = false,
  mainClassName,
  children,
}: {
  session: ShellSession;
  activePath: string;
  title: string;
  subtitle?: string | undefined;
  actions?: ReactNode;
  showPageHeader?: boolean;
  viewportLocked?: boolean;
  mainClassName?: string;
  children: ReactNode;
}) => {
  const display = session.email.split("@")[0] || "Admin";
  const counts = await loadCounts();

  return (
    <div className={viewportLocked ? "flex h-screen overflow-hidden" : "flex min-h-screen"}>
      <Sidebar activePath={activePath} />
      {/* min-w-0 is load-bearing, and it is a LAYOUT INVARIANT of the shell, not
          a per-page choice. A flex child defaults to min-width:auto, so this
          column cannot shrink below the widest thing any page puts inside it —
          a wide table, a code block, a long unbroken string. Below the lg
          breakpoint, where the sidebar is already hidden, that pushes the whole
          document wider than the viewport and the PAGE scrolls sideways instead
          of the wide element scrolling inside its own overflow container.

          Proven on Overview (page.tsx), which renders its own shell and was
          fixed there first; /console/ecosystem was measured at 390px and 768px
          still overflowing because it goes through THIS component, as do 47
          console pages. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          session={{
            displayName: display,
            email: session.email,
            role: "Administrator",
            avatarUrl: null,
          }}
          notifications={counts.notifications}
          notificationsLabel="Unassigned tickets"
          notificationsUnit="ticket"
          notificationsHref="/console/support"
          messages={counts.messages}
        />
        <main
          className={
            mainClassName ||
            (viewportLocked
              ? "flex min-h-0 flex-1 flex-col overflow-hidden p-6 lg:p-8"
              : "flex-1 space-y-4 p-6 lg:p-8")
          }
        >
          {showPageHeader ? <PageHeader title={title} subtitle={subtitle} actions={actions} /> : null}
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
