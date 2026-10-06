"use client";

import Link from "next/link";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  Check,
  ChevronDown,
  ChevronUp,
  Clipboard,
  Download,
  Filter,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCog,
} from "lucide-react";

type AuditEntry = {
  id: string;
  actor_user_id: string | null;
  actor_type: string | null;
  target_user_id: string | null;
  client_id: string | null;
  event_type: string;
  event_data: Record<string, unknown>;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
};

type AuditResponse = {
  audit_logs: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
  evidence_window?: {
    newest_at: string | null;
    oldest_at: string | null;
  };
};

type Filters = {
  eventType: string;
  userId: string;
  clientId: string;
};

const EMPTY_FILTERS: Filters = {
  eventType: "",
  userId: "",
  clientId: "",
};

const PAGE_SIZE = 50;

function eventCategory(eventType: string) {
  const normalized = eventType.toUpperCase();
  if (/MFA|PASSWORD|LOGIN|SESSION|CREDENTIAL|RECOVERY/.test(normalized)) {
    return "Identity";
  }
  if (/ROLE|MEMBER|INVITE|ORG|ACCESS|OWNER/.test(normalized)) {
    return "Access";
  }
  if (/OAUTH|CLIENT|TOKEN|API_KEY|SECRET/.test(normalized)) {
    return "Machine trust";
  }
  if (/BILLING|PAYMENT|SUBSCRIPTION|INVOICE|PRICE|ENTITLEMENT/.test(normalized)) {
    return "Commerce";
  }
  return "Platform";
}

function eventRisk(eventType: string, data: Record<string, unknown>) {
  const normalized = eventType.toUpperCase();
  const body = JSON.stringify(data).toUpperCase();

  if (
    /MFA_RESET|ROLE_(GRANTED|REVOKED)|OWNER|ACCOUNT_(DISABLED|LOCKED)|SESSIONS_REVOKED|PASSWORD_RESET/.test(
      normalized,
    ) ||
    /CONTAIN|SUSPEND|DISABLE|REVOKE_ALL/.test(body)
  ) {
    return "high" as const;
  }

  if (/ADMIN_|ROLE|MEMBER|INVITE|SESSION|TOKEN|CLIENT|PASSWORD|MFA/.test(normalized)) {
    return "medium" as const;
  }

  return "normal" as const;
}

function riskClass(risk: ReturnType<typeof eventRisk>) {
  if (risk === "high") return "border-rose-200 bg-rose-50 text-rose-700";
  if (risk === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function compactId(value: string | null) {
  if (!value) return "—";
  return value.length <= 18 ? value : value.slice(0, 8) + "…" + value.slice(-6);
}

function paramsFor(filters: Filters, offset: number) {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(offset),
  });
  if (filters.eventType.trim()) params.set("event_type", filters.eventType.trim());
  if (filters.userId.trim()) params.set("user_id", filters.userId.trim());
  if (filters.clientId.trim()) params.set("client_id", filters.clientId.trim());
  return params;
}

export function ComplianceWorkspace() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [draftFilters, setDraftFilters] = useState<Filters>(EMPTY_FILTERS);
  const [evidenceWindow, setEvidenceWindow] = useState<AuditResponse["evidence_window"]>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function loadAudit(background = false) {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        "/api/platform/compliance/audit?" + paramsFor(filters, offset).toString(),
        { cache: "no-store" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Failed to load platform audit evidence.");
      }

      setEntries(body.audit_logs ?? []);
      setTotal(body.total ?? 0);
      setEvidenceWindow(body.evidence_window);
    } catch (cause) {
      setEntries([]);
      setTotal(0);
      setEvidenceWindow(undefined);
      setError(
        cause instanceof Error ? cause.message : "Unable to reach platform audit authority.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadAudit();
    // Filters and offset define the server-side result set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, offset]);

  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const loadedRisk = useMemo(
    () =>
      entries.reduce(
        (summary, entry) => {
          const risk = eventRisk(entry.event_type, entry.event_data);
          summary[risk] += 1;
          return summary;
        },
        { high: 0, medium: 0, normal: 0 },
      ),
    [entries],
  );

  const loadedCategories = useMemo(() => {
    const categories = new Map<string, number>();
    for (const entry of entries) {
      const category = eventCategory(entry.event_type);
      categories.set(category, (categories.get(category) ?? 0) + 1);
    }
    return [...categories.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const exportParams = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.eventType.trim()) params.set("event_type", filters.eventType.trim());
    if (filters.userId.trim()) params.set("user_id", filters.userId.trim());
    if (filters.clientId.trim()) params.set("client_id", filters.clientId.trim());
    return params.toString();
  }, [filters]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setOffset(0);
    setFilters({
      eventType: draftFilters.eventType.trim(),
      userId: draftFilters.userId.trim(),
      clientId: draftFilters.clientId.trim(),
    });
  }

  function clearFilters() {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setOffset(0);
  }

  async function copyEvidence(entry: AuditEntry) {
    await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
    setCopiedId(entry.id);
    window.setTimeout(() => setCopiedId(null), 1600);
  }

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 p-5 sm:p-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                Platform audit authority
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                Audit evidence
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Review the MigraAuth platform audit stream across operators, target users,
                OAuth clients, identity events, and access changes. Filters execute against
                the audit authority itself—not only against rows already loaded in the browser.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <a
                href={
                  "/api/platform/compliance/audit/export" +
                  (exportParams ? "?" + exportParams : "")
                }
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                <Download size={15} />
                Export CSV
              </a>
              <button
                onClick={() => void loadAudit(true)}
                disabled={refreshing}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        <form onSubmit={applyFilters} className="grid gap-4 p-5 sm:p-6 lg:grid-cols-3">
          <label className="text-sm font-semibold text-slate-800">
            Event type
            <div className="relative mt-2">
              <Search
                size={15}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={draftFilters.eventType}
                onChange={(event) =>
                  setDraftFilters((current) => ({
                    ...current,
                    eventType: event.target.value,
                  }))
                }
                placeholder="ADMIN_MFA_RESET"
                className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
              />
            </div>
          </label>

          <label className="text-sm font-semibold text-slate-800">
            Actor or target user UUID
            <input
              value={draftFilters.userId}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  userId: event.target.value,
                }))
              }
              placeholder="00000000-0000-0000-0000-000000000000"
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
            />
          </label>

          <label className="text-sm font-semibold text-slate-800">
            OAuth client ID
            <input
              value={draftFilters.clientId}
              onChange={(event) =>
                setDraftFilters((current) => ({
                  ...current,
                  clientId: event.target.value,
                }))
              }
              placeholder="migrateck-platform"
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-500/10"
            />
          </label>

          <div className="flex flex-wrap gap-2 lg:col-span-3">
            <button
              type="submit"
              className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              <Filter size={15} />
              Apply filters
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </form>
      </section>

      {error ? (
        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-rose-700" />
            <div>
              <h3 className="text-sm font-semibold text-rose-950">
                Audit evidence unavailable
              </h3>
              <p className="mt-1 text-sm leading-6 text-rose-800">{error}</p>
              <p className="mt-2 text-xs leading-5 text-rose-700">
                Global audit review requires MigraAuth platform.audit.read authority.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Matching events"
          value={total.toLocaleString()}
          detail={
            total
              ? "Exact count for the active server-side filters."
              : "No matching retained evidence."
          }
        />
        <StatCard
          label="High-risk sample"
          value={loadedRisk.high.toLocaleString()}
          detail={"Loaded page: " + loadedRisk.medium + " additional medium-risk events."}
        />
        <StatCard
          label="Newest evidence"
          value={
            evidenceWindow?.newest_at
              ? new Date(evidenceWindow.newest_at).toLocaleDateString()
              : "—"
          }
          detail={formatDate(evidenceWindow?.newest_at)}
        />
        <StatCard
          label="Observed evidence span"
          value={
            evidenceWindow?.oldest_at && evidenceWindow?.newest_at
              ? Math.max(
                  1,
                  Math.ceil(
                    (new Date(evidenceWindow.newest_at).getTime() -
                      new Date(evidenceWindow.oldest_at).getTime()) /
                      86_400_000,
                  ),
                ) + " days"
              : "—"
          }
          detail={
            evidenceWindow?.oldest_at
              ? "Oldest matching event: " + formatDate(evidenceWindow.oldest_at)
              : "No matching retained evidence."
          }
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1fr_0.34fr]">
        <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                Evidence stream
              </p>
              <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                Recorded platform events
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Page {currentPage} of {totalPages}. Each event preserves actor, target,
                client, network, and structured event evidence when supplied by MigraAuth.
              </p>
            </div>
          </div>

          {loading ? (
            <div className="grid min-h-72 place-items-center">
              <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
                <Loader2 size={18} className="animate-spin text-blue-600" />
                Loading audit authority…
              </div>
            </div>
          ) : entries.length === 0 ? (
            <div className="grid min-h-60 place-items-center p-8 text-center">
              <div>
                <BookOpenCheck
                  size={22}
                  className="mx-auto text-slate-400"
                />
                <h3 className="mt-3 text-sm font-semibold text-slate-900">
                  No matching audit evidence
                </h3>
                <p className="mt-2 text-sm text-slate-500">
                  Change the server-side filters or wait for a matching platform event.
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {entries.map((entry) => {
                const expanded = expandedId === entry.id;
                const risk = eventRisk(entry.event_type, entry.event_data);
                const category = eventCategory(entry.event_type);

                return (
                  <article key={entry.id} className="p-5 sm:p-6">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={
                                "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] " +
                                riskClass(risk)
                              }
                            >
                              {risk}
                            </span>
                            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                              {category}
                            </span>
                            <code className="break-all text-xs font-semibold text-slate-900">
                              {entry.event_type}
                            </code>
                          </div>
                          <p className="mt-2 text-xs text-slate-500">
                            {formatDate(entry.created_at)}
                          </p>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                          <button
                            onClick={() => void copyEvidence(entry)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {copiedId === entry.id ? (
                              <Check size={13} />
                            ) : (
                              <Clipboard size={13} />
                            )}
                            {copiedId === entry.id ? "Copied" : "Copy JSON"}
                          </button>
                          <button
                            onClick={() => setExpandedId(expanded ? null : entry.id)}
                            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                          >
                            {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            {expanded ? "Hide" : "Inspect"}
                          </button>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        <EvidenceField
                          label="Actor"
                          value={compactId(entry.actor_user_id)}
                          title={entry.actor_user_id ?? undefined}
                        />
                        <EvidenceField
                          label="Target"
                          value={compactId(entry.target_user_id)}
                          title={entry.target_user_id ?? undefined}
                        />
                        <EvidenceField
                          label="OAuth client"
                          value={entry.client_id ?? "—"}
                          title={entry.client_id ?? undefined}
                        />
                        <EvidenceField
                          label="Source IP"
                          value={entry.ip_address ?? "—"}
                          title={entry.ip_address ?? undefined}
                        />
                      </div>

                      {expanded ? (
                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-950 p-4">
                          <div className="grid gap-3 text-[11px] sm:grid-cols-2">
                            <div>
                              <p className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                                Actor type
                              </p>
                              <p className="mt-1 break-all text-slate-200">
                                {entry.actor_type ?? "—"}
                              </p>
                            </div>
                            <div>
                              <p className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                                User agent
                              </p>
                              <p className="mt-1 break-all text-slate-200">
                                {entry.user_agent ?? "—"}
                              </p>
                            </div>
                          </div>
                          <div>
                            <p className="font-semibold uppercase tracking-[0.12em] text-slate-500">
                              Event data
                            </p>
                            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-200">
                              {JSON.stringify(entry.event_data, null, 2)}
                            </pre>
                          </div>
                          <code className="block break-all text-[10px] text-slate-500">
                            Evidence ID: {entry.id}
                          </code>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-slate-100 p-5 sm:p-6">
            <button
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0 || loading}
              className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="text-xs font-medium text-slate-500">
              {total ? offset + 1 : 0}–{Math.min(offset + PAGE_SIZE, total)} of{" "}
              {total.toLocaleString()}
            </span>
            <button
              onClick={() => setOffset(offset + PAGE_SIZE)}
              disabled={offset + PAGE_SIZE >= total || loading}
              className="rounded-xl border border-slate-200 px-3.5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>

        <aside className="space-y-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Loaded-page classification
            </p>
            <div className="mt-4 space-y-2">
              {loadedCategories.length ? (
                loadedCategories.map(([category, count]) => (
                  <div
                    key={category}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"
                  >
                    <span className="text-xs font-semibold text-slate-700">
                      {category}
                    </span>
                    <span className="text-xs font-semibold text-slate-900">{count}</span>
                  </div>
                ))
              ) : (
                <p className="text-xs leading-5 text-slate-500">
                  No loaded evidence to classify.
                </p>
              )}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">
              Remediation handoff
            </p>
            <h3 className="mt-1 text-sm font-semibold text-slate-950">
              Act in the owning control plane
            </h3>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              Compliance preserves evidence. Identity containment and access correction stay
              in the systems that own those mutations.
            </p>

            <div className="mt-4 space-y-2">
              <HandoffLink
                href="/platform/trust"
                icon={<ShieldCheck size={15} />}
                title="Trust Operations"
                detail="Investigate users, revoke sessions, recover MFA, contain access."
              />
              <HandoffLink
                href="/platform/members"
                icon={<UserRoundCog size={15} />}
                title="Members & Access"
                detail="Correct organization roles and membership."
              />
              <HandoffLink
                href="/platform/security"
                icon={<KeyRound size={15} />}
                title="My Security"
                detail="Operator session, password, and MFA controls."
              />
            </div>
          </section>

          <section className="rounded-3xl border border-blue-200 bg-blue-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
              Export contract
            </p>
            <p className="mt-2 text-xs leading-5 text-blue-900">
              CSV export preserves the active server-side filters and is deliberately capped
              at 2,000 records per download. Spreadsheet-formula prefixes are neutralized
              before CSV generation.
            </p>
          </section>
        </aside>
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-400">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p>
    </article>
  );
}

function EvidenceField({
  label,
  value,
  title,
}: {
  label: string;
  value: string;
  title?: string | undefined;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        {label}
      </p>
      <code
        title={title}
        className="mt-1 block truncate text-[11px] font-semibold text-slate-700"
      >
        {value}
      </code>
    </div>
  );
}

function HandoffLink({
  href,
  icon,
  title,
  detail,
}: {
  href: string;
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <Link
      href={href}
      className="group flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 transition hover:border-blue-200 hover:bg-white"
    >
      <span className="mt-0.5 text-slate-500 group-hover:text-blue-600">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-slate-900">{title}</span>
        <span className="mt-1 block text-[11px] leading-5 text-slate-500">
          {detail}
        </span>
      </span>
      <ArrowRight size={13} className="mt-1 text-slate-300 group-hover:text-blue-600" />
    </Link>
  );
}
