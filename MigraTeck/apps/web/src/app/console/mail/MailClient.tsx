"use client";

import { useCallback, useEffect, useState } from "react";

/* ------------------------------- types ----------------------------------- */

type Caps = {
  view: boolean;
  send: boolean;
  reply: boolean;
  manage_settings: boolean;
  assign: boolean;
  view_attachments: boolean;
  delete_archive: boolean;
};
type Mailbox = {
  id: string;
  address: string;
  label: string | null;
  brand: string | null;
  caps: Caps;
};
type Addr = { name?: string; address: string };
type Summary = { uid: number; subject: string; from: Addr | null; date: string; seen: boolean };
type Attachment = { partId: string; filename: string; contentType: string; size?: number };
type Detail = Summary & {
  to: Addr[];
  cc: Addr[];
  text: string;
  html: string;
  attachments: Attachment[];
};

const API = "/console/mail/api/mm";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...(init?.headers || {}) },
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = j.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

const fmtAddr = (a: Addr | null) => (a ? a.name || a.address : "(unknown)");
const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
};

/* ------------------------------ component --------------------------------- */

export function MailClient({ canManage }: { canManage: boolean }) {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Summary[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadingBoxes, setLoadingBoxes] = useState(true);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compose, setCompose] = useState<
    null | { to: string; subject: string; text: string; mode: "send" | "reply" }
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

  const loadMessages = useCallback(async (id: string) => {
    setLoadingList(true);
    setDetail(null);
    setError(null);
    try {
      const { messages } = await api<{ messages: Summary[] }>(
        `mailboxes/${id}/messages?folder=INBOX&limit=50`,
      );
      setMessages(messages);
    } catch (e) {
      setError((e as Error).message);
      setMessages([]);
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId, loadMessages]);

  const openMessage = async (uid: number) => {
    if (!activeId) return;
    setLoadingDetail(true);
    setDetail(null);
    try {
      const d = await api<Detail>(`mailboxes/${activeId}/messages/${uid}?folder=INBOX`);
      setDetail(d);
      setMessages((prev) => prev.map((m) => (m.uid === uid ? { ...m, seen: true } : m)));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingDetail(false);
    }
  };

  const submitSend = async () => {
    if (!active || !compose) return;
    setSending(true);
    setError(null);
    try {
      const isReply = compose.mode === "reply";
      await api(`mailboxes/${active.id}/${isReply ? "reply" : "send"}`, {
        method: "POST",
        body: JSON.stringify({
          to: compose.to,
          subject: compose.subject,
          text: compose.text,
        }),
      });
      setCompose(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  if (loadingBoxes) {
    return <div className="text-sm text-slate-400">Loading mailboxes…</div>;
  }
  if (mailboxes.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-6 text-sm text-slate-400">
        You don&apos;t have access to any mailboxes yet.
        {canManage && " Use “Mailbox access” to register one and assign it."}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[16rem_20rem_1fr]">
      {/* Mailbox switcher */}
      <aside className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
          Mailboxes
        </div>
        <ul className="space-y-0.5">
          {mailboxes.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setActiveId(m.id)}
                className={[
                  "w-full rounded-lg px-3 py-2 text-left transition",
                  m.id === activeId ? "bg-fuchsia-500/15 text-white" : "text-slate-300 hover:bg-white/5",
                ].join(" ")}
              >
                <span className="block truncate text-sm font-medium">{m.label || m.address}</span>
                <span className="block truncate text-[11px] text-slate-500">{m.address}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Message list */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <span className="text-sm font-semibold text-white">Inbox</span>
          {active?.caps.send && (
            <button
              type="button"
              onClick={() => setCompose({ to: "", subject: "", text: "", mode: "send" })}
              className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200 hover:bg-white/10"
            >
              Compose
            </button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {loadingList ? (
            <div className="p-4 text-sm text-slate-400">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="p-4 text-sm text-slate-500">No messages.</div>
          ) : (
            <ul>
              {messages.map((m) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    onClick={() => openMessage(m.uid)}
                    className={[
                      "w-full border-b border-white/5 px-4 py-3 text-left transition hover:bg-white/5",
                      detail?.uid === m.uid ? "bg-white/5" : "",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={[
                          "truncate text-sm",
                          m.seen ? "text-slate-300" : "font-semibold text-white",
                        ].join(" ")}
                      >
                        {fmtAddr(m.from)}
                      </span>
                      <span className="shrink-0 text-[10px] text-slate-500">{fmtDate(m.date)}</span>
                    </div>
                    <div className="truncate text-[13px] text-slate-400">{m.subject || "(no subject)"}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Reading / compose pane */}
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
        {error && (
          <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
            {error}
          </div>
        )}
        {compose ? (
          <ComposeForm
            value={compose}
            sending={sending}
            onChange={setCompose}
            onCancel={() => setCompose(null)}
            onSend={submitSend}
          />
        ) : loadingDetail ? (
          <div className="text-sm text-slate-400">Loading message…</div>
        ) : detail ? (
          <article>
            <h2 className="text-lg font-semibold text-white">{detail.subject || "(no subject)"}</h2>
            <div className="mt-1 text-[12px] text-slate-400">
              From <span className="text-slate-200">{fmtAddr(detail.from)}</span>
              {detail.from?.address ? ` <${detail.from.address}>` : ""} · {fmtDate(detail.date)}
            </div>
            <div className="mt-1 text-[12px] text-slate-500">
              To {detail.to.map((t) => t.address).join(", ") || "—"}
            </div>
            {active?.caps.reply && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() =>
                    setCompose({
                      to: detail.from?.address || "",
                      subject: detail.subject.startsWith("Re:") ? detail.subject : `Re: ${detail.subject}`,
                      text: `\n\n----- Original message -----\n${detail.text || ""}`,
                      mode: "reply",
                    })
                  }
                  className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
                >
                  Reply
                </button>
              </div>
            )}
            <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02]">
              {detail.html ? (
                <iframe
                  title="message"
                  sandbox=""
                  className="h-[48vh] w-full rounded-xl bg-white"
                  srcDoc={detail.html}
                />
              ) : (
                <pre className="whitespace-pre-wrap break-words p-4 text-sm text-slate-200">
                  {detail.text || "(empty message)"}
                </pre>
              )}
            </div>
            {detail.attachments.length > 0 && active?.caps.view_attachments && (
              <div className="mt-4">
                <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-500">Attachments</div>
                <ul className="flex flex-wrap gap-2">
                  {detail.attachments.map((att) => (
                    <li key={att.partId}>
                      <a
                        href={`${API}/mailboxes/${active.id}/messages/${detail.uid}/attachments/${encodeURIComponent(
                          att.partId,
                        )}?folder=INBOX`}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-200 hover:bg-white/10"
                      >
                        {att.filename}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </article>
        ) : (
          <div className="text-sm text-slate-500">Select a message to read it.</div>
        )}
      </section>
    </div>
  );
}

function ComposeForm({
  value,
  sending,
  onChange,
  onCancel,
  onSend,
}: {
  value: { to: string; subject: string; text: string; mode: "send" | "reply" };
  sending: boolean;
  onChange: (v: { to: string; subject: string; text: string; mode: "send" | "reply" }) => void;
  onCancel: () => void;
  onSend: () => void;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold text-white">{value.mode === "reply" ? "Reply" : "New message"}</h2>
      <input
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        placeholder="To"
        className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/40"
      />
      <input
        value={value.subject}
        onChange={(e) => onChange({ ...value, subject: e.target.value })}
        placeholder="Subject"
        className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/40"
      />
      <textarea
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder="Write your message…"
        rows={12}
        className="w-full rounded-lg border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white outline-none focus:border-fuchsia-400/40"
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={sending || !value.to.trim()}
          onClick={onSend}
          className="rounded-lg bg-fuchsia-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-fuchsia-500 disabled:opacity-50"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
