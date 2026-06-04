import Image from "next/image";
import Link from "next/link";
import { Bell, MessageCircle } from "lucide-react";
import { CommandPalette } from "./CommandPalette";
import { CreateNewMenu } from "./CreateNewMenu";
import { AiPromptBar } from "./AiPromptBar";

export type TopBarSession = {
  displayName: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
};

export const TopBar = ({
  session,
  notifications,
  messages,
}: {
  session: TopBarSession;
  notifications: number;
  messages: number;
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-slate-950/85 px-6 py-4 backdrop-blur-xl">
      <div className="flex items-center gap-3">
        <div className="flex flex-1 items-center gap-3">
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
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">
              MigraPanel Control Center
            </h1>
            <p className="text-xs text-slate-500">
              Operational control surface for the MigraTeck ecosystem
            </p>
          </div>
        </div>

        {/* ⌘K search — opens command palette overlay */}
        <CommandPalette />

        {/* AI prompt bar — navigates to support / analytics on submit */}
        <AiPromptBar />

        {/* Create New dropdown */}
        <CreateNewMenu />

        {/* Notification bell → support tickets */}
        <Link
          href="/console/support"
          aria-label={`Support tickets${notifications > 0 ? ` (${notifications} open)` : ""}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <Bell className="h-4 w-4" />
          {notifications > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-semibold text-white">
              {notifications > 99 ? "99+" : notifications}
            </span>
          )}
        </Link>

        {/* Message icon → team page */}
        <Link
          href="/console/team"
          aria-label={`Team${messages > 0 ? ` (${messages})` : ""}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
        >
          <MessageCircle className="h-4 w-4" />
          {messages > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-fuchsia-500 px-1 text-[9px] font-semibold text-white">
              {messages > 99 ? "99+" : messages}
            </span>
          )}
        </Link>

        {/* Profile pill */}
        <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/5 py-1 pl-2 pr-2">
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
            <div className="text-right text-xs leading-tight">
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
