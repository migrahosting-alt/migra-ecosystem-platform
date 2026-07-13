import type { ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import {
  AlertTriangle,
  BookOpen,
  Clock3,
  ExternalLink,
  Globe,
  LifeBuoy,
  Mail,
  MessageSquare,
  NotebookPen,
  Search,
  Send,
  Sparkles,
  Ticket,
  UserRound,
} from "lucide-react";

import { ConsolePageShell } from "../components/ConsolePageShell";
import { getSession } from "../lib/auth";
import { getPanelDbStatus } from "../lib/db";
import { describeAction, loadClientTimeline } from "../lib/modules/audit";
import { loadClientDetail } from "../lib/modules/clients";
import { loadClientContacts } from "../lib/modules/contacts";
import { loadClientNotes } from "../lib/modules/notes";
import { loadRecentOrdersForTenant } from "../lib/modules/orders";
import {
  loadSupportActor,
  loadSupportData,
  loadSupportReplyMacros,
  loadSupportTicketDetail,
  type SupportAgent,
  type SupportMessage,
  type SupportTicket,
} from "../lib/modules/support";
import { assignTicket, claimTicket, quickUpdateTicket, sendSupportReply } from "../lib/modules/support-actions";
import { addNote } from "../lib/modules/client-actions";
import { clientNewTicketPath, tenantPath } from "../lib/urls";
import { SupportAutoRefresh } from "./SupportAutoRefresh";
import { LiveConversation } from "./LiveConversation";

export const dynamic = "force-dynamic";

type SearchParams = {
  ticketId?: string;
  tenantId?: string;
  returnTo?: string;
  view?: string;
  tab?: string;
  panel?: string;
  q?: string;
  focus?: string;
};

type QueueView = "all" | "mine" | "unassigned" | "mentions" | "waiting_for_agent" | "waiting_on_customer" | "active" | "high_priority" | "sla_risk" | "resolved" | "ended";
type WorkspaceTab = "chat" | "details" | "history" | "files" | "notes" | "activity";
type WorkspacePanel = "inbox" | "knowledge" | "announcements";
type WorkspaceFocus = "queue" | "workspace" | "context";

const queueViews: QueueView[] = ["all", "mine", "unassigned", "mentions", "waiting_for_agent", "waiting_on_customer", "active", "high_priority", "sla_risk", "resolved", "ended"];
const workspaceTabs: WorkspaceTab[] = ["chat", "details", "history", "files", "notes", "activity"];
const workspacePanels: WorkspacePanel[] = ["inbox", "knowledge", "announcements"];
const workspaceFocuses: WorkspaceFocus[] = ["queue", "workspace", "context"];

const statusTone: Record<string, string> = {
  open: "bg-amber-500/15 text-amber-200 ring-1 ring-amber-400/20",
  new: "bg-sky-500/15 text-sky-200 ring-1 ring-sky-400/20",
  in_progress: "bg-violet-500/15 text-violet-100 ring-1 ring-violet-400/20",
  resolved: "bg-emerald-500/15 text-emerald-200 ring-1 ring-emerald-400/20",
  closed: "bg-slate-500/15 text-slate-300 ring-1 ring-slate-400/20",
};

const priorityTone: Record<string, string> = {
  low: "text-slate-300",
  normal: "text-sky-200",
  high: "text-amber-200",
  critical: "text-rose-200",
};

const ticketUrl = (args: {
  ticketId?: string | null | undefined;
  view?: QueueView | undefined;
  tab?: WorkspaceTab | undefined;
  panel?: WorkspacePanel | undefined;
  q?: string | undefined;
  tenantId?: string | null | undefined;
  returnTo?: string | null | undefined;
  focus?: WorkspaceFocus | undefined;
}) => {
  const params = new URLSearchParams();
  if (args.ticketId) params.set("ticketId", args.ticketId);
  if (args.view) params.set("view", args.view);
  if (args.tab) params.set("tab", args.tab);
  if (args.panel && args.panel !== "inbox") params.set("panel", args.panel);
  if (args.q) params.set("q", args.q);
  if (args.tenantId) params.set("tenantId", args.tenantId);
  if (args.returnTo) params.set("returnTo", args.returnTo);
  if (args.focus && args.focus !== "queue") params.set("focus", args.focus);
  const qs = params.toString();
  return `/console/support${qs ? `?${qs}` : ""}`;
};

const normalizeView = (value?: string): QueueView =>
  queueViews.includes((value || "") as QueueView) ? (value as QueueView) : "all";

const normalizeTab = (value?: string): WorkspaceTab =>
  workspaceTabs.includes((value || "") as WorkspaceTab) ? (value as WorkspaceTab) : "chat";

const normalizePanel = (value?: string): WorkspacePanel =>
  workspacePanels.includes((value || "") as WorkspacePanel) ? (value as WorkspacePanel) : "inbox";

const normalizeFocus = (value?: string): WorkspaceFocus =>
  workspaceFocuses.includes((value || "") as WorkspaceFocus) ? (value as WorkspaceFocus) : "queue";

const formatDateTime = (value?: string | null) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatTime = (value?: string | null) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value || 0);

const formatDuration = (minutes: number | null) => {
  if (minutes == null || Number.isNaN(minutes)) return "N/A";
  if (minutes < 60) return `${Math.max(0, Math.round(minutes))}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = Math.round(minutes % 60);
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
};

const minutesBetween = (start?: string | null, end?: string | null) => {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return (b - a) / 60000;
};

const slugHint = (value?: string | null) =>
  (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const extractLinks = (messages: SupportMessage[]) => {
  const links = new Map<string, { url: string; sender: string | null; createdAt: string | null }>();
  const urlRegex = /https?:\/\/[^\s)]+/gi;
  for (const message of messages) {
    const found = message.body.match(urlRegex) || [];
    for (const url of found) {
      if (!links.has(url)) {
        links.set(url, {
          url,
          sender: message.senderName,
          createdAt: message.createdAt,
        });
      }
    }
  }
  return Array.from(links.values());
};

const deriveMentionIds = (tickets: SupportTicket[], actor: { id: string; name: string } | null) => {
  if (!actor) return new Set<string>();
  const actorName = slugHint(actor.name);
  const actorEmail = slugHint(actor.id);
  return new Set(
    tickets
      .filter((ticket) =>
        ticket.tags.some((tag) => {
          const norm = slugHint(tag);
          return Boolean(norm) && (norm.includes(actorName) || (actorEmail && norm.includes(actorEmail)));
        }),
      )
      .map((ticket) => ticket.id),
  );
};

const filterTickets = ({
  tickets,
  actor,
  mentions,
  view,
  tenantId,
  query,
}: {
  tickets: SupportTicket[];
  actor: { id: string; name: string } | null;
  mentions: Set<string>;
  view: QueueView;
  tenantId?: string | undefined;
  query?: string | undefined;
}) => {
  const normalizedQuery = slugHint(query);
  return tickets.filter((ticket) => {
    if (tenantId && ticket.tenantId !== tenantId) return false;
    if (view === "mine" && (!actor || ticket.assigneeId !== actor.id)) return false;
    if (view === "unassigned" && ticket.assigneeId) return false;
    if (view === "mentions" && !mentions.has(ticket.id)) return false;
    if (view === "waiting_for_agent" && ticket.status !== "waiting_for_agent") return false;
    if (view === "waiting_on_customer" && ticket.status !== "waiting_on_customer") return false;
    if (view === "active" && !["active", "waiting_on_support"].includes(ticket.status)) return false;
    if (view === "high_priority" && !["high", "critical"].includes(ticket.priority || "")) return false;
    if (view === "sla_risk" && !ticket.slaBreached) return false;
    if (view === "resolved" && ticket.status !== "resolved") return false;
    if (view === "ended" && !["ended", "closed"].includes(ticket.status)) return false;

    if (!normalizedQuery) return true;
    const haystack = [
      ticket.ticketNumber,
      ticket.subject,
      ticket.customerName,
      ticket.customerEmail,
      ticket.tenantName,
      ticket.status,
      ticket.priority,
      ticket.department,
      ticket.assigneeName,
      ...ticket.tags,
    ]
      .map(slugHint)
      .join(" ");
    return haystack.includes(normalizedQuery);
  });
};

const computeSupportMetrics = (tickets: SupportTicket[], actor: { id: string; name: string } | null, mentions: Set<string>) => {
  const openTickets = tickets.filter((ticket) => !["closed", "resolved"].includes(ticket.status));
  const activeTickets = openTickets.filter((ticket) => ["open", "new", "in_progress"].includes(ticket.status));
  const unassignedTickets = openTickets.filter((ticket) => !ticket.assigneeId);
  const responseMinutes = tickets
    .map((ticket) => minutesBetween(ticket.createdAt, ticket.firstResponseAt))
    .filter((value): value is number => value != null);
  const avgResponse =
    responseMinutes.length > 0
      ? responseMinutes.reduce((sum, value) => sum + value, 0) / responseMinutes.length
      : null;
  const slaMeasured = tickets.filter((ticket) => ticket.slaDeadline || ticket.slaBreached);
  const slaHealthy =
    slaMeasured.length > 0
      ? Math.round(((slaMeasured.length - slaMeasured.filter((ticket) => ticket.slaBreached).length) / slaMeasured.length) * 100)
      : 100;
  return {
    totalChats: tickets.length,
    activeConversations: activeTickets.length,
    unassigned: unassignedTickets.length,
    openTickets: openTickets.length,
    avgResponse,
    slaHealthy,
    mine: actor ? tickets.filter((ticket) => ticket.assigneeId === actor.id).length : 0,
    mentions: mentions.size,
    slaRisk: openTickets.filter((ticket) => ticket.slaBreached).length,
  };
};

const summarizeQueueAlerts = (tickets: SupportTicket[], agents: SupportAgent[]) => {
  const openTickets = tickets.filter((ticket) => !["closed", "resolved"].includes(ticket.status));
  const urgent = openTickets.filter((ticket) => ["critical", "high"].includes(ticket.priority || ""));
  const firstResponsePending = openTickets.filter((ticket) => !ticket.firstResponseAt);
  const availableAgents = agents.filter((agent) => agent.status === "available");
  return [
    {
      title: "Urgent now",
      value: urgent.length,
      body:
        urgent.length > 0
          ? `${urgent.length} high-priority ${urgent.length === 1 ? "ticket is" : "tickets are"} waiting in the queue.`
          : "No critical or high-priority tickets are waiting.",
    },
    {
      title: "Unassigned",
      value: openTickets.filter((ticket) => !ticket.assigneeId).length,
      body:
        openTickets.filter((ticket) => !ticket.assigneeId).length > 0
          ? "These tickets still need an owner before the next reply."
          : "All open tickets already have an owner.",
    },
    {
      title: "Awaiting first response",
      value: firstResponsePending.length,
      body:
        firstResponsePending.length > 0
          ? "These conversations have not received a first operator reply yet."
          : "Every open ticket has already received a first response.",
    },
    {
      title: "Support agents",
      value: availableAgents.length,
      body:
        availableAgents.length > 0
          ? `${availableAgents.length} agent${availableAgents.length === 1 ? " is" : "s are"} marked available right now.`
          : "No agents are currently marked available.",
    },
  ];
};

const deriveSuggestions = (ticket: SupportTicket | null, hasTenantContext: boolean, notesCount: number) => {
  if (!ticket) return [];
  const suggestions: string[] = [];
  if (!ticket.assigneeId) suggestions.push("Claim or assign this ticket before the next customer reply.");
  if (!ticket.firstResponseAt) suggestions.push("Send the first reply to start the response history for this case.");
  if (!hasTenantContext) suggestions.push("Link this ticket to a client record so billing and service context appear here.");
  if ((ticket.priority || "") === "critical") suggestions.push("Escalate to a live operator and keep the conversation owned until resolution.");
  if (notesCount === 0) suggestions.push("Add an internal note once triage is complete so the next operator has context.");
  return suggestions;
};

function MetricCard({
  icon,
  label,
  value,
  helper,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-3xl border border-white/8 bg-[#0f1323] p-5 shadow-[0_16px_50px_rgba(5,8,20,0.35)]">
      <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-white/6 text-fuchsia-200">
        {icon}
      </div>
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 text-4xl font-semibold text-white">{value}</p>
      <p className="mt-2 text-sm text-slate-400">{helper}</p>
    </div>
  );
}

function QueuePill({
  href,
  active,
  label,
  count,
}: {
  href: string;
  active: boolean;
  label: string;
  count: number;
}) {
  return (
    <Link
      href={href}
      className={[
        "rounded-full px-4 py-2 text-sm font-medium transition",
        active
          ? "bg-gradient-to-r from-violet-500/25 to-fuchsia-500/25 text-white ring-1 ring-fuchsia-400/30"
          : "bg-white/[0.04] text-slate-300 ring-1 ring-white/8 hover:bg-white/[0.08]",
      ].join(" ")}
    >
      {label} ({count})
    </Link>
  );
}

function FocusPill({
  href,
  active,
  disabled,
  label,
}: {
  href: string;
  active: boolean;
  disabled?: boolean | undefined;
  label: string;
}) {
  const className = [
    "inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-medium transition",
    disabled
      ? "pointer-events-none bg-white/[0.03] text-slate-500 ring-1 ring-white/6"
      : active
        ? "bg-gradient-to-r from-violet-500/25 to-fuchsia-500/25 text-white ring-1 ring-fuchsia-400/30"
        : "bg-white/[0.04] text-slate-300 ring-1 ring-white/8 hover:bg-white/[0.08]",
  ].join(" ");

  return disabled ? (
    <span className={`${className} flex-1`}>{label}</span>
  ) : (
    <Link href={href} className={`${className} flex-1`}>
      {label}
    </Link>
  );
}

export default async function SupportPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) redirect("/console/login");

  const params = await searchParams;
  const tenantId = params.tenantId?.trim() || undefined;
  const returnTo = params.returnTo?.trim() || undefined;
  const view = normalizeView(params.view);
  const tab = normalizeTab(params.tab);
  const panel = normalizePanel(params.panel);
  const requestedFocus = normalizeFocus(params.focus);
  const q = (params.q || "").trim();

  const [panelDbStatus, supportData, actor, macros] = await Promise.all([
    getPanelDbStatus(),
    loadSupportData(tenantId ? { tenantId } : {}),
    loadSupportActor(session.email),
    loadSupportReplyMacros(8),
  ]);

  const mentionIds = deriveMentionIds(supportData.tickets, actor);
  const filteredTickets = filterTickets({
    tickets: supportData.tickets,
    actor,
    mentions: mentionIds,
    view,
    tenantId,
    query: q,
  });
  const selectedTicket =
    filteredTickets.find((ticket) => ticket.id === params.ticketId) ||
    (params.ticketId ? supportData.tickets.find((ticket) => ticket.id === params.ticketId) : null) ||
    null;

  const [selectedDetail, selectedClient, contacts, notes, orders, timeline] = selectedTicket
    ? await Promise.all([
        loadSupportTicketDetail(selectedTicket.id),
        selectedTicket.tenantId ? loadClientDetail(selectedTicket.tenantId) : Promise.resolve(null),
        selectedTicket.tenantId ? loadClientContacts(selectedTicket.tenantId) : Promise.resolve([]),
        selectedTicket.tenantId ? loadClientNotes(selectedTicket.tenantId) : Promise.resolve([]),
        selectedTicket.tenantId ? loadRecentOrdersForTenant(selectedTicket.tenantId, 6) : Promise.resolve([]),
        selectedTicket.tenantId ? loadClientTimeline(selectedTicket.tenantId, 12) : Promise.resolve([]),
      ])
    : [null, null, [], [], [], []];

  const metrics = computeSupportMetrics(supportData.tickets, actor, mentionIds);
  const queueAlerts = summarizeQueueAlerts(supportData.tickets, supportData.agents);
  const fileLinks = selectedDetail ? extractLinks(selectedDetail.messages) : [];
  const suggestions = deriveSuggestions(selectedTicket, Boolean(selectedClient), notes.length);
  const focus: WorkspaceFocus = requestedFocus === "context" && !selectedTicket ? "queue" : requestedFocus;

  const queueCounts = {
    all: supportData.tickets.length,
    mine: actor ? supportData.tickets.filter((ticket) => ticket.assigneeId === actor.id).length : 0,
    unassigned: supportData.tickets.filter((ticket) => !ticket.assigneeId).length,
    mentions: mentionIds.size,
    waiting_for_agent: supportData.tickets.filter((ticket) => ticket.status === "waiting_for_agent").length,
    waiting_on_customer: supportData.tickets.filter((ticket) => ticket.status === "waiting_on_customer").length,
    active: supportData.tickets.filter((ticket) => ["active", "waiting_on_support"].includes(ticket.status)).length,
    high_priority: supportData.tickets.filter((ticket) => ["high", "critical"].includes(ticket.priority || "")).length,
    sla_risk: supportData.tickets.filter((ticket) => ticket.slaBreached).length,
    resolved: supportData.tickets.filter((ticket) => ticket.status === "resolved").length,
    ended: supportData.tickets.filter((ticket) => ["ended", "closed"].includes(ticket.status)).length,
  };

  const pageTitle =
    panel === "knowledge"
      ? "Support Knowledge"
      : panel === "announcements"
        ? "Support Announcements"
        : "Support";

  return (
    <ConsolePageShell
      session={session}
      activePath="/console/support"
      title={pageTitle}
      subtitle="Live support operations, queue routing, and customer context."
      showPageHeader={false}
      viewportLocked
      mainClassName="flex min-h-0 flex-1 flex-col overflow-hidden p-3 lg:p-4"
    >
      <SupportAutoRefresh enabled={!selectedTicket} />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
        <div className="shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">Support workspace</p>
              <p className={[
                "mt-1 truncate text-xs text-slate-400 [@media(max-height:820px)]:hidden",
                focus !== "queue" ? "hidden xl:block" : "",
              ].join(" ")}>Queue routing, live conversation handling, and customer context.</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Link
                href={ticketUrl({ panel: "knowledge", view, tab, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                className={[
                  "rounded-full px-3 py-1.5 text-[11px] font-medium transition lg:text-xs",
                  panel === "knowledge"
                    ? "bg-fuchsia-500/15 text-fuchsia-100 ring-1 ring-fuchsia-400/25"
                    : "bg-white/[0.04] text-slate-300 ring-1 ring-white/8 hover:bg-white/[0.08]",
                ].join(" ")}
              >
                Knowledge Base
              </Link>
              <Link
                href={ticketUrl({ panel: "announcements", view, tab, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                className={[
                  "rounded-full px-3 py-1.5 text-[11px] font-medium transition lg:text-xs",
                  panel === "announcements"
                    ? "bg-fuchsia-500/15 text-fuchsia-100 ring-1 ring-fuchsia-400/25"
                    : "bg-white/[0.04] text-slate-300 ring-1 ring-white/8 hover:bg-white/[0.08]",
                ].join(" ")}
              >
                Announcements
              </Link>
              <Link
                href={ticketUrl({ panel: "inbox", view, tab, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                className={[
                  "rounded-full px-3 py-1.5 text-[11px] font-medium transition lg:text-xs",
                  panel === "inbox"
                    ? "bg-fuchsia-500/15 text-fuchsia-100 ring-1 ring-fuchsia-400/25"
                    : "bg-white/[0.04] text-slate-300 ring-1 ring-white/8 hover:bg-white/[0.08]",
                ].join(" ")}
              >
                Live Inbox
              </Link>
            </div>
          </div>
        </div>

        {!panelDbStatus.connected ? (
          <section className="shrink-0 rounded-[28px] border border-amber-400/25 bg-[linear-gradient(135deg,rgba(120,68,14,0.18),rgba(44,27,12,0.42))] p-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-200">
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-white">Panel database connection is failing</h2>
                <p className="mt-2 text-sm leading-6 text-slate-200">
                  The support workspace is currently falling back to empty results because the production panel DB is not authenticating.
                  The current error is: <span className="font-medium text-amber-200">{panelDbStatus.error || "Unknown database error"}</span>.
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Until the DB credential is corrected, queue counts, customer context, recent orders, notes, and SLA metrics on this screen are not trustworthy.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        <div
          className={[
            "grid shrink-0 gap-2 md:grid-cols-3 xl:grid-cols-6",
            focus !== "queue" ? "hidden xl:grid" : "",
          ].join(" ")}
        >
          <CompactMetric icon={<MessageSquare className="h-4 w-4" />} label="Chats" value={metrics.totalChats} helper={metrics.totalChats > 0 ? "Live queue" : "No live chats"} />
          <CompactMetric icon={<Sparkles className="h-4 w-4" />} label="Active" value={metrics.activeConversations} helper={metrics.activeConversations > 0 ? "In workflow" : "Queue ready"} />
          <CompactMetric icon={<UserRound className="h-4 w-4" />} label="Unassigned" value={metrics.unassigned} helper={metrics.unassigned > 0 ? "Need owner" : "All owned"} />
          <CompactMetric icon={<Ticket className="h-4 w-4" />} label="Tickets" value={metrics.openTickets} helper={metrics.openTickets > 0 ? "Open cases" : "None open"} />
          <CompactMetric icon={<Clock3 className="h-4 w-4" />} label="Avg. Response" value={formatDuration(metrics.avgResponse)} helper={metrics.avgResponse != null ? "First reply" : "No data yet"} />
          <CompactMetric icon={<LifeBuoy className="h-4 w-4" />} label="SLA" value={`${metrics.slaHealthy}%`} helper={metrics.slaRisk > 0 ? `${metrics.slaRisk} at risk` : "Healthy"} />
        </div>

        {panel === "inbox" ? (
          <div className="flex shrink-0 gap-2 xl:hidden">
            <FocusPill
              href={ticketUrl({ ticketId: selectedTicket?.id, view, tab, panel, q, tenantId, returnTo, focus: "queue" })}
              active={focus === "queue"}
              label="Queue"
            />
            <FocusPill
              href={ticketUrl({ ticketId: selectedTicket?.id, view, tab, panel, q, tenantId, returnTo, focus: "workspace" })}
              active={focus === "workspace"}
              label="Workspace"
            />
            <FocusPill
              href={ticketUrl({ ticketId: selectedTicket?.id, view, tab, panel, q, tenantId, returnTo, focus: "context" })}
              active={focus === "context"}
              disabled={!selectedTicket}
              label="Context"
            />
          </div>
        ) : null}

        {panel === "announcements" ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-5 xl:grid-cols-[1.4fr_1fr]">
            <section className="rounded-[28px] border border-fuchsia-400/20 bg-[linear-gradient(135deg,rgba(62,26,100,0.95),rgba(38,18,68,0.96))] p-6 shadow-[0_20px_80px_rgba(25,10,50,0.45)]">
              <div className="flex items-start justify-between gap-4">
                <div className="max-w-3xl">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-fuchsia-100">
                    <Sparkles className="h-3.5 w-3.5" />
                    Abigail Active In Support
                  </div>
                  <h2 className="mt-5 text-4xl font-semibold tracking-tight text-white">
                    Real-time queue status, operator coverage, and SLA risk in one place.
                  </h2>
                  <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
                    These announcements are generated from the live support queue and agent roster. Nothing here is decorative:
                    each card below reflects the current ticket and operator data in the panel database.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-3 text-sm">
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1.5 text-emerald-200 ring-1 ring-emerald-400/20">
                      {supportData.agents.filter((agent) => agent.status === "available").length} agents available
                    </span>
                    <span className="rounded-full bg-sky-500/15 px-3 py-1.5 text-sky-200 ring-1 ring-sky-400/20">
                      {metrics.openTickets} open tickets
                    </span>
                    <span className="rounded-full bg-amber-500/15 px-3 py-1.5 text-amber-200 ring-1 ring-amber-400/20">
                      {metrics.slaRisk} SLA risk
                    </span>
                  </div>
                </div>
                <div className="w-full max-w-sm rounded-[26px] border border-white/10 bg-white/6 p-5">
                  <h3 className="text-2xl font-semibold text-white">Announcements Feed</h3>
                  <div className="mt-4 space-y-3">
                    {queueAlerts.map((alert) => (
                      <div key={alert.title} className="rounded-2xl border border-white/8 bg-slate-950/35 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-white">{alert.title}</p>
                          <span className="text-lg font-semibold text-fuchsia-200">{alert.value}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{alert.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </section>

            <div className="space-y-4">
              {queueAlerts.map((alert) => (
                <section key={alert.title} className="rounded-3xl border border-white/8 bg-[#101525] p-5">
                  <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{alert.title}</p>
                  <p className="mt-3 text-4xl font-semibold text-white">{alert.value}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">{alert.body}</p>
                </section>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {panel === "knowledge" ? (
          <div className="min-h-0 flex-1 overflow-y-auto pr-1">
            <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
            <section className="rounded-[28px] border border-white/8 bg-[#0f1323] p-6">
              <div className="flex items-center gap-3">
                <div className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-500/15 text-violet-200">
                  <BookOpen className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-2xl font-semibold text-white">Live Reply Library</h2>
                  <p className="text-sm text-slate-400">Built from recent operator replies in the ticket history.</p>
                </div>
              </div>
              <div className="mt-6 space-y-4">
                {macros.length > 0 ? (
                  macros.map((macro) => (
                    <div key={macro.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-sm leading-6 text-slate-100">{macro.body}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-400">
                        <span>Used {macro.usageCount} time{macro.usageCount === 1 ? "" : "s"}</span>
                        <span>Last used {formatDateTime(macro.lastUsedAt)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-sm text-slate-400">
                    No past operator replies are available yet, so there are no reusable response patterns to show.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-[28px] border border-white/8 bg-[#0f1323] p-6">
              <h2 className="text-2xl font-semibold text-white">Operational Signals</h2>
              <p className="mt-1 text-sm text-slate-400">Real ticket distribution across the current support queue.</p>
              <div className="mt-6 space-y-3">
                {[
                  { label: "Billing queue", value: supportData.tickets.filter((ticket) => ticket.department === "Billing").length },
                  { label: "Hosting queue", value: supportData.tickets.filter((ticket) => ticket.department === "Hosting").length },
                  { label: "Email queue", value: supportData.tickets.filter((ticket) => ticket.department === "Email").length },
                  { label: "Critical priority", value: supportData.tickets.filter((ticket) => ticket.priority === "critical").length },
                  { label: "Awaiting assignment", value: metrics.unassigned },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <span className="text-sm text-slate-300">{item.label}</span>
                    <span className="text-sm font-semibold text-white">{item.value}</span>
                  </div>
                ))}
              </div>
            </section>
            </div>
          </div>
        ) : null}

        {panel === "inbox" ? (
          <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_280px]">
            <section
              className={[
                "flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/8 bg-[#0f1323] p-4 [@media(max-height:820px)]:p-3.5",
                focus !== "queue" ? "hidden xl:flex" : "",
              ].join(" ")}
            >
              <div className="shrink-0 space-y-2 border-b border-white/6 pb-4">
                <h2 className="text-[1.55rem] font-semibold tracking-tight text-white">Abigail Chat Center</h2>
                <p className="text-sm leading-5 text-slate-400 [@media(max-height:820px)]:hidden">Live conversations across all websites and client portals.</p>
              </div>

              <div className="mt-4 shrink-0 overflow-x-auto pb-1">
                <div className="flex min-w-max gap-2">
                <QueuePill
                  href={ticketUrl({ view: "all", tab, panel, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                  active={view === "all"}
                  label="All"
                  count={queueCounts.all}
                />
                <QueuePill
                  href={ticketUrl({ view: "mine", tab, panel, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                  active={view === "mine"}
                  label="My"
                  count={queueCounts.mine}
                />
                <QueuePill
                  href={ticketUrl({ view: "unassigned", tab, panel, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                  active={view === "unassigned"}
                  label="Unassigned"
                  count={queueCounts.unassigned}
                />
                <QueuePill
                  href={ticketUrl({ view: "mentions", tab, panel, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                  active={view === "mentions"}
                  label="Mentions"
                  count={queueCounts.mentions}
                />
                {([
                  ["waiting_for_agent", "Waiting", queueCounts.waiting_for_agent],
                  ["waiting_on_customer", "Customer", queueCounts.waiting_on_customer],
                  ["active", "Active", queueCounts.active],
                  ["high_priority", "High", queueCounts.high_priority],
                  ["sla_risk", "SLA risk", queueCounts.sla_risk],
                  ["resolved", "Resolved", queueCounts.resolved],
                  ["ended", "Ended", queueCounts.ended],
                ] as const).map(([entryView, label, count]) => <QueuePill key={entryView} href={ticketUrl({ view: entryView, tab, panel, q, tenantId, returnTo, ticketId: selectedTicket?.id })} active={view === entryView} label={label} count={count} />)}
                </div>
              </div>

              <form className="mt-4 shrink-0">
                <input type="hidden" name="view" value={view} />
                <input type="hidden" name="tab" value={tab} />
                <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <Search className="h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    name="q"
                    defaultValue={q}
                    placeholder="Search conversations..."
                    className="w-full bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                  />
                </div>
              </form>

              <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                <div className="space-y-3">
                {filteredTickets.length > 0 ? (
                  filteredTickets.map((ticket) => {
                    const active = selectedTicket?.id === ticket.id;
                    return (
                      <Link
                        key={ticket.id}
                        href={ticketUrl({
                          ticketId: ticket.id,
                          view,
                          tab,
                          panel,
                          q,
                          tenantId,
                          returnTo,
                          focus: "workspace",
                        })}
                        className={[
                          "block rounded-3xl border p-4 transition",
                          active
                            ? "border-fuchsia-400/35 bg-[linear-gradient(135deg,rgba(92,38,158,0.28),rgba(32,20,54,0.92))] shadow-[0_10px_30px_rgba(102,51,153,0.22)]"
                            : "border-white/8 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]",
                        ].join(" ")}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-semibold text-white">
                                {ticket.customerName || ticket.tenantName || ticket.customerEmail || "Unnamed contact"}
                              </p>
                              {ticket.tags.includes("vip") ? (
                                <span className="rounded-full bg-fuchsia-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fuchsia-100">
                                  VIP
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 truncate text-sm text-slate-300">{ticket.subject || "No subject"}</p>
                            <p className="mt-1 truncate text-xs text-slate-500">
                              {ticket.tenantName || ticket.customerEmail || ticket.ticketNumber || "Unlinked ticket"}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs text-slate-400">{formatTime(ticket.lastMessageAt || ticket.updatedAt)}</p>
                            {ticket.slaBreached ? (
                              <p className="mt-1 text-xs font-medium text-rose-300">SLA risk</p>
                            ) : null}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                          <span className={`rounded-full px-2.5 py-1 ${statusTone[ticket.status] || "bg-white/8 text-slate-300"}`}>
                            {ticket.status.replaceAll("_", " ")}
                          </span>
                          {ticket.priority ? (
                            <span className={`rounded-full bg-white/[0.05] px-2.5 py-1 ${priorityTone[ticket.priority] || "text-slate-300"}`}>
                              {ticket.priority}
                            </span>
                          ) : null}
                          <span className="rounded-full bg-white/[0.05] px-2.5 py-1 text-slate-400">
                            {ticket.messageCount} message{ticket.messageCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      </Link>
                    );
                  })
                ) : (
                  <div className="rounded-3xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
                    <p className="text-lg font-medium text-white">Inbox clear</p>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      No conversations match the current queue filter and search.
                    </p>
                    <div className="mt-4 flex justify-center gap-3">
                      <Link
                        href={tenantId ? clientNewTicketPath(tenantId) : "/console/support/new"}
                        className="rounded-full bg-fuchsia-500/15 px-4 py-2 text-sm font-medium text-fuchsia-100 ring-1 ring-fuchsia-400/25"
                      >
                        Create Ticket
                      </Link>
                      <Link
                        href={ticketUrl({ view: "all", tab, panel, tenantId, returnTo })}
                        className="rounded-full bg-white/[0.04] px-4 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/8"
                      >
                        Clear Filters
                      </Link>
                    </div>
                  </div>
                )}
                </div>
              </div>

              <div className="mt-4 shrink-0 border-t border-white/6 pt-4 [@media(max-height:820px)]:hidden">
                <div className="grid grid-cols-2 gap-3">
                <Link
                  href={ticketUrl({ panel: "knowledge", view, tab, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-200 transition hover:bg-white/[0.06]"
                >
                  Knowledge Base
                </Link>
                <Link
                  href={ticketUrl({ panel: "announcements", view, tab, q, tenantId, returnTo, ticketId: selectedTicket?.id })}
                  className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-200 transition hover:bg-white/[0.06]"
                >
                  Announcements
                </Link>
                </div>
                <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
                  <span>{queueCounts.unassigned} unassigned</span>
                  <span>{queueCounts.waiting_for_agent} waiting</span>
                  <span>{metrics.slaRisk} SLA risk</span>
                </div>
              </div>
            </section>

            <section
              className={[
                "flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/8 bg-[#0f1323] p-4 [@media(max-height:820px)]:p-3.5",
                focus !== "workspace" ? "hidden xl:flex" : "",
              ].join(" ")}
            >
              <div className="flex shrink-0 items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 text-base font-semibold text-white">
                      {selectedTicket?.customerName?.slice(0, 1).toUpperCase() || selectedTicket?.tenantName?.slice(0, 1).toUpperCase() || "A"}
                    </div>
                    <div className="min-w-0">
                      <h2 className="line-clamp-2 max-w-[min(100%,42rem)] text-xl font-semibold tracking-tight text-white lg:text-[1.7rem] [@media(max-height:820px)]:line-clamp-1">
                        {selectedTicket?.customerName || selectedTicket?.tenantName || "Abigail Workspace"}
                      </h2>
                      <p className="truncate text-sm text-slate-400">
                        {selectedTicket
                          ? `${selectedTicket.customerEmail || "No customer email"} • ${selectedTicket.department || "Support"}`
                          : "Open a conversation to start routing with Abigail."}
                      </p>
                    </div>
                  </div>
                </div>
                {selectedTicket ? (
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={ticketUrl({ ticketId: selectedTicket.id, view, tab, panel, q, tenantId, returnTo, focus: "context" })}
                      className="rounded-full bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/8 transition hover:bg-white/[0.08] xl:hidden"
                    >
                      Context
                    </Link>
                    <Link
                      href={`/console/support/${selectedTicket.id}/edit`}
                      className="rounded-full bg-white/[0.04] px-3.5 py-2 text-sm font-medium text-slate-200 ring-1 ring-white/8 transition hover:bg-white/[0.08]"
                    >
                      Edit Ticket
                    </Link>
                    {selectedClient ? (
                      <Link
                        href={tenantPath(selectedClient.id)}
                        className="rounded-full bg-fuchsia-500/15 px-3.5 py-2 text-sm font-medium text-fuchsia-100 ring-1 ring-fuchsia-400/25"
                      >
                        Open Client
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-3 shrink-0 flex flex-wrap gap-4 border-b border-white/6">
                {workspaceTabs.map((entry) => (
                  <Link
                    key={entry}
                    href={ticketUrl({
                      ticketId: selectedTicket?.id,
                      view,
                      tab: entry,
                      panel,
                      q,
                      tenantId,
                      returnTo,
                      focus: "workspace",
                    })}
                    className={[
                      "border-b-2 pb-2.5 text-sm font-medium capitalize transition",
                      tab === entry ? "border-fuchsia-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300",
                    ].join(" ")}
                  >
                    {entry}
                  </Link>
                ))}
              </div>

              <details className="mt-2 hidden shrink-0 rounded-2xl border border-white/8 bg-white/[0.02] xl:block 2xl:hidden [@media(max-height:820px)]:hidden">
                <summary className="cursor-pointer list-none px-4 py-2.5 text-sm font-medium text-slate-200">
                  Customer context and support tools
                </summary>
                <div className="max-h-[28rem] overflow-y-auto border-t border-white/6 px-4 py-4">
                  <ContextRailContent
                    selectedClient={selectedClient}
                    selectedTicket={selectedTicket}
                    contacts={contacts}
                    orders={orders}
                    suggestions={suggestions}
                    tenantId={tenantId}
                    view={view}
                    tab={tab}
                    q={q}
                    returnTo={returnTo}
                  />
                </div>
              </details>

              <div className="mt-4 min-h-0 flex-1 overflow-hidden">
                {!selectedTicket || !selectedDetail ? (
                  <div className="flex h-full min-h-0 flex-col overflow-y-auto pr-1">
                    <NoSelectionState
                      metrics={metrics}
                      queueAlerts={queueAlerts}
                      actor={actor}
                      filteredCount={filteredTickets.length}
                      currentView={view}
                    />
                  </div>
                ) : null}

                {selectedTicket && selectedDetail && tab === "chat" ? (
                  <div className="h-full min-h-0">
                    <LiveConversation ticketId={selectedTicket.id} initialMessages={selectedDetail.messages} agents={selectedDetail.agents} />
                  </div>
                ) : null}

                {selectedTicket && selectedDetail && tab === "details" ? (
                  <div className="h-full overflow-y-auto pr-1">
                    <div className="grid gap-5 lg:grid-cols-2">
                    <div className="space-y-4">
                      <DetailCard title="Ticket Details">
                        <DetailRow label="Ticket number" value={selectedTicket.ticketNumber || selectedTicket.id} />
                        <DetailRow label="Status" value={selectedTicket.status.replaceAll("_", " ")} />
                        <DetailRow label="Priority" value={selectedTicket.priority || "normal"} />
                        <DetailRow label="Department" value={selectedTicket.department || "Support"} />
                        <DetailRow label="Assigned to" value={selectedTicket.assigneeName || "Unassigned"} />
                        <DetailRow label="Created" value={formatDateTime(selectedTicket.createdAt)} />
                        <DetailRow label="First response" value={selectedTicket.firstResponseAt ? formatDateTime(selectedTicket.firstResponseAt) : "Not replied yet"} />
                      </DetailCard>

                      <DetailCard title="Contacts">
                        {contacts.length > 0 ? (
                          contacts.map((contact) => (
                            <div key={contact.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                              <p className="text-sm font-semibold text-white">
                                {contact.name || contact.email || "Unnamed contact"}
                              </p>
                              <p className="mt-1 text-sm text-slate-400">
                                {contact.role}
                                {contact.title ? ` • ${contact.title}` : ""}
                              </p>
                              <div className="mt-2 space-y-1 text-sm text-slate-300">
                                {contact.email ? <p>{contact.email}</p> : null}
                                {contact.phone ? <p>{contact.phone}</p> : null}
                              </div>
                            </div>
                          ))
                        ) : (
                          <EmptyCopy body="No client contacts are stored for this tenant yet." />
                        )}
                      </DetailCard>
                    </div>

                    <div className="space-y-4">
                      <DetailCard title="Account Context">
                        {selectedClient ? (
                          <>
                            <DetailRow label="Client" value={selectedClient.name} />
                            <DetailRow label="Status" value={selectedClient.status} />
                            <DetailRow label="Tenant type" value={selectedClient.tenantType} />
                            <DetailRow label="Domains" value={String(selectedClient.domains.length)} />
                            <DetailRow label="Subscriptions" value={String(selectedClient.subscriptions.length)} />
                            <DetailRow label="Mailboxes" value={String(selectedClient.mailboxes.length)} />
                            <DetailRow label="Websites" value={String(selectedClient.websites.length)} />
                          </>
                        ) : (
                          <EmptyCopy body="This ticket is not linked to a client tenant yet, so account context is unavailable." />
                        )}
                      </DetailCard>

                      <DetailCard title="Recent Orders">
                        {orders.length > 0 ? (
                          orders.map((order) => (
                            <div key={order.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                              <div>
                                <p className="text-sm font-semibold text-white">{order.id}</p>
                                <p className="text-xs text-slate-400">{formatDateTime(order.createdAt)}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-sm font-semibold text-white">{formatCurrency(order.total)}</p>
                                <p className="text-xs text-slate-400">{order.status}</p>
                              </div>
                            </div>
                          ))
                        ) : (
                          <EmptyCopy body="No recent orders were found for this tenant." />
                        )}
                      </DetailCard>
                    </div>
                    </div>
                  </div>
                ) : null}

                {selectedTicket && selectedDetail && tab === "history" ? (
                  <div className="h-full overflow-y-auto pr-1">
                    <div className="space-y-4">
                    {[
                      { label: "Ticket opened", value: selectedTicket.createdAt, body: selectedTicket.subject || "Ticket created." },
                      { label: "First operator reply", value: selectedTicket.firstResponseAt, body: selectedTicket.firstResponseAt ? "First reply recorded." : "No first reply has been recorded yet." },
                      { label: "Last message", value: selectedTicket.lastMessageAt || selectedTicket.updatedAt, body: `${selectedTicket.messageCount} total message${selectedTicket.messageCount === 1 ? "" : "s"} in this conversation.` },
                      { label: "SLA deadline", value: selectedTicket.slaDeadline, body: selectedTicket.slaDeadline ? (selectedTicket.slaBreached ? "This case has crossed its SLA deadline." : "This case still has SLA time remaining.") : "No SLA deadline is stored for this ticket." },
                    ].map((entry) => (
                      <div key={entry.label} className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                        <div className="flex items-center justify-between gap-4">
                          <p className="text-base font-semibold text-white">{entry.label}</p>
                          <span className="text-sm text-slate-400">{entry.value ? formatDateTime(entry.value) : "Not available"}</span>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-slate-300">{entry.body}</p>
                      </div>
                    ))}
                    </div>
                  </div>
                ) : null}

                {selectedTicket && selectedDetail && tab === "files" ? (
                  <div className="h-full overflow-y-auto pr-1">
                    <div className="space-y-3">
                    <div className="rounded-3xl border border-sky-400/15 bg-sky-500/5 px-5 py-4 text-sm leading-6 text-slate-300">
                      The Files tab currently surfaces links already shared in ticket messages. A dedicated support upload pipeline is not connected yet,
                      so operators cannot upload attachments from this workspace today.
                    </div>
                    {fileLinks.length > 0 ? (
                      fileLinks.map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between rounded-3xl border border-white/8 bg-white/[0.03] px-5 py-4 transition hover:bg-white/[0.05]"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-white">{link.url}</p>
                            <p className="mt-1 text-xs text-slate-400">
                              Shared by {link.sender || "Unknown"} • {formatDateTime(link.createdAt)}
                            </p>
                          </div>
                          <ExternalLink className="ml-4 h-4 w-4 shrink-0 text-slate-400" />
                        </a>
                      ))
                    ) : (
                      <EmptyCopy body="No links or file references were found in this ticket's message history." />
                    )}
                    </div>
                  </div>
                ) : null}

                {selectedTicket && selectedDetail && tab === "notes" ? (
                  <div className="h-full overflow-y-auto pr-1">
                    <div className="space-y-4">
                    {selectedTicket.tenantId ? (
                      <form action={addNote} className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                        <input type="hidden" name="tenantId" value={selectedTicket.tenantId} />
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <h3 className="text-base font-semibold text-white">Add internal client note</h3>
                            <p className="mt-1 text-sm text-slate-400">Notes save to the shared client record and appear on the client workspace too.</p>
                          </div>
                          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                            <input type="checkbox" name="pinned" className="rounded border-white/10 bg-white/5" />
                            Pin note
                          </label>
                        </div>
                        <textarea
                          name="body"
                          rows={3}
                          placeholder="Add triage context, billing notes, or handoff details..."
                          className="mt-4 w-full resize-y rounded-2xl border border-white/10 bg-slate-950/30 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-500"
                        />
                        <div className="mt-4 flex justify-end">
                          <button
                            type="submit"
                            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-semibold text-white"
                          >
                            Save Note
                          </button>
                        </div>
                      </form>
                    ) : null}
                    {notes.length > 0 ? (
                      notes.map((note) => (
                        <div key={note.id} className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">{note.authorEmail || "Console"}</p>
                            <span className="text-xs text-slate-500">{formatDateTime(note.createdAt)}</span>
                          </div>
                          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-300">{note.body}</p>
                          {note.pinned ? (
                            <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-fuchsia-200">Pinned note</p>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <EmptyCopy body="No internal client notes are stored for this tenant yet." />
                    )}
                    </div>
                  </div>
                ) : null}

                {selectedTicket && selectedDetail && tab === "activity" ? (
                  <div className="h-full overflow-y-auto pr-1">
                    <div className="space-y-4">
                    {selectedDetail.audit.map((event) => (
                      <div key={event.id} className="rounded-3xl border border-fuchsia-400/15 bg-fuchsia-500/5 p-5">
                        <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold capitalize text-white">{event.eventType.replaceAll("_", " ")}</p><span className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</span></div>
                        <p className="mt-2 text-sm text-slate-300">{event.actorLabel || "System"}{event.fromState || event.toState ? ` • ${event.fromState || "start"} → ${event.toState || "unchanged"}` : ""}</p>
                      </div>
                    ))}
                    {timeline.length > 0 ? (
                      timeline.map((event) => (
                        <div key={event.id} className="rounded-3xl border border-white/8 bg-white/[0.03] p-5">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-sm font-semibold text-white">{describeAction(event.action)}</p>
                            <span className="text-xs text-slate-500">{formatDateTime(event.createdAt)}</span>
                          </div>
                          <p className="mt-2 text-sm text-slate-300">
                            {event.reason || event.actorEmail || "System event"}
                          </p>
                          {event.error ? <p className="mt-2 text-sm text-rose-300">{event.error}</p> : null}
                        </div>
                      ))
                    ) : (
                      <EmptyCopy body="No account activity has been logged for this tenant yet." />
                    )}
                    </div>
                  </div>
                ) : null}
              </div>

              {selectedTicket && tab !== "chat" ? (
                <>
                  <div className="mt-4 shrink-0 border-t border-white/6 pt-4">
                    <form action={sendSupportReply} className="rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                      <input type="hidden" name="ticketId" value={selectedTicket.id} />
                      <input
                        type="hidden"
                        name="redirectTo"
                        value={ticketUrl({
                          ticketId: selectedTicket.id,
                          view,
                          tab: "chat",
                          panel,
                          q,
                          tenantId,
                          returnTo,
                        })}
                      />
                      <textarea
                        name="body"
                        rows={3}
                        placeholder="Type your reply to the client..."
                        className="w-full resize-y bg-transparent text-sm text-white outline-none placeholder:text-slate-500"
                      />
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap gap-2">
                          {macros.slice(0, 3).map((macro) => (
                            <button
                              key={macro.id}
                              type="submit"
                              name="body"
                              value={macro.body}
                              className="rounded-full bg-white/[0.04] px-3 py-1.5 text-xs text-slate-300 ring-1 ring-white/8 transition hover:bg-white/[0.08]"
                            >
                              {macro.body.length > 58 ? `${macro.body.slice(0, 58)}…` : macro.body}
                            </button>
                          ))}
                        </div>
                        <button
                          type="submit"
                          className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white"
                        >
                          <Send className="h-4 w-4" />
                          Send
                        </button>
                      </div>
                    </form>
                  </div>

                  <div className="mt-3 shrink-0 flex flex-wrap gap-2 border-t border-white/6 pt-3">
                    <form action={claimTicket}>
                      <input type="hidden" name="id" value={selectedTicket.id} />
                      <input type="hidden" name="redirectTo" value={ticketUrl({ ticketId: selectedTicket.id, view, tab, panel, q, tenantId, returnTo })} />
                      <button type="submit" className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]">
                        Claim Ticket
                      </button>
                    </form>

                    <form action={quickUpdateTicket}>
                      <input type="hidden" name="id" value={selectedTicket.id} />
                      <input type="hidden" name="status" value="resolved" />
                      <input type="hidden" name="redirectTo" value={ticketUrl({ ticketId: selectedTicket.id, view, tab, panel, q, tenantId, returnTo })} />
                      <button type="submit" className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]">
                        Mark Resolved
                      </button>
                    </form>

                    <Link
                      href={`/console/support/${selectedTicket.id}/edit`}
                      className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]"
                    >
                      Internal Note
                    </Link>
                    <details className="relative">
                      <summary className="cursor-pointer list-none rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]">
                        Assign
                      </summary>
                      <form
                        action={assignTicket}
                        className="absolute bottom-12 left-0 z-20 w-64 rounded-2xl border border-white/10 bg-[#171b2d] p-3 shadow-2xl"
                      >
                        <input type="hidden" name="id" value={selectedTicket.id} />
                        <input type="hidden" name="redirectTo" value={ticketUrl({ ticketId: selectedTicket.id, view, tab, panel, q, tenantId, returnTo })} />
                        <label className="text-xs font-medium text-slate-400" htmlFor={`assign-${selectedTicket.id}`}>
                          Support agent
                        </label>
                        <select
                          id={`assign-${selectedTicket.id}`}
                          name="assignedTo"
                          defaultValue={selectedTicket.assigneeId || selectedDetail?.agents[0]?.id || ""}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white outline-none"
                        >
                          {selectedDetail?.agents.map((agent) => (
                            <option key={agent.id} value={agent.id}>{agent.name}</option>
                          ))}
                        </select>
                        <button type="submit" className="mt-3 w-full rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 px-3 py-2 text-sm font-semibold text-white">
                          Assign conversation
                        </button>
                      </form>
                    </details>
                    <Link
                      href={`/console/support/${selectedTicket.id}/edit`}
                      className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]"
                    >
                      Add Tag
                    </Link>
                    <Link
                      href={`/console/support/${selectedTicket.id}/edit`}
                      className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-2 text-sm text-slate-200 transition hover:bg-white/[0.06]"
                    >
                      More
                    </Link>
                  </div>
                </>
              ) : null}
            </section>

            <aside className="hidden min-h-0 flex-col overflow-hidden 2xl:flex">
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <ContextRailContent
                  selectedClient={selectedClient}
                  selectedTicket={selectedTicket}
                  contacts={contacts}
                  orders={orders}
                  suggestions={suggestions}
                  tenantId={tenantId}
                  view={view}
                  tab={tab}
                  q={q}
                  returnTo={returnTo}
                />
              </div>
            </aside>

            <section
              className={[
                "min-h-0 overflow-hidden rounded-[24px] border border-white/8 bg-[#0f1323] p-4 xl:hidden",
                focus === "context" ? "flex flex-col" : "hidden",
              ].join(" ")}
            >
              <div className="mb-4 flex items-center justify-between gap-3 border-b border-white/6 pb-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Customer Context</h2>
                  <p className="mt-1 text-xs text-slate-400">Account details, recent orders, and support guidance.</p>
                </div>
                <Link
                  href={ticketUrl({ ticketId: selectedTicket?.id, view, tab, panel, q, tenantId, returnTo, focus: "workspace" })}
                  className="rounded-full bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-200 ring-1 ring-white/8"
                >
                  Back
                </Link>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                <ContextRailContent
                  selectedClient={selectedClient}
                  selectedTicket={selectedTicket}
                  contacts={contacts}
                  orders={orders}
                  suggestions={suggestions}
                  tenantId={tenantId}
                  view={view}
                  tab={tab}
                  q={q}
                  returnTo={returnTo}
                />
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </ConsolePageShell>
  );
}

function SideCard({
  title,
  subtitle,
  actionLabel,
  actionHref,
  children,
}: {
  title: string;
  subtitle?: string | undefined;
  actionLabel?: string | undefined;
  actionHref?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[28px] border border-white/8 bg-[#0f1323] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-[1.35rem] font-semibold text-white">{title}</h3>
          {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
        </div>
        {actionLabel && actionHref ? (
          <Link href={actionHref} className="text-sm font-medium text-fuchsia-300 hover:text-fuchsia-200">
            {actionLabel}
          </Link>
        ) : null}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function CompactMetric({
  icon,
  label,
  value,
  helper,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
  helper: string;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-[#0f1323] px-3 py-2.5 shadow-[0_10px_30px_rgba(5,8,20,0.18)] [@media(max-height:820px)]:px-2.5 [@media(max-height:820px)]:py-2">
      <div className="flex items-center gap-2.5">
        <div className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white/6 text-fuchsia-200">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">{label}</p>
              <p className="mt-1 text-2xl font-semibold text-white lg:text-[1.75rem] [@media(max-height:820px)]:text-xl">{value}</p>
            </div>
            <p className="max-w-[8.5rem] text-right text-[11px] leading-4 text-slate-400 [@media(max-height:820px)]:hidden">{helper}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function NoSelectionState({
  metrics,
  queueAlerts,
  actor,
  filteredCount,
  currentView,
}: {
  metrics: ReturnType<typeof computeSupportMetrics>;
  queueAlerts: ReturnType<typeof summarizeQueueAlerts>;
  actor: { id: string; name: string } | null;
  filteredCount: number;
  currentView: QueueView;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <section className="rounded-[26px] border border-white/8 bg-white/[0.02] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.16em] text-fuchsia-200">Queue command center</p>
            <h3 className="mt-2 text-2xl font-semibold text-white">No conversation selected</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
              Select a conversation from the queue to review messages, customer context, and operator actions without leaving the workspace.
            </p>
          </div>
          <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Current queue</p>
            <p className="mt-1 text-2xl font-semibold text-white">{filteredCount}</p>
            <p className="text-xs text-slate-400">{currentView.replaceAll("_", " ")}</p>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailCard title="Waiting">
            <DetailRow label="Waiting for agent" value={String(queueAlerts[1]?.value ?? 0)} />
            <DetailRow label="Awaiting first reply" value={String(queueAlerts[2]?.value ?? 0)} />
          </DetailCard>
          <DetailCard title="Workload">
            <DetailRow label="Assigned to me" value={String(metrics.mine)} />
            <DetailRow label="Mentions" value={String(metrics.mentions)} />
          </DetailCard>
          <DetailCard title="SLA">
            <DetailRow label="At risk" value={String(metrics.slaRisk)} />
            <DetailRow label="Performance" value={`${metrics.slaHealthy}%`} />
          </DetailCard>
          <DetailCard title="Coverage">
            <DetailRow label="Active conversations" value={String(metrics.activeConversations)} />
            <DetailRow label="Operator" value={actor?.name || "Unassigned"} />
          </DetailCard>
        </div>
      </section>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        <div className="grid gap-4 lg:grid-cols-2">
          {queueAlerts.map((alert) => (
            <section key={alert.title} className="rounded-3xl border border-white/8 bg-[#11162a] p-5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-semibold text-white">{alert.title}</p>
                <p className="text-xl font-semibold text-fuchsia-200">{alert.value}</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-400">{alert.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContextRailContent({
  selectedClient,
  selectedTicket,
  contacts,
  orders,
  suggestions,
  tenantId,
  view,
  tab,
  q,
  returnTo,
}: {
  selectedClient: Awaited<ReturnType<typeof loadClientDetail>> | null;
  selectedTicket: SupportTicket | null;
  contacts: Awaited<ReturnType<typeof loadClientContacts>>;
  orders: Awaited<ReturnType<typeof loadRecentOrdersForTenant>>;
  suggestions: string[];
  tenantId?: string | undefined;
  view: QueueView;
  tab: WorkspaceTab;
  q: string;
  returnTo?: string | undefined;
}) {
  return (
    <div className="space-y-4">
      <SideCard title="Customer Overview" subtitle="Live account context for the selected conversation.">
        {selectedClient ? (
          <div className="space-y-4">
            <div>
              <p className="text-lg font-semibold text-white">{selectedClient.name}</p>
              {selectedTicket?.customerEmail ? <p className="mt-1 text-sm text-slate-400">{selectedTicket.customerEmail}</p> : null}
            </div>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex items-start gap-3">
                <Mail className="mt-0.5 h-4 w-4 text-slate-500" />
                <span>{selectedTicket?.customerEmail || "No contact email"}</span>
              </div>
              {contacts[0]?.phone ? (
                <div className="flex items-start gap-3">
                  <UserRound className="mt-0.5 h-4 w-4 text-slate-500" />
                  <span>{contacts[0].phone}</span>
                </div>
              ) : null}
              {selectedClient.domains[0]?.domain ? (
                <div className="flex items-start gap-3">
                  <Globe className="mt-0.5 h-4 w-4 text-slate-500" />
                  <span>{selectedClient.domains[0].domain}</span>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-white/6 pt-4">
              <Stat title="Domains" value={selectedClient.domains.length} />
              <Stat title="Services" value={selectedClient.subscriptions.length} />
              <Stat title="Mailboxes" value={selectedClient.mailboxes.length} />
              <Stat title="Websites" value={selectedClient.websites.length} />
            </div>
          </div>
        ) : (
          <EmptyCopy body="Select a ticket linked to a client record to load customer context." />
        )}
      </SideCard>

      <SideCard title="Recent Orders" actionLabel={orders.length > 0 && selectedClient ? "Open client" : undefined} actionHref={selectedClient ? tenantPath(selectedClient.id) : undefined}>
        {orders.length > 0 ? (
          <div className="space-y-3">
            {orders.slice(0, 4).map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{order.id}</p>
                  <p className="mt-1 text-xs text-slate-500">{order.status}</p>
                </div>
                <p className="text-sm font-semibold text-white">{formatCurrency(order.total)}</p>
              </div>
            ))}
          </div>
        ) : (
          <EmptyCopy body="No recent orders to show for the selected context." />
        )}
      </SideCard>

      <SideCard title="Conversation Info" subtitle="Assignment, timing, and support metadata.">
        {selectedTicket ? (
          <div className="space-y-3 text-sm">
            <DetailRow label="ID" value={selectedTicket.ticketNumber || selectedTicket.id} />
            <DetailRow label="Started" value={formatDateTime(selectedTicket.createdAt)} />
            <DetailRow label="Status" value={selectedTicket.status.replaceAll("_", " ")} />
            <DetailRow label="Assigned to" value={selectedTicket.assigneeName || "Unassigned"} />
            <DetailRow label="Messages" value={String(selectedTicket.messageCount)} />
            <DetailRow label="Response SLA" value={selectedTicket.slaBreached ? "At risk" : selectedTicket.slaDeadline ? "Tracked" : "Not set"} />
          </div>
        ) : (
          <EmptyCopy body="Open a ticket from the queue to load assignment, timing, and support metadata." />
        )}
      </SideCard>

      <SideCard title="Abigail Suggestions" subtitle="Derived from the live state of the selected case.">
        {suggestions.length > 0 ? (
          <div className="space-y-3">
            {suggestions.map((suggestion) => (
              <div key={suggestion} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 text-sm leading-6 text-slate-300">
                {suggestion}
              </div>
            ))}
          </div>
        ) : (
          <EmptyCopy body="Open a ticket to generate next-step guidance from its actual state." />
        )}
      </SideCard>

      <SideCard title="Quick Actions">
        <div className="grid grid-cols-2 gap-3">
          <ActionLink href={tenantId ? clientNewTicketPath(tenantId) : "/console/support/new"} icon={<Ticket className="h-4 w-4" />}>
            Create Ticket
          </ActionLink>
          <ActionLink href={selectedClient ? tenantPath(selectedClient.id) : "/console/clients"} icon={<UserRound className="h-4 w-4" />}>
            Check Client
          </ActionLink>
          <ActionLink href={selectedTicket ? `/console/support/${selectedTicket.id}/edit` : "/console/support/new"} icon={<NotebookPen className="h-4 w-4" />}>
            Edit Ticket
          </ActionLink>
          <ActionLink href={ticketUrl({ panel: "knowledge", view, tab, q, tenantId, returnTo, ticketId: selectedTicket?.id })} icon={<BookOpen className="h-4 w-4" />}>
            View Knowledge
          </ActionLink>
        </div>
      </SideCard>

      <div className="rounded-[24px] border border-fuchsia-400/20 bg-[linear-gradient(135deg,rgba(77,35,132,0.96),rgba(59,28,91,0.96))] px-4 py-4 shadow-[0_14px_40px_rgba(76,29,149,0.28)]">
        <div className="flex items-center gap-3">
          <div className="inline-flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-white/10 p-1.5">
            <Image src="/brands/products/migrapilot.png" alt="MigraPilot" width={44} height={44} className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-5 text-white">Powered by MigraPilot</p>
            <p className="mt-1 text-xs leading-5 text-fuchsia-100/70">On MigraHosting Support</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function DetailCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-[28px] border border-white/8 bg-[#11162a] p-5">
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      <div className="mt-4 space-y-3">{children}</div>
    </section>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
      <span className="text-sm text-slate-400">{label}</span>
      <span className="text-right text-sm font-medium text-white">{value}</span>
    </div>
  );
}

function EmptyCopy({ body }: { body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm leading-6 text-slate-400">
      {body}
    </div>
  );
}

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
      <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}

function ActionLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-slate-200 transition hover:bg-white/[0.06]"
    >
      {icon}
      <span>{children}</span>
    </Link>
  );
}
