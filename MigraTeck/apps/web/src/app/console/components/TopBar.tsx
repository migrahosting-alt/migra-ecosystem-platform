import Image from "next/image";
import Link from "next/link";
import { Bell, MessageCircle } from "lucide-react";
import { CommandPalette } from "./CommandPalette";
import { CreateNewMenu } from "./CreateNewMenu";

export type TopBarSession = {
  displayName: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
};

/**
 * The bell's meaning is supplied by the caller, not assumed here.
 *
 * The Universe page feeds it estate attention items; every page rendered through
 * ConsolePageShell feeds it unassigned support tickets. With the label hardcoded,
 * the shell pages announced "Requires attention (N items)" over a ticket count —
 * the same class of defect as the original "Support tickets (N open)" label over
 * an attention count. A badge whose number and words come from different places
 * will drift, so the caller now states both.
 */
export const TopBar = ({
  session,
  notifications,
  messages,
  notificationsLabel = "Requires attention",
  notificationsUnit = "item",
  notificationsHref = "/console",
}: {
  session: TopBarSession;
  notifications: number;
  /** Open-ticket count, or null when it could not be measured. Null is NOT
   *  zero: the badge hides for both, but only a real zero may be announced as
   *  "no open tickets". */
  messages: number | null;
  notificationsLabel?: string;
  notificationsUnit?: string;
  notificationsHref?: string;
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/85 px-4 py-4 backdrop-blur-xl sm:px-6">
      {/* min-w-0 + a narrower gutter below sm: this row is what pushed the page
          sideways at 390px and 768px. Its children are fixed-size controls, so
          without min-w-0 the row could not shrink and the whole document grew
          past the viewport. The identity text inside the profile pill also
          collapses below lg — the avatar still identifies the operator and the
          name is one tap away on /console/account. lg, not sm, because the
          search bar reappears at md with a hard min-w-[260px] and no shrink, so
          768px was still 34px over with the name showing. */}
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {/* Mobile only: on lg+ the sidebar already carries the MigraPanel brand.
            Keeping it here squeezed the title into a three-line wrap and stole the
            search bar's width. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 lg:hidden">
          <Link
            href="/console"
            aria-label="MigraPanel Control Center"
            className="relative inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] shadow-lg shadow-fuchsia-950/20 lg:hidden"
          >
            <Image
              src="/brands/products/migrapanel-mark.png"
              alt="MigraPanel"
              fill
              sizes="44px"
              className="object-contain p-0.5"
            />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-bold tracking-tight text-white">
              MigraPanel Control Center
            </h1>
            <p className="truncate text-xs text-slate-500">
              Operational control surface for the MigraTeck ecosystem
            </p>
          </div>
        </div>

        {/* ⌘K search — opens command palette overlay */}
        <CommandPalette />

        {/* REMOVED (Day 1): the "Ask AI to monitor, create, automate, or
            investigate..." bar. It was not inert — it had a real onSubmit — but
            what it actually did was `router.push('/console/support?q=' + text)`,
            i.e. a support-ticket text search. So typing "restart mail-core"
            searched tickets for that string and restarted nothing.
            Advertising monitor/create/automate/investigate over the estate while
            performing a ticket lookup is a capability claim with a different
            action behind it, which is worse than a control that does nothing.
            The console must not advertise AI control until a prompt can drive
            the same governed control APIs the buttons use — AI is not a
            separate privileged path. The ⌘K CommandPalette above stays: its
            /console/api/search backend returns real clients and domains and an
            empty list for no match. */}
        {/* Reclaims the width freed by hiding the duplicated title, so search sits
            left and the action cluster stays right-aligned on desktop. */}
        <div aria-hidden className="hidden flex-1 lg:block" />

        {/* Create New dropdown */}
        <CreateNewMenu />

        {/* Bell → the Requires attention list on the Overview page.
            It previously pointed at /console/support and announced itself as
            "Support tickets (N open)", while the number it was given is the
            count of estate attention items — guest-agent gaps, stale job runs,
            unverified addresses, degraded probes. None of those are tickets,
            and the real ticket count is different, so the label stated
            something false to every screen reader that read it. The count was
            right and the words around it were wrong. */}
        <Link
          href={notificationsHref}
          aria-label={`${notificationsLabel}${notifications > 0 ? ` (${notifications} ${notificationsUnit}${notifications === 1 ? "" : "s"})` : " (nothing flagged)"}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <Bell className="h-4 w-4" />
          {notifications > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white">
              {notifications > 99 ? "99+" : notifications}
            </span>
          )}
        </Link>

        {/* Messages → support. This is the open-ticket count (canonical source:
            lib/support-tickets.ts), so it now links to the queue those tickets
            live in. It previously linked to /console/team and announced
            "Team (N)", which read the ticket count as a headcount. */}
        <Link
          href="/console/support"
          /* The badge was already honest — it hides at zero. The accessible
             name was not: an UNMEASURED count arrived here coerced to 0 and was
             announced as "no open tickets", an affirmative all-clear derived
             from a measurement that never happened. Sighted operators saw an
             absent badge; screen-reader users were told the queue was empty.
             Null now reaches this component intact and says so. */
          aria-label={
            messages === null
              ? "Support (open ticket count unavailable)"
              : messages > 0
                ? `Support (${messages} open ticket${messages === 1 ? "" : "s"})`
                : "Support (no open tickets)"
          }
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <MessageCircle className="h-4 w-4" />
          {messages !== null && messages > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[9px] font-semibold text-white">
              {messages > 99 ? "99+" : messages}
            </span>
          )}
        </Link>

        {/* Profile pill */}
        <div className="flex shrink-0 items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pl-2 pr-2 sm:gap-3">
          <Link
            href="/console/account"
            className="flex items-center gap-3 transition hover:text-fuchsia-200"
            aria-label="Account & profile"
            title="Account & profile"
          >
            {session.avatarUrl ? (
              <Image
                src={session.avatarUrl}
                alt=""
                width={32}
                height={32}
                className="rounded-full"
              />
            ) : (
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-400 text-xs font-bold text-white">
                {session.displayName
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
            )}
            <div className="hidden text-right text-xs leading-tight lg:block">
              <p className="font-semibold text-white">{session.displayName}</p>
              <p className="text-[10px] text-slate-400">{session.role}</p>
            </div>
          </Link>
          <a
            href="/console/api/logout"
            className="ml-1 inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Sign out"
            title="Sign out"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </a>
        </div>
      </div>
    </header>
  );
};
