"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DOMPurify from "dompurify";

/* --------------------------------- types ---------------------------------- */

type Caps = {
  view: boolean;
  send: boolean;
  reply: boolean;
  manage_settings: boolean;
  assign: boolean;
  view_attachments: boolean;
  delete_archive: boolean;
};
type Mailbox = { id: string; address: string; label: string | null; brand: string | null; caps: Caps };
type Addr = { name?: string; address: string };
type ThreadStatus = "open" | "pending" | "closed";
type Summary = {
  uid: number;
  subject: string;
  from: Addr | null;
  date: string;
  seen: boolean;
  status: ThreadStatus;
  assignee: string | null;
  tags: string[];
};
type Attachment = { partId: string; filename: string; contentType: string; size?: number };
type Detail = {
  uid: number;
  subject: string;
  from: Addr | null;
  date: string;
  to: Addr[];
  cc: Addr[];
  text: string;
  html: string;
  attachments: Attachment[];
  messageId?: string;
};
type Note = { id: string; author: string; body: string; createdAt: string };
type Workflow = {
  status: ThreadStatus;
  assignment: { assignee: string; assignedBy: string; assignedAt: string } | null;
  notes: Note[];
  tags: string[];
};
type Customer = {
  id: string;
  name: string;
  status: string;
  activeServices: number;
  openInvoices: number;
  domains: number;
  websites: number;
  mailboxes: number;
  profileHref: string;
};

const MM = "/console/mail/api/mm";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path.startsWith("/console") ? path : `${MM}/${path}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    const code = res.status;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    const err = new Error(msg) as Error & { code?: number };
    err.code = code;
    throw err;
  }
  return (await res.json()) as T;
}

/* ------------------------------- formatting ------------------------------- */

const fmtAddr = (a: Addr | null) => (a ? a.name || a.address.split("@")[0] : "Unknown");
const fmtFull = (iso: string) => {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
};
const fmtShort = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
};
const fmtBytes = (n?: number) => {
  if (!n || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
const initials = (a: Addr | null) => {
  const s = a?.name || a?.address || "?";
  const parts = s.replace(/@.*/, "").split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
};
const avatarHue = (a: Addr | null) => {
  const s = (a?.address || a?.name || "x").toLowerCase();
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
};

const STATUS_TONE: Record<ThreadStatus, string> = {
  open: "border-emerald-400/30 bg-emerald-500/10 text-emerald-300",
  pending: "border-amber-400/30 bg-amber-500/10 text-amber-300",
  closed: "border-slate-400/20 bg-slate-500/10 text-slate-400",
};

type Filters = { q: string; status: string; assigned: string; tag: string; unread: boolean; hasAttachment: boolean };
const EMPTY_FILTERS: Filters = { q: "", status: "", assigned: "", tag: "", unread: false, hasAttachment: false };

/* ------------------------------- ui tokens -------------------------------- */

const ring = "focus:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/60";
const card = "rounded-2xl border border-white/10 bg-white/[0.035]";
const btn = `inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[12px] font-medium text-slate-200 transition hover:bg-white/10 disabled:opacity-40 ${ring}`;
const btnPrimary = `inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-b from-fuchsia-500 to-fuchsia-600 px-3.5 py-1.5 text-[12px] font-semibold text-white shadow-sm shadow-fuchsia-900/40 transition hover:from-fuchsia-400 hover:to-fuchsia-500 disabled:opacity-50 ${ring}`;
const chip = "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-medium";
const input = `w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white placeholder:text-slate-500 ${ring}`;

/* ------------------------------- component -------------------------------- */

export function MailClient({ canManage, me }: { canManage: boolean; me: string }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [customer, setCustomer] = useState<Customer | null | "none">(null);
  const [loadingBoxes, setLoadingBoxes] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<{ message: string; code?: number | undefined } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [compose, setCompose] = useState<
    null | { mode: "send" | "reply" | "forward"; to: string; subject: string; text: string; uid?: number; includeAttachments?: boolean }
  >(null);
  const [sending, setSending] = useState(false);

  const active = mailboxes.find((m) => m.id === activeId) || null;

  useEffect(() => {
    (async () => {
      try {
        const { mailboxes } = await api<{ mailboxes: Mailbox[] }>("mailboxes");
        setMailboxes(mailboxes);
        if (mailboxes[0]) setActiveId(mailboxes[0].id);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoadingBoxes(false);
      }
    })();
  }, []);

  const queryString = useMemo(() => {
    const p = new URLSearchParams({ folder: "INBOX", limit: "100" });
    if (filters.q) p.set("q", filters.q);
    if (filters.status) p.set("status", filters.status);
    if (filters.assigned) p.set("assigned", filters.assigned);
    if (filters.tag) p.set("tag", filters.tag);
    if (filters.unread) p.set("unread", "true");
    if (filters.hasAttachment) p.set("hasAttachment", "true");
    return p.toString();
  }, [filters]);

  const loadMessages = useCallback(async (id: string, qs: string) => {
    setLoadingList(true);
    setDetail(null);
    setWorkflow(null);
    setDetailError(null);
    setError(null);
    try {
      const { messages } = await api<{ messages: Summary[] }>(`mailboxes/${id}/messages?${qs}`);
      setMessages(messages);
    } catch (e) {
      setError((e as Error).message);
      setMessages([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeId) void loadMessages(activeId, queryString);
  }, [activeId, queryString, loadMessages]);

  const openMessage = async (uid: number) => {
    if (!activeId) return;
    setLoadingDetail(true);
    setDetail(null);
    setWorkflow(null);
    setCustomer(null);
    setCompose(null);
    setDetailError(null);
    try {
      const [d, wf] = await Promise.all([
        api<Detail>(`mailboxes/${activeId}/messages/${uid}?folder=INBOX`),
        api<Workflow>(`mailboxes/${activeId}/messages/${uid}/workflow?folder=INBOX`),
      ]);
      setDetail(d);
      setWorkflow(wf);
      setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m)));
      const sender = d.from?.address;
      if (sender) {
        api<{ customer: Customer | null }>(`/console/mail/api/customer?email=${encodeURIComponent(sender)}`)
          .then((r) => setCustomer(r.customer ?? "none"))
          .catch(() => setCustomer("none"));
      } else {
        setCustomer("none");
      }
    } catch (e) {
      const err = e as Error & { code?: number };
      setDetailError({ message: err.message, code: err.code });
    } finally {
      setLoadingDetail(false);
    }
  };

  const refreshWorkflow = async (uid: number) => {
    if (!activeId) return;
    try {
      const wf = await api<Workflow>(`mailboxes/${activeId}/messages/${uid}/workflow?folder=INBOX`);
      setWorkflow(wf);
      setMessages((prev) =>
        prev.map((m) =>
          m.uid === uid ? { ...m, status: wf.status, assignee: wf.assignment?.assignee ?? null, tags: wf.tags } : m,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const submitCompose = async () => {
    if (!active || !compose) return;
    setSending(true);
    setError(null);
    try {
      if (compose.mode === "forward") {
        await api(`mailboxes/${active.id}/forward`, {
          method: "POST",
          body: JSON.stringify({
            folder: "INBOX",
            uid: compose.uid,
            to: compose.to,
            comment: compose.text,
            includeAttachments: compose.includeAttachments === true,
          }),
        });
      } else {
        await api(`mailboxes/${active.id}/${compose.mode === "reply" ? "reply" : "send"}`, {
          method: "POST",
          body: JSON.stringify({ to: compose.to, subject: compose.subject, text: compose.text }),
        });
      }
      setCompose(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (loadingBoxes) return <div className="text-sm text-slate-400">Loading mailboxes…</div>;
  if (mailboxes.length === 0) {
    return (
      <div className={`${card} p-6 text-sm text-slate-400`}>
        You don&apos;t have access to any mailboxes yet.
        {canManage && " Use “Mailbox access” to register one and assign it."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[12.5rem_19rem_minmax(0,1fr)]">
      {/* Mailbox switcher */}
      <aside className={`${card} p-2`}>
        <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Mailboxes</div>
        <ul className="space-y-0.5">
          {mailboxes.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setActiveId(m.id)}
                aria-current={m.id === activeId}
                className={[
                  "w-full rounded-lg px-3 py-2 text-left transition",
                  ring,
                  m.id === activeId ? "bg-fuchsia-500/15 text-white shadow-[inset_0_0_0_1px_rgba(217,70,239,0.25)]" : "text-slate-300 hover:bg-white/5",
                ].join(" ")}
              >
                <span className="block truncate text-sm font-medium">{m.label || m.address}</span>
                <span className="block truncate text-[11px] text-slate-500">{m.address}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Thread list */}
      <section className={`${card} flex min-w-0 flex-col`}>
        <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2.5">
          <span className="text-sm font-semibold text-white">Inbox</span>
          {active?.caps.send && (
            <button type="button" onClick={() => setCompose({ mode: "send", to: "", subject: "", text: "" })} className={btn}>
              Compose
            </button>
          )}
        </div>
        <FilterBar filters={filters} onChange={setFilters} />
        <div className="max-h-[72vh] overflow-y-auto">
          {loadingList ? (
            <ListSkeleton />
          ) : messages.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No messages match these filters.</div>
          ) : (
            <ul>
              {messages.map((m) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    onClick={() => openMessage(m.uid)}
                    aria-current={detail?.uid === m.uid}
                    className={[
                      "flex w-full items-start gap-2.5 border-b border-white/5 px-3 py-2.5 text-left transition hover:bg-white/5",
                      ring,
                      detail?.uid === m.uid ? "bg-fuchsia-500/[0.07]" : "",
                    ].join(" ")}
                  >
                    <span
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                      style={{ background: `hsl(${avatarHue(m.from)} 55% 32%)` }}
                      aria-hidden
                    >
                      {initials(m.from)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={["truncate text-[13px]", m.seen ? "text-slate-300" : "font-semibold text-white"].join(" ")}>
                          {fmtAddr(m.from)}
                        </span>
                        <span className="shrink-0 text-[10px] text-slate-500">{fmtShort(m.date)}</span>
                      </span>
                      <span className="block truncate text-[12.5px] text-slate-400">{m.subject || "(no subject)"}</span>
                      <span className="mt-1 flex flex-wrap items-center gap-1">
                        {!m.seen && <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400" aria-label="unread" />}
                        <span className={`${chip} ${STATUS_TONE[m.status]}`}>{m.status}</span>
                        {m.assignee && (
                          <span className={`${chip} border-sky-400/30 bg-sky-500/10 text-sky-300`}>{m.assignee === me ? "you" : m.assignee.split("@")[0]}</span>
                        )}
                        {m.tags.slice(0, 2).map((t) => (
                          <span key={t} className={`${chip} border-white/10 bg-white/5 text-slate-400`}>#{t}</span>
                        ))}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Reader */}
      <section className="min-w-0">
        {error && <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
        {compose ? (
          <div className={`${card} p-5`}>
            <ComposeForm value={compose} mailbox={active} sending={sending} onChange={setCompose} onCancel={() => setCompose(null)} onSend={submitCompose} />
          </div>
        ) : loadingDetail ? (
          <DetailSkeleton />
        ) : detailError ? (
          <StateCard
            tone="error"
            title={detailError.code === 403 ? "Not authorized" : "Couldn’t load this message"}
            body={detailError.code === 403 ? "You don’t have permission to view this message in this mailbox." : detailError.message}
          />
        ) : detail && active && workflow ? (
          <Reader
            mailbox={active}
            detail={detail}
            workflow={workflow}
            customer={customer}
            me={me}
            onError={setError}
            onChanged={() => refreshWorkflow(detail.uid)}
            onReply={() =>
              setCompose({
                mode: "reply",
                to: detail.from?.address || "",
                subject: detail.subject.startsWith("Re:") ? detail.subject : `Re: ${detail.subject}`,
                text: `\n\n----- Original message -----\n${detail.text || ""}`,
              })
            }
            onForward={() => setCompose({ mode: "forward", to: "", subject: `Fwd: ${detail.subject}`, text: "", uid: detail.uid })}
          />
        ) : (
          <StateCard tone="muted" title="No message selected" body="Pick a conversation from the list to read it here." />
        )}
      </section>
    </div>
  );
}

/* ------------------------------- the reader ------------------------------- */

function Reader({
  mailbox,
  detail,
  workflow,
  customer,
  me,
  onError,
  onChanged,
  onReply,
  onForward,
}: {
  mailbox: Mailbox;
  detail: Detail;
  workflow: Workflow;
  customer: Customer | null | "none";
  me: string;
  onError: (m: string) => void;
  onChanged: () => void;
  onReply: () => void;
  onForward: () => void;
}) {
  const caps = mailbox.caps;
  const n = detail.attachments.length;

  return (
    <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_17.5rem] xl:items-start xl:gap-4">
      {/* main column */}
      <div className={`${card} min-w-0 overflow-hidden`}>
        {/* header */}
        <div className="border-b border-white/5 px-5 pb-4 pt-4">
          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white ring-2 ring-white/10"
              style={{ background: `hsl(${avatarHue(detail.from)} 55% 34%)` }}
              aria-hidden
            >
              {initials(detail.from)}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-[17px] font-semibold leading-snug text-white">{detail.subject || "(no subject)"}</h2>
              <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className="font-medium text-slate-200">{fmtAddr(detail.from)}</span>
                {detail.from?.address && <span className="text-slate-500">&lt;{detail.from.address}&gt;</span>}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {caps.reply && (
                <button type="button" onClick={onReply} className={btnPrimary}>↩ Reply</button>
              )}
              {caps.send && (
                <button type="button" onClick={onForward} className={btn}>↪ Forward</button>
              )}
            </div>
          </div>
          <MetaLine mailbox={mailbox} detail={detail} workflow={workflow} me={me} />
        </div>

        {n > 0 && caps.view_attachments && <Attachments mailbox={mailbox} detail={detail} />}
        {n > 0 && !caps.view_attachments && (
          <div className="border-b border-white/5 px-5 py-3 text-[12px] text-slate-500">
            {n} attachment{n === 1 ? "" : "s"} — you don’t have permission to view attachments in this mailbox.
          </div>
        )}

        <MessageBody detail={detail} />
      </div>

      {/* side rail */}
      <div className="mt-4 space-y-4 xl:mt-0 xl:sticky xl:top-4">
        <WorkflowRail mailbox={mailbox} detail={detail} workflow={workflow} me={me} onError={onError} onChanged={onChanged} />
        <CustomerPanel customer={customer} />
      </div>
    </div>
  );
}

function MetaLine({ mailbox, detail, workflow, me }: { mailbox: Mailbox; detail: Detail; workflow: Workflow; me: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-slate-500">
        <span>To {detail.to.map((t) => t.address).join(", ") || "—"}</span>
        <span className="text-slate-600">·</span>
        <span>{fmtFull(detail.date)}</span>
        <button type="button" onClick={() => setOpen((s) => !s)} className={`text-fuchsia-300/80 hover:text-fuchsia-200 ${ring}`}>
          {open ? "Hide details" : "Details"}
        </button>
      </div>
      {open && (
        <dl className="mt-2 grid grid-cols-[5rem_1fr] gap-x-3 gap-y-1 rounded-lg border border-white/5 bg-black/20 px-3 py-2 text-[11px]">
          {detail.cc.length > 0 && (
            <>
              <dt className="text-slate-500">Cc</dt>
              <dd className="break-words text-slate-300">{detail.cc.map((c) => c.address).join(", ")}</dd>
            </>
          )}
          <dt className="text-slate-500">Mailbox</dt>
          <dd className="text-slate-300">{mailbox.address}</dd>
          {detail.messageId && (
            <>
              <dt className="text-slate-500">Message-ID</dt>
              <dd className="break-all font-mono text-slate-400">{detail.messageId}</dd>
            </>
          )}
        </dl>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className={`${chip} ${STATUS_TONE[workflow.status]}`}>{workflow.status}</span>
        {workflow.assignment && (
          <span className={`${chip} border-sky-400/30 bg-sky-500/10 text-sky-300`}>
            {workflow.assignment.assignee === me ? "Assigned to you" : workflow.assignment.assignee}
          </span>
        )}
        {workflow.tags.map((t) => (
          <span key={t} className={`${chip} border-white/10 bg-white/5 text-slate-300`}>#{t}</span>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------- attachments ----------------------------- */

function Attachments({ mailbox, detail }: { mailbox: Mailbox; detail: Detail }) {
  const base = `${MM}/mailboxes/${mailbox.id}/messages/${detail.uid}`;
  return (
    <div className="border-b border-white/5 px-5 py-3">
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Attachments ({detail.attachments.length})</div>
      <ul className="flex flex-wrap gap-2">
        {detail.attachments.map((att) => (
          <li key={att.partId}>
            <a
              href={`${base}/attachments/${encodeURIComponent(att.partId)}?folder=INBOX`}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-white/10 ${ring}`}
            >
              <span className="text-slate-400">📄</span>
              <span className="max-w-[14rem] truncate">{att.filename}</span>
              {att.size ? <span className="text-[10px] text-slate-500">{fmtBytes(att.size)}</span> : null}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------- message body ---------------------------- */

/**
 * Heuristic: is this HTML "simple" (safe to render inline, natively in the dark
 * theme) or "complex" (newsletter/table-heavy → sandboxed iframe sheet)?
 * Pure + cheap; biased toward the iframe when unsure.
 */
export function classifyHtml(html: string): "simple" | "complex" {
  const h = html || "";
  if (h.length > 60_000) return "complex";
  if (/<(script|iframe|form|object|embed|style)\b/i.test(h)) return "complex";
  const tables = (h.match(/<table\b/gi) || []).length;
  if (tables >= 1 && /(role=["']presentation["'])|(<table[^>]*width)|(width:\s*\d{3,})/i.test(h)) return "complex";
  if (tables >= 2) return "complex";
  const styles = (h.match(/style\s*=/gi) || []).length;
  if (styles > 16) return "complex";
  const divs = (h.match(/<div\b/gi) || []).length;
  if (divs > 40) return "complex";
  if (/max-width:\s*\d{3,}|width=["']?\s*6\d\d|cellpadding|cellspacing|mso-/i.test(h)) return "complex";
  return "simple";
}

function MessageBody({ detail }: { detail: Detail }) {
  const hasHtml = Boolean(detail.html);
  const hasText = Boolean(detail.text);
  const kind = useMemo(() => (hasHtml ? classifyHtml(detail.html) : "simple"), [hasHtml, detail.html]);
  // Default view: native inline for plain text + simple HTML; iframe sheet for complex.
  const [view, setView] = useState<"rich" | "text" | "sheet">(
    !hasHtml ? "text" : kind === "complex" ? "sheet" : "rich",
  );

  return (
    <div className="bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-end gap-2 px-4 pt-3">
        {hasHtml && (
          <div className="inline-flex overflow-hidden rounded-lg border border-white/10 text-[11px]">
            <Seg active={view === "rich"} disabled={kind === "complex"} onClick={() => setView("rich")} title={kind === "complex" ? "This newsletter renders best in the email sheet" : undefined}>
              Reader
            </Seg>
            <Seg active={view === "sheet"} onClick={() => setView("sheet")}>Original</Seg>
            {hasText && <Seg active={view === "text"} onClick={() => setView("text")}>Plain text</Seg>}
          </div>
        )}
      </div>

      {hasHtml && view === "rich" && kind === "simple" ? (
        <SimpleHtmlBody html={detail.html} />
      ) : hasHtml && (view === "sheet" || (view === "rich" && kind === "complex")) ? (
        <HtmlBody html={detail.html} />
      ) : hasText ? (
        <TextBody text={detail.text} />
      ) : (
        <div className="px-5 py-12 text-center text-sm text-slate-500">This message has no readable content.</div>
      )}
    </div>
  );
}

function Seg({ active, disabled, onClick, title, children }: { active: boolean; disabled?: boolean; onClick: () => void; title?: string | undefined; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`px-2.5 py-1 transition disabled:opacity-40 ${active ? "bg-fuchsia-500/20 text-white" : "text-slate-400 hover:bg-white/5"} ${ring}`}
    >
      {children}
    </button>
  );
}

/**
 * Native inline reader for simple/safe HTML. DOMPurify strips scripts, event
 * handlers, javascript: URLs, iframes/forms/objects, and (in this path) the
 * style attribute + tables — so the message inherits the dark console theme
 * instead of carrying a light email design. A post-pass forces safe link rels
 * and gates remote images (hidden until "Show images"). No iframe.
 */
function SimpleHtmlBody({ html }: { html: string }) {
  const [showImages, setShowImages] = useState(false);

  const { safe, blocked } = useMemo(() => {
    if (typeof window === "undefined") return { safe: "", blocked: 0 };
    const clean = DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ["a", "p", "br", "b", "strong", "i", "em", "u", "s", "span", "div", "ul", "ol", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "img", "pre", "code", "hr", "small", "sub", "sup"],
      ALLOWED_ATTR: ["href", "title", "alt", "src"],
      FORBID_TAGS: ["style", "script", "iframe", "form", "object", "embed", "link", "meta", "base", "table", "thead", "tbody", "tr", "td", "th"],
      ALLOW_DATA_ATTR: false,
    });
    const doc = new DOMParser().parseFromString(clean, "text/html");
    doc.querySelectorAll("a").forEach((a) => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer nofollow");
    });
    let n = 0;
    doc.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src") || "";
      if (/^https?:/i.test(src) || src.startsWith("//")) {
        if (!showImages) {
          img.removeAttribute("src");
          img.setAttribute("style", "display:none");
          n += 1;
        }
      } else if (!/^data:|^cid:/i.test(src)) {
        img.removeAttribute("src");
      }
    });
    return { safe: doc.body.innerHTML, blocked: n };
  }, [html, showImages]);

  return (
    <div className="px-4 pb-6 sm:px-6">
      {blocked > 0 && !showImages && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200/90">
          <span>{blocked} remote image{blocked === 1 ? "" : "s"} blocked.</span>
          <button type="button" onClick={() => setShowImages(true)} className={btn}>Show images</button>
        </div>
      )}
      <style>{MM_PROSE_CSS}</style>
      <div className="mm-prose" dangerouslySetInnerHTML={{ __html: safe }} />
    </div>
  );
}

const MM_PROSE_CSS = `
.mm-prose{color:#e2e8f0;font-size:14px;line-height:1.7;max-width:68ch;word-break:break-word;overflow-wrap:anywhere;}
.mm-prose p{margin:0 0 .9em;}
.mm-prose a{color:#e879f9;text-decoration:underline;}
.mm-prose a:hover{color:#f0abfc;}
.mm-prose ul,.mm-prose ol{margin:0 0 .9em 1.3em;padding:0;}
.mm-prose li{margin:.2em 0;}
.mm-prose blockquote{margin:0 0 .9em;padding:.1em 0 .1em .9em;border-left:3px solid rgba(255,255,255,.15);color:#94a3b8;}
.mm-prose h1,.mm-prose h2,.mm-prose h3,.mm-prose h4{color:#fff;font-weight:600;line-height:1.3;margin:1.1em 0 .5em;}
.mm-prose h1{font-size:1.3em;}.mm-prose h2{font-size:1.18em;}.mm-prose h3{font-size:1.06em;}
.mm-prose img{max-width:100%;height:auto;border-radius:8px;margin:.5em 0;}
.mm-prose hr{border:0;border-top:1px solid rgba(255,255,255,.1);margin:1.2em 0;}
.mm-prose pre{white-space:pre-wrap;background:rgba(0,0,0,.3);padding:.75em;border-radius:8px;overflow-x:auto;}
.mm-prose code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.92em;}
.mm-prose strong,.mm-prose b{color:#f1f5f9;}
`;

/** Native, theme-integrated plain-text reader (no iframe). */
function TextBody({ text }: { text: string }) {
  return (
    <div className="px-4 pb-6 pt-3 sm:px-6">
      <pre className="mx-auto max-w-[70ch] whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-slate-200">{text}</pre>
    </div>
  );
}

/**
 * Renders untrusted email HTML on a centered white "sheet" floating on the dark
 * console. Security: sandbox="allow-same-origin" only (NO allow-scripts — email
 * JS can never run; the flag only lets the parent measure height) + injected CSP
 * (default-src 'none'; remote images gated; inline styles only) + base target.
 * The iframe background is transparent and sized to content, so there is no
 * inner scrollbar and no giant white canvas — just an email card on dark.
 * Remote images are hidden (not broken-boxed) until "Show images".
 */
function HtmlBody({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(220);
  const [showImages, setShowImages] = useState(false);
  const [wide, setWide] = useState(false); // default Fit (contained preview card)

  const hasRemote = useMemo(
    () => /(<img[^>]+src=["']https?:)|(url\(\s*["']?https?:)|(background=["']https?:)/i.test(html),
    [html],
  );

  const srcDoc = useMemo(() => {
    const imgSrc = showImages ? "https: http: data: cid:" : "data: cid:";
    const csp = `default-src 'none'; img-src ${imgSrc}; style-src 'unsafe-inline'; font-src data: https:; media-src data:`;
    // Hide remote images entirely when blocked (no broken-image boxes).
    const hideRemote = showImages ? "" : `img[src^="http"],img[src^="//"]{display:none!important}`;
    // Fit mode constrains common newsletter layouts (fixed-width tables/containers)
    // down to the card width so there is no inner horizontal scrollbar and no
    // huge white document. Full mode lets content keep its natural width.
    const fitCss = wide
      ? `body{overflow-x:auto;}`
      : `html,body{overflow-x:hidden;} *{max-width:100%!important;} table{width:auto!important;}
         [width]{width:auto!important;} td,th{word-break:break-word;}`;
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="color-scheme" content="light">
<meta name="viewport" content="width=device-width,initial-scale=1">
<base target="_blank">
<style>
  html,body{margin:0;padding:0;background:#fff;color:#1a1a1a;}
  body{padding:18px 18px 22px;font:14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
       word-wrap:break-word;overflow-wrap:anywhere;}
  img{max-width:100%;height:auto;}
  a{color:#0b66c3;}
  pre{white-space:pre-wrap;word-wrap:break-word;}
  ${fitCss}
  ${hideRemote}
</style></head><body>${html}</body></html>`;
  }, [html, showImages, wide]);

  const obsRef = useRef<ResizeObserver | null>(null);

  const measure = useCallback(() => {
    const f = ref.current;
    try {
      const doc = f?.contentDocument || f?.contentWindow?.document;
      const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight;
      if (h && h > 0) setHeight(Math.min(Math.max(h + 2, 100), 24000));
    } catch {
      /* same-origin read blocked — keep current height */
    }
  }, []);

  const onLoad = useCallback(() => {
    measure();
    setTimeout(measure, 300);
    setTimeout(measure, 1000);
    // Keep the iframe seamlessly auto-sized as fonts/images settle or the email
    // reflows — no fixed embedded window, no inner scrollbar.
    try {
      const doc = ref.current?.contentDocument;
      if (doc?.body && typeof ResizeObserver !== "undefined") {
        obsRef.current?.disconnect();
        const ro = new ResizeObserver(() => measure());
        ro.observe(doc.documentElement);
        ro.observe(doc.body);
        obsRef.current = ro;
      }
    } catch {
      /* observer unavailable — onLoad + timeouts already measured */
    }
  }, [measure]);

  useEffect(() => () => obsRef.current?.disconnect(), []);

  return (
    <div className="px-4 pb-6 sm:px-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-slate-500">Email preview</span>
        <div className="flex flex-wrap items-center gap-2">
          {hasRemote && !showImages && (
            <button type="button" onClick={() => setShowImages(true)} className={`${btn} border-amber-400/30 text-amber-200`}>
              Show images
            </button>
          )}
          <div className="inline-flex overflow-hidden rounded-lg border border-white/10 text-[11px]">
            <button type="button" onClick={() => setWide(false)} className={`px-2.5 py-1 transition ${!wide ? "bg-fuchsia-500/20 text-white" : "text-slate-400 hover:bg-white/5"} ${ring}`}>Fit</button>
            <button type="button" onClick={() => setWide(true)} className={`px-2.5 py-1 transition ${wide ? "bg-fuchsia-500/20 text-white" : "text-slate-400 hover:bg-white/5"} ${ring}`}>Full width</button>
          </div>
        </div>
      </div>
      {/* The iframe element itself is the contained "email card": a centered
          white sheet on the dark reader, capped to a readable width in Fit mode. */}
      <iframe
        ref={ref}
        title="Email message"
        // No allow-scripts — email JavaScript can never execute. allow-same-origin
        // only lets the parent read content height for seamless auto-sizing.
        sandbox="allow-same-origin"
        srcDoc={srcDoc}
        onLoad={onLoad}
        scrolling="no"
        className="mx-auto block w-full rounded-xl border border-black/5 bg-white shadow-2xl shadow-black/50 ring-1 ring-white/5"
        style={{ height, maxWidth: wide ? "100%" : 640, border: "0", overflow: "hidden" }}
      />
    </div>
  );
}

/* ------------------------------- workflow rail ---------------------------- */

function WorkflowRail({
  mailbox,
  detail,
  workflow,
  me,
  onError,
  onChanged,
}: {
  mailbox: Mailbox;
  detail: Detail;
  workflow: Workflow;
  me: string;
  onError: (m: string) => void;
  onChanged: () => void;
}) {
  const caps = mailbox.caps;
  const [note, setNote] = useState("");
  const [assignee, setAssignee] = useState("");
  const [assignable, setAssignable] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [busy, setBusy] = useState(false);
  const base = `${MM}/mailboxes/${mailbox.id}/messages/${detail.uid}`;

  // Eligible assignees (staff with access to this mailbox) for the picker.
  useEffect(() => {
    if (!caps.assign) return;
    let live = true;
    api<{ users: string[] }>(`mailboxes/${mailbox.id}/assignable`)
      .then((r) => { if (live) setAssignable(r.users || []); })
      .catch(() => { if (live) setAssignable([]); });
    return () => { live = false; };
  }, [mailbox.id, caps.assign]);
  const post = (p: string, body?: unknown) => api(p, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) });
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      onChanged();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`${card} p-4`}>
      <h3 className="mb-3 text-[13px] font-semibold text-white">Workflow</h3>

      {/* Status */}
      <div className="mb-4">
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Status</div>
        <div className="inline-flex w-full overflow-hidden rounded-lg border border-white/10">
          {(["open", "pending", "closed"] as ThreadStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              disabled={busy || !caps.assign}
              onClick={() => act(() => post(`${base}/status`, { status: s }))}
              className={[
                "flex-1 px-2 py-1.5 text-[11px] font-medium capitalize transition disabled:opacity-50",
                workflow.status === s ? STATUS_TONE[s].replace("border-", "") + " bg-white/10 text-white" : "text-slate-400 hover:bg-white/5",
                ring,
              ].join(" ")}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Assignment */}
      <div className="mb-4">
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Assigned to</div>
        <div className="text-[12px] text-slate-200">
          {workflow.assignment ? (workflow.assignment.assignee === me ? "You" : workflow.assignment.assignee) : "Unassigned"}
        </div>
        {caps.assign && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <button type="button" disabled={busy || workflow.assignment?.assignee === me} onClick={() => act(() => post(`${base}/assign`, { assignee: me }))} className={btn}>
              Assign to me
            </button>
            {workflow.assignment && (
              <button type="button" disabled={busy} onClick={() => act(() => api(`${base}/assign`, { method: "DELETE" }))} className={btn}>
                Unassign
              </button>
            )}
            <input
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              list="mm-assignable"
              placeholder={assignable.length ? "pick or type email…" : "email…"}
              className={`${input} h-8 flex-1 px-2 py-1 text-[11px]`}
            />
            <datalist id="mm-assignable">
              {assignable.map((e) => (
                <option key={e} value={e} />
              ))}
            </datalist>
            <button type="button" disabled={busy || !assignee.includes("@")} onClick={() => act(async () => { await post(`${base}/assign`, { assignee }); setAssignee(""); })} className={btn}>
              Assign
            </button>
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="mb-4">
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-slate-500">Tags</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {workflow.tags.length === 0 && <span className="text-[11px] text-slate-600">No tags</span>}
          {workflow.tags.map((t) => (
            <span key={t} className={`${chip} border-white/10 bg-white/5 text-slate-300`}>
              #{t}
              {caps.assign && (
                <button type="button" disabled={busy} aria-label={`Remove tag ${t}`} onClick={() => act(() => api(`${base}/tags/${encodeURIComponent(t)}`, { method: "DELETE" }))} className="text-slate-500 hover:text-red-300">×</button>
              )}
            </span>
          ))}
        </div>
        {caps.assign && (
          <div className="mt-2 flex items-center gap-1.5">
            <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="add tag" className={`${input} h-8 px-2 py-1 text-[11px]`} />
            <button type="button" disabled={busy || !tag.trim()} onClick={() => act(async () => { await post(`${base}/tags`, { tag }); setTag(""); })} className={btn}>Add</button>
          </div>
        )}
      </div>

      {/* Internal notes */}
      <div>
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-amber-300/80">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Internal notes
        </div>
        <p className="mb-2 text-[10px] text-slate-600">Staff-only — never sent to the recipient.</p>
        <div className="space-y-2">
          {workflow.notes.length === 0 && <p className="text-[11px] text-slate-600">No notes yet.</p>}
          {workflow.notes.map((n) => (
            <div key={n.id} className="rounded-md border border-amber-400/15 bg-amber-500/[0.05] p-2 text-[12px] text-slate-200">
              <div className="mb-0.5 flex items-center justify-between text-[10px] text-slate-500">
                <span>{n.author === me ? "You" : n.author}</span>
                <span>{fmtFull(n.createdAt)}</span>
              </div>
              <div className="whitespace-pre-wrap break-words">{n.body}</div>
            </div>
          ))}
        </div>
        <div className="mt-2 space-y-1.5">
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add an internal note…" rows={2} className={`${input} text-[12px]`} />
          <button type="button" disabled={busy || !note.trim()} onClick={() => act(async () => { await post(`${base}/note`, { body: note }); setNote(""); })} className={btn}>Add note</button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------ customer panel ---------------------------- */

function CustomerPanel({ customer }: { customer: Customer | null | "none" }) {
  if (customer === null) return <div className={`${card} p-4 text-[12px] text-slate-500`}>Looking up customer…</div>;
  if (customer === "none") return <div className={`${card} p-4 text-[12px] text-slate-500`}>No matching customer for this sender.</div>;
  return (
    <div className={`${card} p-4`}>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-white">Customer</h3>
        <a href={customer.profileHref} className={`text-[12px] text-fuchsia-300 hover:text-fuchsia-200 ${ring}`}>Open profile →</a>
      </div>
      <div className="text-sm font-medium text-white">{customer.name}</div>
      <div className="mt-0.5 text-[12px] text-slate-400">Status: {customer.status}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat label="Active services" value={customer.activeServices} />
        <Stat label="Open invoices" value={customer.openInvoices} tone={customer.openInvoices > 0 ? "warn" : undefined} />
        <Stat label="Domains" value={customer.domains} />
        <Stat label="Websites" value={customer.websites} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | undefined }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className={`text-base font-semibold ${tone === "warn" ? "text-amber-300" : "text-white"}`}>{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

/* --------------------------------- compose -------------------------------- */

function ComposeForm({
  value,
  mailbox,
  sending,
  onChange,
  onCancel,
  onSend,
}: {
  value: { mode: "send" | "reply" | "forward"; to: string; subject: string; text: string; uid?: number; includeAttachments?: boolean };
  mailbox: Mailbox | null;
  sending: boolean;
  onChange: (v: { mode: "send" | "reply" | "forward"; to: string; subject: string; text: string; uid?: number; includeAttachments?: boolean }) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  const title = value.mode === "reply" ? "Reply" : value.mode === "forward" ? "Forward" : "New message";
  const blocked = value.mode === "reply" ? !mailbox?.caps.reply : !mailbox?.caps.send;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {mailbox && <span className="text-[11px] text-slate-500">from <span className="text-slate-300">{mailbox.label || mailbox.address}</span></span>}
      </div>
      {blocked && (
        <div className="rounded-lg border border-amber-400/20 bg-amber-500/[0.06] px-3 py-2 text-[12px] text-amber-200/90">
          You don’t have permission to {value.mode === "reply" ? "reply" : "send"} from this mailbox.
        </div>
      )}
      <input value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} placeholder="To" className={input} />
      {value.mode !== "forward" && <input value={value.subject} onChange={(e) => onChange({ ...value, subject: e.target.value })} placeholder="Subject" className={input} />}
      <textarea
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder={value.mode === "forward" ? "Add an optional note above the forwarded message…" : "Write your message…"}
        rows={value.mode === "forward" ? 5 : 12}
        className={input}
      />
      {value.mode === "forward" && (
        mailbox?.caps.view_attachments ? (
          <label className="flex items-center gap-2 text-[12px] text-slate-300">
            <input
              type="checkbox"
              checked={value.includeAttachments === true}
              onChange={(e) => onChange({ ...value, includeAttachments: e.target.checked })}
            />
            Include original attachments
            <span className="text-[11px] text-slate-500">(up to 20&nbsp;MB; larger ones are skipped)</span>
          </label>
        ) : (
          <p className="text-[11px] text-slate-500">Forwards the body + quoted context. (Attachments need the “view attachments” permission.)</p>
        )
      )}
      <div className="flex items-center gap-2">
        <button type="button" disabled={sending || blocked || !value.to.trim()} onClick={onSend} className={btnPrimary}>
          {sending ? "Sending…" : value.mode === "forward" ? "Forward" : "Send"}
        </button>
        <button type="button" onClick={onCancel} className={btn}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------ small helpers ----------------------------- */

function FilterBar({ filters, onChange }: { filters: Filters; onChange: (f: Filters) => void }) {
  const sel = `rounded-md border border-white/10 bg-slate-950/50 px-2 py-1 text-[11px] text-slate-200 ${ring}`;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-white/5 px-3 py-2">
      <input value={filters.q} onChange={(e) => onChange({ ...filters, q: e.target.value })} placeholder="Search sender/subject…" className={`${sel} min-w-[7rem] flex-1`} />
      <select value={filters.status} onChange={(e) => onChange({ ...filters, status: e.target.value })} className={sel} aria-label="Filter by status">
        <option value="">Any status</option>
        <option value="open">Open</option>
        <option value="pending">Pending</option>
        <option value="closed">Closed</option>
      </select>
      <select value={filters.assigned} onChange={(e) => onChange({ ...filters, assigned: e.target.value })} className={sel} aria-label="Filter by assignee">
        <option value="">Anyone</option>
        <option value="me">Mine</option>
        <option value="unassigned">Unassigned</option>
      </select>
      <input value={filters.tag} onChange={(e) => onChange({ ...filters, tag: e.target.value })} placeholder="tag" className={`${sel} w-16`} aria-label="Filter by tag" />
      <label className="flex items-center gap-1 text-[11px] text-slate-400">
        <input type="checkbox" checked={filters.unread} onChange={(e) => onChange({ ...filters, unread: e.target.checked })} /> Unread
      </label>
      <label className="flex items-center gap-1 text-[11px] text-slate-400">
        <input type="checkbox" checked={filters.hasAttachment} onChange={(e) => onChange({ ...filters, hasAttachment: e.target.checked })} /> 📎
      </label>
    </div>
  );
}

function StateCard({ tone, title, body }: { tone: "muted" | "error"; title: string; body: string }) {
  const border = tone === "error" ? "border-red-500/30" : "border-white/10";
  return (
    <div className={`flex min-h-[42vh] flex-col items-center justify-center rounded-2xl border ${border} bg-white/[0.02] p-8 text-center`}>
      <p className="text-sm font-medium text-white">{title}</p>
      <p className="mt-1 max-w-md text-xs text-slate-500">{body}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2 p-3">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-white/5" />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className={`${card} overflow-hidden`}>
      <div className="border-b border-white/5 p-5">
        <div className="h-5 w-2/3 animate-pulse rounded bg-white/10" />
        <div className="mt-3 h-3 w-1/2 animate-pulse rounded bg-white/5" />
      </div>
      <div className="bg-slate-950/40 p-6">
        <div className="mx-auto h-72 max-w-[680px] animate-pulse rounded-xl bg-white/5" />
      </div>
    </div>
  );
}
