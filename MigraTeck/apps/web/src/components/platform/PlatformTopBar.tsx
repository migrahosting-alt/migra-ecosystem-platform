"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Building2,
  Code2,
  CreditCard,
  Loader2,
  Search,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { LogoutButton } from "@/components/auth/LogoutButton";
import type { PlatformOrganization } from "@/lib/platform";

interface PlatformTopBarProps {
  activeOrgId?: string;
  organizations: PlatformOrganization[];
  operatorSearchEnabled?: boolean;
  session: {
    email: string;
    displayName?: string;
    activeOrgName?: string;
    activeOrgRole?: string;
  };
}

type LiveSearchKind = "organization" | "identity_user" | "billing_customer";

type LiveSearchResult = {
  id: string;
  kind: LiveSearchKind;
  title: string;
  subtitle: string;
  detail: string | null;
  href: string;
  source: "platform" | "migraauth" | "commerce";
};

type SourceState = "ok" | "partial" | "unavailable" | "not_authorized";

type SearchPayload = {
  query: string;
  operator: boolean;
  sources: {
    organizations: SourceState;
    users: SourceState;
    commerce: SourceState;
  };
  results: LiveSearchResult[];
};

type ModuleCommand = {
  id: string;
  title: string;
  category: string;
  href: string;
  keywords: string[];
};

type CommandItem =
  | {
      key: string;
      source: "module";
      title: string;
      subtitle: string;
      detail: string;
      href: string;
    }
  | {
      key: string;
      source: "live";
      title: string;
      subtitle: string;
      detail: string | null;
      href: string;
      kind: LiveSearchKind;
      origin: LiveSearchResult["source"];
    };

const MODULE_COMMANDS: ModuleCommand[] = [
  {
    id: "overview",
    title: "Overview",
    category: "Home",
    href: "/platform/overview",
    keywords: ["dashboard", "health", "attention", "platform"],
  },
  {
    id: "organizations",
    title: "Organizations",
    category: "Organization",
    href: "/platform/organizations",
    keywords: ["tenant", "company", "workspace", "identity"],
  },
  {
    id: "members",
    title: "Members & Access",
    category: "Organization",
    href: "/platform/members",
    keywords: ["members", "roles", "operator", "authority", "access"],
  },
  {
    id: "developers",
    title: "Developer Platform",
    category: "Developers",
    href: "/platform/developers",
    keywords: ["developer", "api", "oauth", "webhook", "machine"],
  },
  {
    id: "api-keys",
    title: "API Keys",
    category: "Developers",
    href: "/platform/developers/api-keys",
    keywords: ["key", "credential", "machine", "scope"],
  },
  {
    id: "oauth",
    title: "OAuth Apps",
    category: "Developers",
    href: "/platform/developers/oauth",
    keywords: ["oauth", "client", "redirect", "pkce"],
  },
  {
    id: "webhooks",
    title: "Webhooks & Events",
    category: "Developers",
    href: "/platform/developers/webhooks",
    keywords: ["webhook", "events", "delivery", "replay"],
  },
  {
    id: "api-usage",
    title: "API & Usage",
    category: "Developers",
    href: "/platform/usage",
    keywords: ["usage", "latency", "rate limit", "requests", "telemetry"],
  },
  {
    id: "commerce",
    title: "Commerce Overview",
    category: "Commerce",
    href: "/platform/commerce",
    keywords: ["commerce", "payments", "billing", "entitlements"],
  },
  {
    id: "billing",
    title: "MigraPay & Billing",
    category: "Commerce",
    href: "/platform/billing",
    keywords: ["stripe", "customer", "subscription", "invoice", "payment"],
  },
  {
    id: "catalog",
    title: "Catalog & Entitlements",
    category: "Commerce",
    href: "/platform/commerce/catalog",
    keywords: ["catalog", "plan", "price", "entitlement", "provisioning"],
  },
  {
    id: "metering",
    title: "Usage & Metering",
    category: "Commerce",
    href: "/platform/commerce/usage",
    keywords: ["meter", "quota", "usage", "export"],
  },
  {
    id: "hosting",
    title: "Hosting",
    category: "Infrastructure",
    href: "/platform/hosting",
    keywords: ["hosting", "tenant", "server", "migrapanel", "runtime"],
  },
  {
    id: "intake",
    title: "Intake",
    category: "Infrastructure",
    href: "/platform/intake",
    keywords: ["intake", "forms", "submissions", "migration"],
  },
  {
    id: "distribution",
    title: "Releases & Downloads",
    category: "Infrastructure",
    href: "/platform/distribution",
    keywords: ["release", "download", "artifact", "integrity", "distribution"],
  },
  {
    id: "trust",
    title: "Trust Operations",
    category: "Trust",
    href: "/platform/trust",
    keywords: ["user", "identity", "session", "lock", "mfa", "trust"],
  },
  {
    id: "security",
    title: "My Security",
    category: "Trust",
    href: "/platform/security",
    keywords: ["password", "passkey", "mfa", "session", "security"],
  },
  {
    id: "compliance",
    title: "Compliance & Audit",
    category: "Trust",
    href: "/platform/compliance",
    keywords: ["audit", "incident", "retention", "governance", "compliance"],
  },
];

function moduleScore(command: ModuleCommand, query: string): number {
  const q = query.toLowerCase();
  const title = command.title.toLowerCase();
  const category = command.category.toLowerCase();
  if (title === q) return 0;
  if (title.startsWith(q)) return 1;
  if (category.startsWith(q)) return 2;
  if (title.includes(q)) return 3;
  if (command.keywords.some((keyword) => keyword.startsWith(q))) return 4;
  if (command.keywords.some((keyword) => keyword.includes(q))) return 5;
  return 99;
}

function moduleMatches(query: string): CommandItem[] {
  const q = query.trim();
  if (!q) return [];
  return MODULE_COMMANDS
    .map((command) => ({ command, score: moduleScore(command, q) }))
    .filter((entry) => entry.score < 99)
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.command.title.localeCompare(b.command.title),
    )
    .slice(0, 6)
    .map(({ command }) => ({
      key: "module:" + command.id,
      source: "module" as const,
      title: command.title,
      subtitle: command.category,
      detail: command.keywords.slice(0, 3).join(" · "),
      href: command.href,
    }));
}

function liveIcon(kind: LiveSearchKind) {
  if (kind === "organization") return Building2;
  if (kind === "identity_user") return UserRoundCog;
  return CreditCard;
}

function liveLabel(kind: LiveSearchKind) {
  if (kind === "organization") return "Organization";
  if (kind === "identity_user") return "Identity user";
  return "Billing customer";
}

function sourceWarning(payload: SearchPayload | null): string | null {
  if (!payload) return null;
  const unavailable = Object.entries(payload.sources)
    .filter(([, state]) => state === "unavailable" || state === "partial")
    .map(([source]) => source);
  if (unavailable.length === 0) return null;
  return "Some live sources have reduced visibility: " + unavailable.join(", ") + ".";
}

export function PlatformTopBar({
  activeOrgId,
  organizations,
  operatorSearchEnabled = false,
  session,
}: PlatformTopBarProps) {
  const router = useRouter();
  const [switchPending, setSwitchPending] = useState(false);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [livePayload, setLivePayload] = useState<SearchPayload | null>(null);
  const [livePending, setLivePending] = useState(false);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const moduleResults = useMemo(() => moduleMatches(query), [query]);
  const liveResults = useMemo<CommandItem[]>(
    () =>
      (livePayload?.results ?? []).map((result) => ({
        key: "live:" + result.id,
        source: "live",
        title: result.title,
        subtitle: liveLabel(result.kind) + " · " + result.subtitle,
        detail: result.detail,
        href: result.href,
        kind: result.kind,
        origin: result.source,
      })),
    [livePayload],
  );
  const combinedResults = useMemo(
    () => [...moduleResults, ...liveResults],
    [moduleResults, liveResults],
  );
  const warning = sourceWarning(livePayload);

  async function handleSwitchOrg(nextOrgId: string) {
    if (!nextOrgId || nextOrgId === activeOrgId) return;

    setSwitchPending(true);
    try {
      const response = await fetch("/api/platform/session/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId: nextOrgId }),
      });

      if (response.ok) window.location.reload();
    } finally {
      setSwitchPending(false);
    }
  }

  function navigate(item: CommandItem) {
    setSearchOpen(false);
    setQuery("");
    setLivePayload(null);
    setLiveError(null);
    router.push(item.href);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setSearchOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown" && combinedResults.length > 0) {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % combinedResults.length);
      return;
    }
    if (event.key === "ArrowUp" && combinedResults.length > 0) {
      event.preventDefault();
      setActiveIndex(
        (current) =>
          (current - 1 + combinedResults.length) % combinedResults.length,
      );
      return;
    }
    if (event.key === "Enter") {
      const item = combinedResults[activeIndex];
      if (item) {
        event.preventDefault();
        navigate(item);
      }
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      const shortcut =
        event.key === "/" ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k");

      if (!shortcut || (typing && event.key === "/")) return;
      event.preventDefault();
      inputRef.current?.focus();
      setSearchOpen(true);
    };

    const onPointerDown = (event: PointerEvent) => {
      const node = event.target as Node | null;
      if (
        node &&
        searchRootRef.current &&
        !searchRootRef.current.contains(node)
      ) {
        setSearchOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (combinedResults.length === 0) {
      setActiveIndex(0);
    } else if (activeIndex >= combinedResults.length) {
      setActiveIndex(combinedResults.length - 1);
    }
  }, [activeIndex, combinedResults.length]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!operatorSearchEnabled || trimmed.length < 2) {
      setLivePayload(null);
      setLivePending(false);
      setLiveError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLivePending(true);
      setLiveError(null);
      try {
        const params = new URLSearchParams({ q: trimmed, limit: "6" });
        const response = await fetch(
          "/api/platform/search?" + params.toString(),
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.error ?? "Live operator search is unavailable.");
        }
        if (!controller.signal.aborted) {
          setLivePayload(body as SearchPayload);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setLivePayload(null);
        setLiveError(
          error instanceof Error
            ? error.message
            : "Live operator search is unavailable.",
        );
      } finally {
        if (!controller.signal.aborted) setLivePending(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [operatorSearchEnabled, query]);

  return (
    <header className="border-b border-slate-200/80 bg-white/92 px-6 py-3.5 backdrop-blur-xl">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <div className="min-w-[175px]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400">
              MigraTeck Platform
            </p>
            <div className="mt-1 flex items-center gap-2">
              <span className="truncate text-sm font-semibold text-slate-900">
                {session.activeOrgName ?? "Platform context"}
              </span>
              {session.activeOrgRole ? (
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  {session.activeOrgRole}
                </span>
              ) : null}
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-emerald-700">
                Production
              </span>
            </div>
          </div>

          <div
            ref={searchRootRef}
            className="relative hidden min-w-0 max-w-xl flex-1 lg:block"
          >
            <Search
              className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-slate-400"
              size={16}
            />
            <input
              ref={inputRef}
              aria-label="Search MigraTeck platform"
              value={query}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => {
                setQuery(event.target.value);
                setSearchOpen(true);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search platform, organizations, users, billing..."
              autoComplete="off"
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-16 text-sm text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">
              /
            </span>

            {searchOpen && query.trim() ? (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-[90] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
                <div className="max-h-[32rem] overflow-y-auto p-2">
                  {moduleResults.length > 0 ? (
                    <SearchGroup label="Go to">
                      {moduleResults.map((item) => {
                        const index = combinedResults.findIndex(
                          (entry) => entry.key === item.key,
                        );
                        return (
                          <SearchRow
                            key={item.key}
                            item={item}
                            active={index === activeIndex}
                            onSelect={() => navigate(item)}
                          />
                        );
                      })}
                    </SearchGroup>
                  ) : null}

                  {operatorSearchEnabled && query.trim().length >= 2 ? (
                    <SearchGroup
                      label="Live operator results"
                      trailing={
                        livePending ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                            <Loader2 size={11} className="animate-spin" />
                            Searching
                          </span>
                        ) : null
                      }
                    >
                      {liveResults.map((item) => {
                        const index = combinedResults.findIndex(
                          (entry) => entry.key === item.key,
                        );
                        return (
                          <SearchRow
                            key={item.key}
                            item={item}
                            active={index === activeIndex}
                            onSelect={() => navigate(item)}
                          />
                        );
                      })}
                      {!livePending &&
                      !liveError &&
                      livePayload &&
                      liveResults.length === 0 ? (
                        <p className="px-3 py-3 text-xs text-slate-500">
                          No live operator entities matched this query.
                        </p>
                      ) : null}
                      {liveError ? (
                        <p className="px-3 py-3 text-xs font-medium text-rose-700">
                          {liveError}
                        </p>
                      ) : null}
                      {warning ? (
                        <p className="px-3 py-2 text-[10px] leading-5 text-amber-700">
                          {warning}
                        </p>
                      ) : null}
                    </SearchGroup>
                  ) : !operatorSearchEnabled && query.trim().length >= 2 ? (
                    <div className="mx-1 mt-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[11px] leading-5 text-slate-500">
                      Cross-tenant entity search is available only to MigraTeck
                      platform operators. Module navigation remains available.
                    </div>
                  ) : null}

                  {combinedResults.length === 0 &&
                  !livePending &&
                  !liveError ? (
                    <div className="px-4 py-6 text-center">
                      <p className="text-sm font-semibold text-slate-800">
                        No platform command matched
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-500">
                        Try a module name, organization, user email, or billing customer identifier.
                      </p>
                    </div>
                  ) : null}
                </div>

                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-medium text-slate-400">
                  <span>↑↓ move · Enter open · Esc close</span>
                  <span>{operatorSearchEnabled ? "Live authority-aware search" : "Navigation search"}</span>
                </div>
              </div>
            ) : null}
          </div>

          <select
            id="platform-org-switcher"
            value={activeOrgId ?? ""}
            disabled={switchPending || organizations.length === 0}
            onChange={(event) => void handleSwitchOrg(event.target.value)}
            className="hidden min-w-[190px] rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 disabled:opacity-50 2xl:block"
          >
            {organizations.length === 0 ? (
              <option value="">No organization selected</option>
            ) : null}
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center justify-between gap-3">
          <nav className="hidden items-center gap-1 lg:flex">
            <Link
              href="/platform/developers"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <Code2 size={16} /> Developers
            </Link>
            <Link
              href="/platform/commerce"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <CreditCard size={16} /> Commerce
            </Link>
            <Link
              href="/platform/trust"
              className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
            >
              <ShieldCheck size={16} /> Trust
            </Link>
          </nav>

          <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <div className="min-w-0">
              <p className="max-w-[180px] truncate text-sm font-semibold text-slate-900">
                {session.displayName ?? session.email}
              </p>
              <p className="max-w-[180px] truncate text-xs text-slate-500">
                {session.email}
              </p>
            </div>
            <LogoutButton />
          </div>
        </div>
      </div>
    </header>
  );
}

function SearchGroup({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-2 last:mb-0">
      <div className="flex items-center justify-between px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
          {label}
        </p>
        {trailing}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function SearchRow({
  item,
  active,
  onSelect,
}: {
  item: CommandItem;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon =
    item.source === "live" ? liveIcon(item.kind) : Code2;

  return (
    <button
      type="button"
      onMouseEnter={() => undefined}
      onClick={onSelect}
      className={
        "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition " +
        (active
          ? "bg-blue-50 text-blue-950"
          : "text-slate-700 hover:bg-slate-50")
      }
    >
      <span
        className={
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg " +
          (active
            ? "bg-blue-100 text-blue-700"
            : "bg-slate-100 text-slate-500")
        }
      >
        <Icon size={15} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold">{item.title}</span>
          {item.source === "live" ? (
            <span className="shrink-0 rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              {item.origin}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 block truncate text-[11px] font-medium text-slate-500">
          {item.subtitle}
        </span>
        {item.detail ? (
          <span className="mt-0.5 block truncate text-[10px] text-slate-400">
            {item.detail}
          </span>
        ) : null}
      </span>
      <ArrowRight size={14} className="mt-2 shrink-0 text-slate-300" />
    </button>
  );
}
