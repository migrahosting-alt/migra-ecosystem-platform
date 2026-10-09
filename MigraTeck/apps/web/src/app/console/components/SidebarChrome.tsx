"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

const STORAGE_KEY = "migrapanel.sidebar.collapsed";

/**
 * Client shell around the (server-rendered) sidebar contents.
 *
 * Exists because the sidebar itself is an async server component — it awaits
 * getSession() to build a capability-filtered nav — so it cannot hold the
 * collapse state itself. This wrapper owns the state, persists the operator's
 * choice, and exposes it as `data-collapsed` on the <aside> so descendants can
 * respond with `group-data-[collapsed=true]/sidebar:` variants.
 *
 * Before this existed the collapse control was a <button> with no onClick at
 * all: it rendered, invited a click, and did nothing.
 */
export function SidebarChrome({
  header,
  children,
  footer,
}: {
  header: React.ReactNode;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  // Start expanded so server and first client render agree; the stored
  // preference is applied after mount to avoid a hydration mismatch.
  const [collapsed, setCollapsed] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      // Private mode / blocked storage: fall back to expanded, never crash the shell.
    }
    setReady(true);
  }, []);

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Preference is a convenience; failing to persist must not break the toggle.
      }
      return next;
    });
  };

  return (
    <aside
      data-collapsed={collapsed ? "true" : "false"}
      className={[
        "group/sidebar hidden shrink-0 flex-col border-r border-white/5 bg-slate-950/95 backdrop-blur lg:flex",
        ready ? "transition-[width] duration-200 ease-out" : "",
        collapsed ? "w-[4.5rem]" : "w-64",
      ].join(" ")}
    >
      <div className="flex items-center justify-between px-5 py-5 group-data-[collapsed=true]/sidebar:px-4">
        {header}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-md p-1 text-slate-400 transition hover:bg-white/5 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fuchsia-400"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 group-data-[collapsed=true]/sidebar:px-2">
        {children}
      </nav>

      <div className="group-data-[collapsed=true]/sidebar:hidden">{footer}</div>
    </aside>
  );
}
