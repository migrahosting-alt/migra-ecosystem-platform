"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Users,
  Globe,
  FileText,
  Server,
  Loader2,
} from "lucide-react";

type ResultType = "client" | "domain" | "ticket" | "module";

type SearchResult = {
  id: string;
  type: ResultType;
  label: string;
  sublabel?: string;
  href: string;
};

const MODULES: SearchResult[] = [
  { id: "billing", type: "module", label: "Billing", sublabel: "Invoices & payments", href: "/console/billing" },
  { id: "clients", type: "module", label: "Clients", sublabel: "Tenant accounts", href: "/console/clients" },
  { id: "hosting", type: "module", label: "Hosting", sublabel: "Sites & deployments", href: "/console/hosting" },
  { id: "domains", type: "module", label: "Domains", sublabel: "DNS & registrar", href: "/console/domains" },
  { id: "email", type: "module", label: "Email", sublabel: "Mailboxes & campaigns", href: "/console/email" },
  { id: "voice", type: "module", label: "Voice", sublabel: "Calls & IVR", href: "/console/voice" },
  { id: "intake", type: "module", label: "Intake", sublabel: "Lead forms & CRM", href: "/console/intake" },
  { id: "marketing", type: "module", label: "Marketing", sublabel: "SEO & campaigns", href: "/console/marketing" },
  { id: "automation", type: "module", label: "Automation", sublabel: "Jobs & webhooks", href: "/console/automation" },
  { id: "analytics", type: "module", label: "Analytics", sublabel: "Events & conversions", href: "/console/analytics" },
  { id: "security", type: "module", label: "Security", sublabel: "Compliance & access", href: "/console/security" },
  { id: "support", type: "module", label: "Support", sublabel: "Tickets & SLA", href: "/console/support" },
  { id: "team", type: "module", label: "Team", sublabel: "Staff & roles", href: "/console/team" },
  { id: "settings", type: "module", label: "Settings", sublabel: "Platform config", href: "/console/settings" },
];

export const CommandPalette = () => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>(MODULES.slice(0, 8));
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ⌘K / Ctrl+K to open
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened; reset when closed
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      setQuery("");
      setResults(MODULES.slice(0, 8));
      setSelectedIndex(0);
    }
  }, [open]);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(MODULES.slice(0, 8));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/console/api/search?q=${encodeURIComponent(q)}`,
        { cache: "no-store" },
      );
      if (res.ok) {
        const data = (await res.json()) as SearchResult[];
        setResults(data);
      }
    } catch {
      // fallback: filter modules client-side
      const lower = q.toLowerCase();
      setResults(
        MODULES.filter(
          (m) =>
            m.label.toLowerCase().includes(lower) ||
            (m.sublabel ?? "").toLowerCase().includes(lower),
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => doSearch(query), 200);
    return () => clearTimeout(t);
  }, [query, doSearch]);

  // Arrow key + Enter navigation
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const r = results[selectedIndex];
        if (r) {
          router.push(r.href);
          setOpen(false);
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, results, selectedIndex, router]);

  // Trigger button (shown in the header when palette is closed)
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative hidden min-w-[260px] flex-shrink-0 items-center rounded-full border border-white/10 bg-white/5 py-2 pl-10 pr-12 text-sm text-slate-500 transition hover:border-white/20 hover:bg-white/[0.08] md:flex"
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        Search clients, domains, services, tickets...
        <kbd className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] font-medium text-slate-400">
          ⌘K
        </kbd>
      </button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />

      {/* Palette modal */}
      <div className="fixed left-1/2 top-[15vh] z-50 w-full max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl shadow-slate-950/80">
        {/* Input row */}
        <div className="flex items-center gap-3 border-b border-white/5 px-4 py-3">
          {loading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-fuchsia-400" />
          ) : (
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <input
            ref={inputRef}
            type="text"
            placeholder="Search clients, domains, tickets, modules..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <kbd
            role="button"
            tabIndex={0}
            onClick={() => setOpen(false)}
            onKeyDown={(e) => e.key === "Enter" && setOpen(false)}
            className="cursor-pointer rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/10"
          >
            Esc
          </kbd>
        </div>

        {/* Results */}
        <ul className="max-h-80 overflow-y-auto py-1.5">
          {results.length === 0 && query.trim() && !loading && (
            <li className="px-4 py-8 text-center text-xs text-slate-500">
              No results for &ldquo;{query}&rdquo;
            </li>
          )}
          {results.map((r, i) => (
            <li key={`${r.type}-${r.id}`}>
              <button
                type="button"
                onClick={() => {
                  router.push(r.href);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition ${
                  i === selectedIndex
                    ? "bg-fuchsia-500/10 text-white"
                    : "text-slate-200 hover:bg-white/5 hover:text-white"
                }`}
              >
                <ResultIcon type={r.type} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.label}</p>
                  {r.sublabel && (
                    <p className="truncate text-[11px] text-slate-500">
                      {r.sublabel}
                    </p>
                  )}
                </div>
                <span className="shrink-0 rounded bg-white/5 px-1.5 py-0.5 text-[10px] capitalize text-slate-500">
                  {r.type}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {!query.trim() && (
          <div className="border-t border-white/5 px-4 py-2 text-[10px] text-slate-600">
            Type to search · Navigate with ↑↓ · Confirm with Enter
          </div>
        )}
      </div>
    </>
  );
};

const ResultIcon = ({ type }: { type: ResultType }) => {
  const cls = "h-4 w-4 shrink-0";
  if (type === "client") return <Users className={`${cls} text-sky-400`} />;
  if (type === "domain") return <Globe className={`${cls} text-indigo-400`} />;
  if (type === "ticket") return <FileText className={`${cls} text-amber-400`} />;
  return <Server className={`${cls} text-fuchsia-400`} />;
};
