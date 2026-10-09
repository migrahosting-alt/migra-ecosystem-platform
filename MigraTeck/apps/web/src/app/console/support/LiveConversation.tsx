"use client";

import { Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type Message = {
  id: string;
  sender: string;
  senderName?: string | null | undefined;
  sendername?: string | null;
  body: string;
  isInternal?: boolean | undefined;
  isinternal?: boolean;
  aiGenerated?: boolean | undefined;
  aigenerated?: boolean;
  createdAt?: string | null | undefined;
  createdat?: string | null;
};
type Agent = { id: string; name: string; status: string };
type Conversation = { assignmentstate: string; status: string; assigneeid: string | null; assigneename: string | null; assigneeemail: string | null; claimedat: string | null; acceptedat: string | null; endedat: string | null; resolutioncategory: string | null; rating: number | null; issueresolved: boolean | null; feedback: string | null };

const normalize = (message: Message): Message => ({
  ...message,
  senderName: message.senderName ?? message.sendername,
  isInternal: message.isInternal ?? message.isinternal,
  aiGenerated: message.aiGenerated ?? message.aigenerated,
  createdAt: message.createdAt ?? message.createdat,
});

const ordered = (messages: Message[]) => [...messages].sort((left, right) => {
  const time = new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime();
  return time || left.id.localeCompare(right.id);
});

export function LiveConversation({ ticketId, initialMessages, agents = [] }: { ticketId: string; initialMessages: Message[]; agents?: Agent[] }) {
  const [messages, setMessages] = useState(() => initialMessages.map(normalize));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [clientTyping, setClientTyping] = useState(false);
  const [clientName, setClientName] = useState("Customer");
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [actorId, setActorId] = useState<string | null>(null);
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState<string | null>(null);
  const [newMessageCount, setNewMessageCount] = useState(0);
  const seen = useRef(new Set(initialMessages.map((message) => message.id)));
  const typingSentAt = useRef(0);
  const stopTimer = useRef<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const nearBottomRef = useRef(true);
  const sinceRef = useRef<string | null>(initialMessages.at(-1)?.createdAt || null);
  const draftStorageKey = `migrateck:support:draft:${ticketId}`;

  const presence = (action: "typing" | "typing-stop") => {
    void fetch(`/console/api/support/conversations/${ticketId}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
      keepalive: true,
    }).catch(() => undefined);
  };

  useEffect(() => {
    let active = true;
    let timer: number;
    const poll = async () => {
      try {
        const query = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : "";
        const response = await fetch(`/console/api/support/conversations/${ticketId}${query}`, { cache: "no-store" });
        const data = await response.json();
        if (active && data.ok) {
          setClientTyping(Boolean(data.clientTyping));
          setClientName(data.clientName || "Customer");
          setConversation(data.conversation || null);
          setActorId(data.actor?.id || null);
          const incoming = (data.messages as Message[]).map(normalize).filter((message) => {
            if (seen.current.has(message.id)) return false;
            seen.current.add(message.id);
            return true;
          });
          if (incoming.length) {
            sinceRef.current = incoming.at(-1)?.createdAt || sinceRef.current;
            setMessages((current) => ordered([...current, ...incoming]));
            if (!nearBottomRef.current) setNewMessageCount((count) => count + incoming.length);
          }
        }
      } catch {
        // The next tick reconciles after a transient disconnect.
      } finally {
        if (active) timer = window.setTimeout(poll, 200);
      }
    };
    void poll();
    return () => {
      active = false;
      window.clearTimeout(timer);
      presence("typing-stop");
    };
  }, [ticketId]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(draftStorageKey);
      if (stored) setDraft(stored);
    } catch {
      // Local draft persistence is best-effort only.
    }
  }, [draftStorageKey]);

  useEffect(() => {
    const heartbeat = () => void fetch(`/console/api/support/conversations/${ticketId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "presence" }), keepalive: true });
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(timer);
  }, [ticketId]);

  useEffect(() => {
    if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages, clientTyping]);

  const workflow = async (action: string, extra: Record<string, unknown> = {}) => {
    setWorkflowBusy(true);
    setWorkflowError(null);
    try {
      const response = await fetch(`/console/api/support/conversations/${ticketId}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, ...extra }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error(data.error || "workflow_failed");
    } catch (error) {
      setWorkflowError(error instanceof Error ? error.message.replaceAll("_", " ") : "Workflow action failed");
    } finally {
      setWorkflowBusy(false);
    }
  };

  const onDraftChange = (value: string) => {
    setDraft(value);
    try {
      if (value) window.localStorage.setItem(draftStorageKey, value);
      else window.localStorage.removeItem(draftStorageKey);
    } catch {
      // Ignore storage write failures.
    }
    const now = Date.now();
    if (value.trim() && now - typingSentAt.current > 250) {
      typingSentAt.current = now;
      presence("typing");
    }
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    stopTimer.current = window.setTimeout(() => presence("typing-stop"), 1_200);
  };

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    const id = crypto.randomUUID();
    const optimistic = normalize({ id, sender: "admin", senderName: "Support", body, createdAt: new Date().toISOString() });
    seen.current.add(id);
    setMessages((current) => ordered([...current, optimistic]));
    setDraft("");
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // Ignore storage cleanup failures.
    }
    setSending(true);
    presence("typing-stop");
    try {
      const response = await fetch(`/console/api/support/conversations/${ticketId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: body, clientMessageId: id }),
      });
      if (!response.ok) throw new Error("send_failed");
    } catch {
      seen.current.delete(id);
      setMessages((current) => current.filter((message) => message.id !== id));
      setDraft(body);
      try {
        window.localStorage.setItem(draftStorageKey, body);
      } catch {
        // Ignore storage restore failures.
      }
    } finally {
      setSending(false);
    }
  };

  const state = conversation?.assignmentstate || "loading";
  const mine = Boolean(actorId && conversation?.assigneeid === actorId);
  const messagingEnabled = mine && ["active", "waiting_on_customer", "waiting_on_support"].includes(state);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/8 bg-white/[0.03] px-3.5 py-2.5">
        <div>
          <p className="text-sm font-semibold capitalize text-white">{state.replaceAll("_", " ")}</p>
          <p className="mt-1 text-xs text-slate-400">
            {conversation?.assigneename ? `${conversation.assigneename} • ${conversation.claimedat ? `claimed ${new Date(conversation.claimedat).toLocaleString()}` : "assigned"}` : "Waiting for an available agent"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {["unassigned", "waiting_for_agent", "reopened"].includes(state) ? <button disabled={workflowBusy} onClick={() => void workflow("claim")} className="rounded-full bg-fuchsia-500 px-4 py-2 text-xs font-semibold text-white">Claim Conversation</button> : null}
          {state === "claimed" && mine ? <button disabled={workflowBusy} onClick={() => void workflow("accept")} className="rounded-full bg-emerald-500 px-4 py-2 text-xs font-semibold text-white">Accept</button> : null}
          {conversation?.assigneeid ? (
            <select disabled={workflowBusy} value="" onChange={(event) => event.target.value && void workflow("transfer", { assignedTo: event.target.value, reason: "Transferred from support workspace" })} className="rounded-full border border-white/10 bg-slate-900 px-3 py-2 text-xs text-slate-200">
              <option value="">Transfer…</option>{agents.filter((agent) => agent.id !== conversation.assigneeid).map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.status})</option>)}
            </select>
          ) : null}
          {!['resolved','ended'].includes(state) ? <button disabled={workflowBusy} onClick={() => void workflow("resolve", { resolutionCategory: "question_answered" })} className="rounded-full border border-emerald-400/30 px-4 py-2 text-xs font-semibold text-emerald-200">Resolve</button> : null}
          {!['resolved','ended'].includes(state) ? <button disabled={workflowBusy} onClick={() => window.confirm("End this active conversation? The customer will no longer be able to send messages unless it is reopened.") && void workflow("end", { resolutionCategory: "other" })} className="rounded-full border border-rose-400/30 px-4 py-2 text-xs font-semibold text-rose-200">End</button> : null}
          {['resolved','ended'].includes(state) ? <button disabled={workflowBusy} onClick={() => void workflow("reopen")} className="rounded-full border border-sky-400/30 px-4 py-2 text-xs font-semibold text-sky-200">Reopen</button> : null}
        </div>
      </div>
      {workflowError ? <p className="mb-2 shrink-0 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{workflowError}</p> : null}
      {conversation?.rating ? <div className="mb-2 shrink-0 rounded-2xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-100"><span className="font-semibold">Customer rating: {conversation.rating}/5</span><span className="ml-3">Issue resolved: {conversation.issueresolved ? "Yes" : "No"}</span>{conversation.feedback ? <p className="mt-2 text-xs text-amber-100/75">{conversation.feedback}</p> : null}</div> : null}
      <div ref={timelineRef} onScroll={() => { const el = timelineRef.current; if (!el) return; nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; if (nearBottomRef.current) setNewMessageCount(0); }} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-2">
        {messages.map((message) => {
          const outbound = message.sender === "admin";
          return (
            <div key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
              <div className="max-w-[72%]">
                <div className={`rounded-[24px] px-5 py-4 shadow-sm ${outbound ? "bg-gradient-to-r from-violet-600 to-fuchsia-500 text-white" : message.isInternal ? "bg-amber-500/10 text-amber-50 ring-1 ring-amber-400/15" : "bg-white/[0.05] text-slate-100 ring-1 ring-white/8"}`}>
                  <p className="whitespace-pre-wrap text-[15px] leading-7">{message.body}</p>
                </div>
                <div className={`mt-2 flex gap-3 text-xs text-slate-500 ${outbound ? "justify-end" : "justify-start"}`}>
                  <span>{message.senderName || message.sender}</span>
                  <span>{message.createdAt ? new Date(message.createdAt).toLocaleString() : ""}</span>
                </div>
              </div>
            </div>
          );
        })}
        {clientTyping ? <p className="text-sm font-medium text-fuchsia-300">{clientName} is typing…</p> : null}
        <div ref={bottomRef} />
      </div>
      {newMessageCount ? <button onClick={() => { nearBottomRef.current = true; setNewMessageCount(0); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="mx-auto mt-2 shrink-0 rounded-full bg-fuchsia-500 px-4 py-2 text-xs font-semibold text-white">{newMessageCount} new message{newMessageCount === 1 ? "" : "s"}</button> : null}
      <div className="mt-2 shrink-0 border-t border-white/6 pt-2">
        <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-3 focus-within:border-fuchsia-400/30">
          <textarea disabled={!messagingEnabled} value={draft} onChange={(event) => onDraftChange(event.target.value)} onBlur={() => presence("typing-stop")} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={messagingEnabled ? 3 : 2} placeholder={messagingEnabled ? "Type your reply to the client..." : ["resolved", "ended"].includes(state) ? "This conversation is closed. Reopen it to send a reply." : state === "claimed" ? "Accept the conversation before replying" : "Claim an active conversation to reply"} className="w-full resize-y bg-transparent text-sm text-white outline-none placeholder:text-slate-500 disabled:cursor-not-allowed disabled:opacity-50" />
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => void send()} disabled={!messagingEnabled || !draft.trim() || sending} className="inline-flex items-center gap-2 rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40"><Send className="h-4 w-4" />Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}
