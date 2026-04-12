"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useCallback, useState } from "react";
import type { ReactNode } from "react";

import { pilotApiUrl } from "../lib/shared/pilot-api";

const NotificationBell = dynamic(() => import("./NotificationBell").then((mod) => mod.NotificationBell), {
  ssr: false,
  loading: () => <span style={{ width: 28, height: 28, display: "inline-block" }} aria-hidden />,
});

const ActivityFeed = dynamic(() => import("./ActivityFeed").then((mod) => mod.ActivityFeed), {
  ssr: false,
});

const ThemeToggle = dynamic(() => import("./ThemeToggle").then((mod) => mod.ThemeToggle), {
  ssr: false,
  loading: () => <span style={{ width: 32, height: 32, display: "inline-block" }} aria-hidden />,
});

/* ── SVG icon components (Lucide-style, 16×16) ── */
const icons: Record<string, JSX.Element> = {
  pilot: <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>,
  inbox: <svg viewBox="0 0 24 24"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>,
  terminal: <svg viewBox="0 0 24 24"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>,
  console: <svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>,
  incident: <svg viewBox="0 0 24 24"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  release: <svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>,
  mission: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>,
  autonomy: <svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>,
  drift: <svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>,
  approval: <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>,
  diff: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>,
  inventory: <svg viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
  journal: <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>,
  brand: <svg viewBox="0 0 24 24"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg>,
  settings: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
  profile: <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>,
  graph: <svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><line x1="8.5" y1="7.5" x2="15.5" y2="16.5"/><line x1="15.5" y1="7.5" x2="8.5" y2="16.5"/></svg>,
  edge: <svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>,
  audit: <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>,
};

const navSections = [
  {
    label: "Pilot",
    items: [
      { href: "/pilot", label: "Dashboard", iconKey: "pilot" },
      { href: "/pilot/runs", label: "Run History", iconKey: "journal" },
      { href: "/pilot/graph", label: "Resource Graph", iconKey: "graph" },
      { href: "/pilot/edge", label: "Edge Control", iconKey: "edge" },
      { href: "/pilot/audit", label: "Audit Log", iconKey: "audit" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/inbox", label: "Inbox", iconKey: "inbox" },
      { href: "/commander", label: "Commander", iconKey: "terminal" },
      { href: "/console", label: "Console", iconKey: "console" },
      { href: "/incidents", label: "Incidents", iconKey: "incident" },
      { href: "/releases", label: "Releases", iconKey: "release" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { href: "/missions", label: "Missions", iconKey: "mission" },
      { href: "/autonomy", label: "Autonomy", iconKey: "autonomy" },
      { href: "/drift", label: "Drift", iconKey: "drift" },
    ],
  },
  {
    label: "Governance",
    items: [
      { href: "/approvals", label: "Approvals", iconKey: "approval" },
      { href: "/diffs", label: "Diffs", iconKey: "diff" },
      { href: "/inventory", label: "Inventory", iconKey: "inventory" },
      { href: "/journal", label: "Journal", iconKey: "journal" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/brands", label: "Brands", iconKey: "brand" },
      { href: "/settings", label: "Settings", iconKey: "settings" },
      { href: "/profile", label: "Profile", iconKey: "profile" },
    ],
  },
];

const PRESENCE_INTERVAL_MS = 20_000;
const PRESENCE_OPERATOR_ID = typeof window !== "undefined"
  ? (localStorage.getItem("pilot_operator_id") ?? "console-operator")
  : "console-operator";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const lastInteractionRef = useRef(Date.now());
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [showDeferredChrome, setShowDeferredChrome] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const isConsoleRoute = pathname === "/console" || pathname.endsWith("/console");
  const deferConsoleChrome = isConsoleRoute;

  const sendPing = useCallback(async () => {
    try {
      await fetch(pilotApiUrl("/api/presence/ping"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorId: PRESENCE_OPERATOR_ID,
          context: { app: "console", page: pathname, env: "browser" },
        }),
      });
    } catch { /* silent */ }
  }, [pathname]);

  useEffect(() => {
    if (deferConsoleChrome && !showDeferredChrome) return;
    void sendPing();
    pingIntervalRef.current = setInterval(() => void sendPing(), PRESENCE_INTERVAL_MS);
    return () => { if (pingIntervalRef.current) clearInterval(pingIntervalRef.current); };
  }, [deferConsoleChrome, sendPing, showDeferredChrome]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const media = window.matchMedia("(min-width: 1025px)");
    const sync = () => setIsDesktopViewport(media.matches);
    sync();

    const onChange = (event: MediaQueryListEvent) => setIsDesktopViewport(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!deferConsoleChrome) {
      setShowDeferredChrome(true);
      return;
    }

    let activated = false;
    const activate = () => {
      if (activated) return;
      activated = true;
      setShowDeferredChrome(true);
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
      window.removeEventListener("touchstart", activate);
    };

    window.addEventListener("pointerdown", activate, { passive: true });
    window.addEventListener("keydown", activate, { passive: true });
    window.addEventListener("touchstart", activate, { passive: true });

    return () => {
      window.removeEventListener("pointerdown", activate);
      window.removeEventListener("keydown", activate);
      window.removeEventListener("touchstart", activate);
    };
  }, [deferConsoleChrome]);

  async function handleLogout() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // best-effort logout
    }
    window.location.assign("/login");
  }

  useEffect(() => {
    if (deferConsoleChrome && !showDeferredChrome) return;
    let debounce: ReturnType<typeof setTimeout> | null = null;
    function onInteraction() {
      const now = Date.now();
      if (now - lastInteractionRef.current > 10_000) {
        lastInteractionRef.current = now;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => void sendPing(), 200);
      }
    }
    window.addEventListener("mousemove", onInteraction, { passive: true });
    window.addEventListener("keydown", onInteraction, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onInteraction);
      window.removeEventListener("keydown", onInteraction);
      if (debounce) clearTimeout(debounce);
    };
  }, [deferConsoleChrome, sendPing, showDeferredChrome]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo" aria-hidden>
            <Image
              src="/brand/migrapilot-logo.png"
              alt=""
              width={28}
              height={28}
              priority
            />
          </div>
          <div style={{ flex: 1 }}>
            <div>MigraPilot</div>
            <div style={{ fontSize: 10, color: "var(--muted)", fontWeight: 400, marginTop: -1 }}>
              Engineering OS
            </div>
          </div>
          {showDeferredChrome ? <NotificationBell /> : <span style={{ width: 28, height: 28, display: "inline-block" }} aria-hidden />}
        </div>

        <nav className="nav">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="nav-section-label">{section.label}</div>
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={isActive ? "active" : undefined}
                  >
                    <span className="nav-icon">{icons[item.iconKey]}</span>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" />
          <span style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: 0.3 }}>v1.0</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>Online</span>
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <ThemeToggle />
            <button
              onClick={() => void handleLogout()}
              style={{ fontSize: 11, border: "1px solid var(--line)", borderRadius: 6, padding: "3px 10px", background: "transparent", color: "var(--fg-dim)", cursor: "pointer", transition: "all 180ms" }}
              title="Sign out"
            >
              Sign out
            </button>
          </span>
        </div>
      </aside>

      <main className="content">{children}</main>
      {isDesktopViewport && showDeferredChrome ? <ActivityFeed /> : null}
    </div>
  );
}
