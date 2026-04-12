"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";

import type { PlanStep } from "../../components/PlanViewer";
import type { LoopPhase } from "../../components/IntelligenceLoopIndicator";
import { QuickActions } from "../../components/QuickActions";
import type { ChatMessage, ConversationRecord, TimelineRun } from "../../lib/shared/types";
import type { ReasoningCardProps, RiskTier } from "../../lib/ui-contracts";
import { pilotApiUrl } from "../../lib/shared/pilot-api";
import { DEFAULT_CHAT_SETTINGS, type ChatSettings } from "../../lib/shared/chat-settings";

const SystemStatusPanel = dynamic(() => import("../../components/SystemStatusPanel").then((mod) => mod.SystemStatusPanel), {
  ssr: false,
  loading: () => <div className="status-panel" style={{ minHeight: 96 }} />,
});

const StatusBriefPanel = dynamic(() => import("../../components/StatusBriefPanel").then((mod) => mod.StatusBriefPanel), {
  ssr: false,
  loading: () => <div className="panel" style={{ minHeight: 220 }} />,
});

const ReasoningCard = dynamic(() => import("../../components/ReasoningCard").then((mod) => mod.ReasoningCard), {
  ssr: false,
  loading: () => <div className="panel" style={{ minHeight: 140 }} />,
});

const PlanViewer = dynamic(() => import("../../components/PlanViewer").then((mod) => mod.PlanViewer), {
  ssr: false,
  loading: () => <div className="panel" style={{ minHeight: 160 }} />,
});

const IntelligenceLoopIndicator = dynamic(() => import("../../components/IntelligenceLoopIndicator").then((mod) => mod.IntelligenceLoopIndicator), {
  ssr: false,
  loading: () => <div style={{ width: 96, height: 32, borderRadius: 999, border: "1px solid var(--line)" }} />,
});

const ConsoleSideRail = dynamic(() => import("../../components/ConsoleSideRail").then((mod) => mod.ConsoleSideRail), {
  ssr: false,
  loading: () => <div className="panel" style={{ minHeight: 400 }} />,
});

const FileTreePanel = dynamic(() => import("../../components/FileTreePanel").then((mod) => mod.FileTreePanel), {
  ssr: false,
  loading: () => <div className="panel" style={{ minHeight: 200 }} />,
});

const MarkdownMessage = dynamic(() => import("../../components/MarkdownMessage").then((mod) => mod.MarkdownMessage), {
  ssr: false,
  loading: () => <span style={{ whiteSpace: "pre-wrap" }}>Loading response…</span>,
});

const InlineDiff = dynamic(() => import("../../components/InlineDiff").then((mod) => mod.InlineDiff), { ssr: false });
import { looksLikeDiff } from "../../components/InlineDiff";

/* ── Execution Mode ── */
type ExecMode = "chat" | "plan" | "execute-t01" | "execute-t2";

const MODE_CONFIG: Record<ExecMode, { label: string; description: string; icon: string; badge: string }> = {
  "chat": { label: "Chat", description: "Conversation only — no tools", icon: "💬", badge: "" },
  "plan": { label: "Plan Only", description: "Propose tool calls, don't execute", icon: "📋", badge: "badge" },
  "execute-t01": { label: "Execute T0/T1", description: "Read + write ops (auto)", icon: "⚡", badge: "badge-ok" },
  "execute-t2": { label: "Execute T2", description: "Critical ops (requires approval)", icon: "🔐", badge: "badge-danger" },
};

/* ── Auth helpers ── */
function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/* ── Intent Detection (client-side heuristic) ── */
function isVagueInput(msg: string): boolean {
  const t = msg.trim().toLowerCase();
  return /^(hello|hi|hey|howdy|yo)\b/.test(t) ||
    /^(status|state|overview|summary|brief|digest|report)\s*\??$/.test(t) ||
    /^(what('?s| is) (going on|up|happening|the status|the state)|how are (things|we doing))\s*\??$/.test(t) ||
    /^(help|how can you help|what can you do)\s*\??$/.test(t);
}

function detectIntent(msg: string): { intent: string; category: string } {
  const lower = msg.toLowerCase();
  if (/inventory|tenant|pod|domain|service|list/.test(lower)) return { intent: "Inventory request", category: "inventory" };
  if (/deploy|ship|release|push|rollout/.test(lower)) return { intent: "Deployment operation", category: "deploy" };
  if (/health|status|check|alive|ping/.test(lower)) return { intent: "Health/status check", category: "debug" };
  if (/drift|diff|snapshot|changed/.test(lower)) return { intent: "Drift detection", category: "audit" };
  if (/build|compile|test|ci/.test(lower)) return { intent: "Build operation", category: "build" };
  if (/security|rbac|abac|cert|ssl|expose/.test(lower)) return { intent: "Security audit", category: "audit" };
  if (/fix|debug|error|fail|broken|log/.test(lower)) return { intent: "Debug/troubleshoot", category: "debug" };
  if (/mission|plan|workflow/.test(lower)) return { intent: "Mission planning", category: "deploy" };
  return { intent: "General query", category: "chat" };
}

/* ── File upload constants ── */
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf", "application/json", "text/csv", "text/yaml", "application/x-yaml"];
const ALLOWED_EXTENSIONS = ".jpg,.jpeg,.png,.webp,.pdf,.json,.csv,.yaml,.yml";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_FILES = 6;

function isImageFile(f: File) { return f.type.startsWith("image/"); }
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/* ── Inline SVG icons ── */
const AttachIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13.5 7.5l-5.7 5.7a3.2 3.2 0 01-4.5-4.5l5.7-5.7a2.1 2.1 0 013 3L6.3 11.7a1.1 1.1 0 01-1.5-1.5L10 5"/>
  </svg>
);
const CloseChipIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
    <path d="M4.5 4.5L11.5 11.5M11.5 4.5L4.5 11.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);
const ImageIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="2" width="12" height="12" rx="2"/>
    <circle cx="5.5" cy="5.5" r="1"/>
    <path d="M14 10l-3-3-7 7"/>
  </svg>
);
const FileDocIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 1H4a1 1 0 00-1 1v12a1 1 0 001 1h8a1 1 0 001-1V5L9 1z"/>
    <path d="M9 1v4h4"/>
  </svg>
);

/* ── Provider badge ── */
function ProviderBadge({ tag }: { tag: string }) {
  const map: Record<string, { icon: string; color: string; label: string }> = {
    local:  { icon: "🟢", color: "#4ec9b0", label: "Local" },
    sonnet: { icon: "🟡", color: "#569cd6", label: "Sonnet" },
    opus:   { icon: "🔴", color: "#c586c0", label: "Opus" },
  };
  const info = map[tag] ?? { icon: "⚪", color: "#888", label: tag };
  return (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, border: `1px solid ${info.color}`, color: info.color, fontWeight: 600 }}>
      {info.icon} {info.label}
    </span>
  );
}

/* ── Tool event type from streaming ── */
interface StreamToolEvent {
  toolName?: string;
  status?: string;
  payload?: {
    args?: Record<string, unknown>;
    result?: unknown;
    error?: {
      code?: string;
      message?: string;
      approvalRequest?: {
        toolName: string;
        approvalId: string;
        expiresAt: string;
      };
    };
    blastRadius?: string;
    rollbackHint?: string;
  };
}

interface ExecuteEvent {
  runId: string;
  overlay?: TimelineRun["overlay"];
  result?: TimelineRun["output"];
  status?: string;
  message?: string;
  approvalId?: string;
  risk?: string;
}

function dedupeRuns(runs: TimelineRun[]): TimelineRun[] {
  const byId = new Map<string, TimelineRun>();
  for (const run of runs) {
    const existing = byId.get(run.id);
    if (!existing || run.createdAt >= existing.createdAt) {
      byId.set(run.id, run);
    }
  }
  return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export default function ConsolePage() {
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<ConversationRecord | null>(null);
  const [runs, setRuns] = useState<TimelineRun[]>([]);
  const [proposed, setProposed] = useState<Array<{ toolName: string; input: Record<string, unknown> }>>([]);
  const [runnerType, setRunnerType] = useState<"local" | "server">("server");
  const [environment, setEnvironment] = useState<"dev" | "stage" | "staging" | "prod" | "test">("prod");
  const [sessionRunId] = useState<string>(() => `run_${Date.now().toString(36)}`);
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<ExecMode>("execute-t01");
  const [loopPhase, setLoopPhase] = useState<LoopPhase>("idle");
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
  const [showStatusBrief, setShowStatusBrief] = useState(false);
  const [lastReasoning, setLastReasoning] = useState<ReasoningCardProps | null>(null);
  const [chatSettings, setChatSettings] = useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);

  /* ── LLM Streaming state ── */
  const [streamingText, setStreamingText] = useState("");
  const [streamingTools, setStreamingTools] = useState<StreamToolEvent[]>([]);
  const [activeProvider, setActiveProvider] = useState<{ tag: string; model: string; reason: string } | null>(null);
  const [pilotConversationId, setPilotConversationId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{ toolName: string; approvalId: string; expiresAt: string } | null>(null);

  /* Ref to track accumulated streaming text (available in closures) */
  const streamingTextRef = useRef("");
  const abortControllerRef = useRef<AbortController | null>(null);

  /* ── File upload state ── */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Map<string, string>>(new Map());
  const [supportingUiReady, setSupportingUiReady] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  const shouldRenderSupportingUi =
    supportingUiReady ||
    (conversation?.messages.length ?? 0) > 0 ||
    streamingText.length > 0 ||
    showStatusBrief ||
    proposed.length > 0 ||
    runs.length > 0 ||
    Boolean(lastReasoning) ||
    planSteps.length > 0;

  const refreshState = useCallback(async () => {
    try {
      const response = await fetch("/api/state", { cache: "no-store" });
      const payload = (await response.json()) as {
        ok: boolean;
        data: { conversations: ConversationRecord[]; runs: TimelineRun[] };
      };
      if (payload.ok) {
        setRuns(dedupeRuns(payload.data.runs ?? []));
        if (conversation) {
          const updated = payload.data.conversations.find((item) => item.id === conversation.id) ?? null;
          if (updated) setConversation(updated);
        }
      }
    } catch { /* offline / not available */ }
  }, [conversation]);

  useEffect(() => {
    if (!shouldRenderSupportingUi) return;
    void refreshState();
  }, [refreshState, shouldRenderSupportingUi]);

  useEffect(() => {
    if (!shouldRenderSupportingUi) return;
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch("/api/chat/settings", { cache: "no-store" });
        const payload = await response.json();
        if (!mounted || !payload?.ok || !payload?.data) return;
        setChatSettings(payload.data);
        setMode(payload.data.defaultMode);
      } catch {
        // keep defaults on failure
      }
    })();
    return () => { mounted = false; };
  }, [shouldRenderSupportingUi]);
  useEffect(() => { scrollToEnd(); }, [conversation?.messages, streamingText, streamingTools]);

  const chatMessages = useMemo(() => conversation?.messages ?? [], [conversation]);

  /* ── Export conversation as markdown ── */
  const exportConversation = useCallback(() => {
    if (!chatMessages.length) return;
    const lines: string[] = [
      `# MigraPilot Console — Conversation Export`,
      `**Date:** ${new Date().toISOString()}`,
      `**Messages:** ${chatMessages.length}`,
      "",
      "---",
      "",
    ];
    for (const msg of chatMessages) {
      const role = msg.role === "user" ? "**You**" : "**Pilot**";
      const ts = new Date(msg.createdAt).toLocaleString();
      lines.push(`### ${role}  <sub>${ts}</sub>`);
      lines.push("");
      lines.push(msg.content);
      lines.push("");
      lines.push("---");
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `migrapilot-conversation-${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [chatMessages]);

  /* ── File handling ── */
  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(f => {
      if (!ALLOWED_MIME.includes(f.type)) return false;
      if (f.size > MAX_FILE_SIZE) return false;
      return true;
    });
    setPendingFiles(prev => {
      const combined = [...prev, ...files].slice(0, MAX_FILES);
      for (const f of combined) {
        if (isImageFile(f) && !filePreviews.has(f.name + f.size)) {
          const url = URL.createObjectURL(f);
          setFilePreviews(prev => new Map(prev).set(f.name + f.size, url));
        }
      }
      return combined;
    });
  }

  function removeFile(idx: number) {
    setPendingFiles(prev => {
      const next = [...prev];
      const removed = next.splice(idx, 1)[0];
      if (removed) {
        const key = removed.name + removed.size;
        const url = filePreviews.get(key);
        if (url) { URL.revokeObjectURL(url); setFilePreviews(prev => { const n = new Map(prev); n.delete(key); return n; }); }
      }
      return next;
    });
  }

  function handleFilePick() { fileInputRef.current?.click(); }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) { addFiles(e.target.files); e.target.value = ""; }
  }

  function handlePaste(e: React.ClipboardEvent) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind === "file") {
        const f = items[i].getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) { e.preventDefault(); addFiles(files); }
  }

  function handleDragOver(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }
  function handleDragLeave(e: React.DragEvent) { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); e.stopPropagation(); setIsDragging(false);
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  }

  /* ── Send message → real pilot-api streaming ── */
  async function handleStop() {
    if (pilotConversationId) {
      try {
        await fetch(pilotApiUrl(`/api/pilot/chat/cancel/${pilotConversationId}`), {
          method: "POST",
          headers: getAuthHeader(),
        });
      } catch { /* best effort */ }
    }
    abortControllerRef.current?.abort();
    setSending(false);
    setLoopPhase("idle");
    setStreamingText("");
    setStreamingTools([]);
    streamingTextRef.current = "";
  }

  async function sendMessage(overrideMessage?: string) {
    const msg = overrideMessage ?? message;
    if (!msg.trim() || sending) return;

    if (!supportingUiReady) {
      setSupportingUiReady(true);
    }

    /* Status Brief shortcut — vague inputs show the brief instead of running tools */
    if (isVagueInput(msg)) {
      setShowStatusBrief(true);
      setMessage("");
      return;
    }

    setSending(true);
    setStreamingText("");
    streamingTextRef.current = "";
    setStreamingTools([]);
    setActiveProvider(null);
    setPendingApproval(null);
    setLastReasoning(null);
    setPlanSteps([]);

    /* Intelligence Loop: Understand */
    setLoopPhase("understand");

    /* ── Slash command expansion ── */
    let expandedMsg = msg;
    const slashMatch = msg.match(/^\/(\w+)\s*(.*)/s);
    if (slashMatch) {
      const [, cmd, rest] = slashMatch;
      const slashCommands: Record<string, string> = {
        read: `Read the file: ${rest}`,
        search: `Search the codebase for: ${rest}`,
        fix: `Fix the errors in: ${rest || "the current project"}`,
        explain: `Explain this code: ${rest}`,
        test: `Run the tests for: ${rest || "the current project"}`,
        health: `Run repo.codeHealth and report the result`,
        deploy: `Deploy: ${rest}`,
        diff: `Show the git diff for: ${rest || "current changes"}`,
        errors: `Run repo.getErrors and report all TypeScript errors`,
        security: `Run security.scan on: ${rest || "the current project"}`,
      };
      if (cmd && slashCommands[cmd]) {
        expandedMsg = slashCommands[cmd];
      }
    }

    /* ── @ file mention expansion ── */
    const atMentions = expandedMsg.match(/@([\w./-]+\.\w+)/g);
    if (atMentions) {
      const filePaths = atMentions.map(m => m.slice(1));
      const contextPrefix = filePaths.map(f => `[Context: read ${f}]`).join(" ");
      expandedMsg = `${contextPrefix} ${expandedMsg.replace(/@[\w./-]+\.\w+/g, (m) => m.slice(1))}`;
    }

    const { intent } = detectIntent(expandedMsg);
    setLoopPhase("enrich");

    /* Add user message optimistically */
    const userMsg: ChatMessage = {
      id: `msg_${Date.now().toString(36)}`,
      role: "user",
      content: msg,
      createdAt: new Date().toISOString(),
    };

    setConversation((prev) => {
      const base: ConversationRecord = prev ?? {
        id: `temp_${Date.now()}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: [],
      };
      return { ...base, updatedAt: new Date().toISOString(), messages: [...base.messages, userMsg] };
    });

    setMessage("");

    /* Build request — JSON or FormData if files attached */
    const requestHistory = chatMessages.slice(-20).map((item) => ({
      role: item.role,
      text: item.content,
    }));
    const dryRun = mode === "chat" || mode === "plan";
    const provider = chatSettings.provider !== "auto" ? chatSettings.provider : undefined;
    const model = chatSettings.model.trim() || undefined;
    let fetchOpts: RequestInit;

    if (pendingFiles.length > 0) {
      const form = new FormData();
      if (pilotConversationId) form.append("conversationId", pilotConversationId);
      form.append("message", expandedMsg);
      form.append("history", JSON.stringify(requestHistory));
      form.append("dryRun", String(dryRun));
      if (provider) form.append("provider", provider);
      if (model) form.append("model", model);
      for (const f of pendingFiles) form.append("files", f);
      fetchOpts = { method: "POST", headers: { ...getAuthHeader() }, body: form };
    } else {
      fetchOpts = {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          conversationId: pilotConversationId,
          message: expandedMsg,
          history: requestHistory,
          dryRun,
          provider,
          model,
        }),
      };
    }

    /* Clear files */
    setPendingFiles([]);
    filePreviews.forEach(url => URL.revokeObjectURL(url));
    setFilePreviews(new Map());

    setLoopPhase("plan");

    const ac = new AbortController();
    abortControllerRef.current = ac;

    try {
      const response = await fetch(pilotApiUrl("/api/pilot/chat/stream"), { ...fetchOpts, signal: ac.signal });

      if (!response.ok) {
        const errText = await response.text().catch(() => "Request failed");
        // Add error message
        setConversation((prev) => {
          if (!prev) return prev;
          const errMsg: ChatMessage = {
            id: `msg_err_${Date.now().toString(36)}`,
            role: "assistant",
            content: `**Error:** ${response.status} — ${errText}`,
            createdAt: new Date().toISOString(),
          };
          return { ...prev, messages: [...prev.messages, errMsg] };
        });
        setLoopPhase("idle");
        setSending(false);
        return;
      }

      setLoopPhase("execute");

      const reader = response.body?.getReader();
      if (!reader) { setSending(false); setLoopPhase("idle"); return; }

      let buf = "";
      const collectedTools: StreamToolEvent[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += new TextDecoder().decode(value, { stream: true });
        const chunks = buf.split("\n\n");
        buf = chunks.pop() ?? "";

        for (const c of chunks) {
          const lines = c.split("\n");
          const ev = lines.find(l => l.startsWith("event:"))?.slice(6).trim();
          const dr = lines.find(l => l.startsWith("data:"))?.slice(5).trim();
          if (!ev || !dr) continue;

          try {
            const p = JSON.parse(dr);

            if (ev === "conversation") {
              setPilotConversationId(p.conversationId);
            }

            if (ev === "provider") {
              setActiveProvider({ tag: p.tag, model: p.model, reason: p.reason });
            }

            if (ev === "token") {
              streamingTextRef.current += p.text;
              setStreamingText(streamingTextRef.current);
              scrollToEnd();
            }

            if (ev === "tool") {
              const toolEvt = p as StreamToolEvent;
              collectedTools.push(toolEvt);
              setStreamingTools(prev => [...prev, toolEvt]);

              /* Handle approval required */
              const err = toolEvt?.payload?.error;
              if (err?.code === "APPROVAL_REQUIRED" && err?.approvalRequest) {
                setPendingApproval(err.approvalRequest);
              }
              scrollToEnd();
            }

            if (ev === "error") {
              streamingTextRef.current += `\n\n**Error:** ${p.message ?? "Unknown error"}`;
              setStreamingText(streamingTextRef.current);
            }

            if (ev === "done") {
              /* Finalize: add assistant message from stream */
              setLoopPhase("summarize");
            }
          } catch { /* ignore malformed SSE */ }
        }
      }

      /* After stream ends, commit the streamed text as an assistant message */
      const finalText = streamingTextRef.current;
      if (finalText) {
        setConversation((prev) => {
          if (!prev) return prev;
          const assistantMsg: ChatMessage = {
            id: `msg_${Date.now().toString(36)}`,
            role: "assistant",
            content: finalText,
            createdAt: new Date().toISOString(),
          };
          return { ...prev, updatedAt: new Date().toISOString(), messages: [...prev.messages, assistantMsg] };
        });
      }

      /* Build reasoning + plans from tool events */
      if (collectedTools.length > 0) {
        const toolCalls = collectedTools.filter(t => t.toolName);
        if (toolCalls.length > 0) {
          setProposed(toolCalls.map(t => ({
            toolName: t.toolName!,
            input: (t.payload?.args as Record<string, unknown>) ?? {},
          })));

          const cardMode: ReasoningCardProps["mode"] =
            mode === "execute-t2" ? "t2Approval" : mode === "plan" ? "planOnly" : "executeT0T1";

          function getToolTier(name: string): RiskTier {
            if (name.includes("deploy") || name.includes("delete") || name.includes("drop") || name.includes("destroy")) return "T2";
            if (name.includes("list") || name.includes("get") || name.includes("show") || name.includes("health") || name.includes("check")) return "T0";
            return "T1";
          }

          setLastReasoning({
            intentLabel: intent,
            mode: cardMode,
            planLine: `Executed ${toolCalls.length} tool${toolCalls.length > 1 ? "s" : ""} via agent loop.`,
            steps: toolCalls.map((call, i) => ({
              id: `step_${i}`,
              name: call.toolName!,
              tier: getToolTier(call.toolName!),
              detail: call.status ?? undefined,
              expectedProofs: ["activity-proof"],
              status: (call.status === "completed" || call.payload?.result) ? "ok" as const : "pending" as const,
            })),
            proofsRequired: ["activity-proof"],
          });

          setPlanSteps(toolCalls.map((call, i) => ({
            id: `step_${i}`,
            label: `Step ${i + 1}: ${call.toolName}`,
            description: call.status ?? "executed",
            status: (call.status === "completed" || call.payload?.result) ? "completed" as const : "pending" as const,
            toolName: call.toolName!,
            riskTier: call.toolName!.includes("list") || call.toolName!.includes("get") ? 0 : 1,
          })));
        }
      }

      setStreamingText("");
      setStreamingTools([]);
      setLoopPhase("idle");
      await refreshState();
    } catch (err) {
      setConversation((prev) => {
        if (!prev) return prev;
        const errMsg: ChatMessage = {
          id: `msg_err_${Date.now().toString(36)}`,
          role: "assistant",
          content: `**Network error:** ${err instanceof Error ? err.message : "Connection failed"}`,
          createdAt: new Date().toISOString(),
        };
        return { ...prev, messages: [...prev.messages, errMsg] };
      });
      setLoopPhase("idle");
    } finally {
      setSending(false);
      setStreamingText("");
      streamingTextRef.current = "";
      setStreamingTools([]);
      setLoopPhase("idle");
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  }

  async function executeToolCall(toolName: string, input: Record<string, unknown>, stepIndex?: number) {
    if (stepIndex !== undefined) {
      setPlanSteps((prev) => prev.map((s, i) =>
        i === stepIndex ? { ...s, status: "active" as const } : s
      ));
    }

    setLoopPhase("execute");

    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolName,
        toolInput: input,
        runnerTarget: runnerType,
        environment,
        runId: sessionRunId,
        operator: { operatorId: "bonex", role: "owner" },
        autonomyBudgetId: "default"
      })
    });

    if (!response.body) {
      setLoopPhase("idle");
      await refreshState();
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const eventBlock of events) {
        const eventLines = eventBlock.split("\n");
        const eventName = eventLines.find((line) => line.startsWith("event:"))?.slice(6).trim();
        const dataLine = eventLines.find((line) => line.startsWith("data:"))?.slice(5).trim();
        if (!eventName || !dataLine) continue;
        const data = JSON.parse(dataLine) as ExecuteEvent;
        if (eventName === "approval_required") {
          alert(`Approval required: ${data.approvalId} (${data.risk})`);
        }
      }
    }

    setLoopPhase("verify");
    if (stepIndex !== undefined) {
      setPlanSteps((prev) => prev.map((s, i) =>
        i === stepIndex ? { ...s, status: "completed" as const } : s
      ));
    }

    await new Promise((r) => setTimeout(r, 200));
    setLoopPhase("idle");
    await refreshState();
  }

  async function executeAllProposed() {
    for (let i = 0; i < proposed.length; i++) {
      const call = proposed[i];
      await executeToolCall(call.toolName, call.input, i);
    }
    setProposed([]);
  }

  function handleQuickAction(prompt: string) {
    if (!supportingUiReady) {
      setSupportingUiReady(true);
    }
    setMessage(prompt);
    void sendMessage(prompt);
  }

  async function approveAction(status: "approve" | "deny") {
    if (!pendingApproval) return;
    try {
      await fetch(pilotApiUrl(`/api/approvals/${pendingApproval.approvalId}/${status}`), {
        method: "POST",
        headers: getAuthHeader(),
      });
    } catch { /* silent */ }
    setPendingApproval(null);
  }

  const hasStarted = chatMessages.length > 0 || streamingText.length > 0;
  const modeInfo = MODE_CONFIG[mode];

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative" }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag overlay */}
      {isDragging && (
        <div style={{
          position: "absolute", inset: 0, background: "rgba(56, 189, 248, 0.08)",
          border: "2px dashed var(--accent)", borderRadius: 12, zIndex: 50,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 600, color: "var(--accent)", pointerEvents: "none",
        }}>
          Drop files to attach
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={ALLOWED_EXTENSIONS}
        onChange={handleFileInputChange}
        style={{ display: "none" }}
      />

      {/* ── Top Bar: Status + Loop + Mode ── */}
      <div className="console-topbar">
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0, letterSpacing: -0.4, color: "var(--text)" }}>Console</h1>
            <div style={{ fontSize: 11, color: "var(--fg-dim)", fontFamily: "var(--mono)", display: "flex", gap: 6, alignItems: "center", marginTop: 1 }}>
              <span>{environment}</span>
              <span style={{ opacity: 0.3 }}>·</span>
              <span>{runnerType}</span>
              {activeProvider && (
                <>
                  <span style={{ opacity: 0.3 }}>·</span>
                  <ProviderBadge tag={activeProvider.tag} />
                </>
              )}
            </div>
          </div>
          <IntelligenceLoopIndicator currentPhase={loopPhase} />
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Mode selector */}
          <div className="mode-selector">
            {(Object.keys(MODE_CONFIG) as ExecMode[]).map((m) => (
              <button
                key={m}
                className={`mode-btn ${mode === m ? "mode-btn-active" : ""}`}
                onClick={() => setMode(m)}
                title={MODE_CONFIG[m].description}
              >
                <span>{MODE_CONFIG[m].label}</span>
              </button>
            ))}
          </div>

          <select
            value={environment}
            onChange={(e) => setEnvironment(e.target.value as typeof environment)}
            style={{ fontSize: 11, padding: "5px 8px", borderRadius: 6 }}
          >
            <option value="dev">Dev</option>
            <option value="stage">Stage</option>
            <option value="staging">Staging</option>
            <option value="prod">Prod</option>
            <option value="test">Test</option>
          </select>

          <select
            value={runnerType}
            onChange={(e) => setRunnerType(e.target.value as "local" | "server")}
            style={{ fontSize: 11, padding: "5px 8px", borderRadius: 6 }}
          >
            <option value="local">Local</option>
            <option value="server">Server</option>
          </select>

          {/* Export conversation */}
          <button
            onClick={exportConversation}
            disabled={!chatMessages.length}
            title="Export conversation as Markdown"
            style={{
              fontSize: 11,
              padding: "5px 10px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "transparent",
              color: chatMessages.length ? "var(--text-secondary)" : "var(--muted)",
              cursor: chatMessages.length ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              gap: 4,
              transition: "var(--transition)",
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export
          </button>
        </div>
      </div>

      {/* ── System Status (always visible at top) ── */}
      {!hasStarted && !showStatusBrief && shouldRenderSupportingUi && <SystemStatusPanel />}

      {/* ── Status Brief (on vague input) ── */}
      {showStatusBrief && shouldRenderSupportingUi && (
        <StatusBriefPanel onDismiss={() => setShowStatusBrief(false)} />
      )}

      {/* ── Pending Approval Banner ── */}
      {pendingApproval && (
        <div style={{
          padding: "12px 18px", borderRadius: 10, background: "rgba(251, 191, 36, 0.06)",
          border: "1px solid var(--warn)", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--warn)" }}>
              Approval Required — {pendingApproval.toolName}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
              Expires: {new Date(pendingApproval.expiresAt).toLocaleTimeString()}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary btn-sm" onClick={() => void approveAction("approve")} style={{ background: "var(--ok)" }}>
              Approve
            </button>
            <button className="btn-ghost btn-sm" onClick={() => void approveAction("deny")}>
              Deny
            </button>
          </div>
        </div>
      )}

      {/* ── Main Content Grid ── */}
      <div className="console-grid">
        {/* ── Left: Chat + Intelligence ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Chat Panel */}
          <section className="panel" style={{ display: "flex", flexDirection: "column", minHeight: hasStarted ? 520 : 420 }}>
            {/* Chat messages area */}
            <div style={{ flex: 1, overflowY: "auto", padding: hasStarted ? "16px 20px" : "24px 20px" }}>
              {!hasStarted ? (
                <QuickActions onSelect={handleQuickAction} />
              ) : (
                <>
                  {chatMessages.map((item) => {
                    const isUser = item.role === "user";
                    return (
                      <div
                        key={item.id}
                        className="fade-in"
                        style={{
                          marginBottom: 18,
                          display: "flex",
                          flexDirection: "column",
                          alignItems: isUser ? "flex-end" : "flex-start",
                        }}
                      >
                        {/* Role label */}
                        <div style={{
                          fontSize: 10, fontWeight: 600, color: "var(--fg-dim)",
                          textTransform: "uppercase", letterSpacing: 0.6,
                          marginBottom: 5, padding: "0 4px",
                        }}>
                          {isUser ? "You" : "MigraPilot"}
                        </div>
                        <div style={{
                          maxWidth: "85%",
                          padding: "14px 18px",
                          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                          background: isUser
                            ? "linear-gradient(135deg, rgba(56, 189, 248, 0.1), rgba(129, 140, 248, 0.08))"
                            : "var(--panel)",
                          border: `1px solid ${isUser ? "rgba(56, 189, 248, 0.15)" : "var(--line)"}`,
                          fontSize: 13,
                          lineHeight: 1.65,
                          backdropFilter: "blur(8px)",
                        }}>
                          {isUser ? (
                            <span style={{ whiteSpace: "pre-wrap" }}>{item.content}</span>
                          ) : (
                            <MarkdownMessage text={item.content} />
                          )}
                        </div>
                        <div style={{
                          fontSize: 10, color: "var(--fg-dim)", marginTop: 4,
                          padding: "0 4px", fontFamily: "var(--mono)", opacity: 0.7,
                        }}>
                          {new Date(item.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                    );
                  })}

                  {/* Streaming response (live) */}
                  {(streamingText || sending) && (
                    <div className="fade-in" style={{ marginBottom: 18, display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                      <div style={{
                        fontSize: 10, fontWeight: 600, color: "var(--fg-dim)",
                        textTransform: "uppercase", letterSpacing: 0.6,
                        marginBottom: 5, padding: "0 4px",
                        display: "flex", alignItems: "center", gap: 6,
                      }}>
                        MigraPilot {activeProvider && <ProviderBadge tag={activeProvider.tag} />}
                      </div>
                      <div style={{
                        maxWidth: "85%",
                        padding: "14px 18px",
                        borderRadius: "16px 16px 16px 4px",
                        background: "var(--panel)",
                        border: "1px solid var(--line)",
                        fontSize: 13,
                        lineHeight: 1.65,
                        backdropFilter: "blur(8px)",
                      }}>
                        {streamingText ? (
                          <MarkdownMessage text={streamingText} />
                        ) : (
                          <span style={{ color: "var(--fg-dim)", fontStyle: "italic" }}>Thinking…</span>
                        )}
                        <span style={{
                          display: "inline-block", width: 6, height: 14,
                          background: "var(--accent)", marginLeft: 2,
                          animation: "blink 1s step-end infinite", verticalAlign: "text-bottom",
                          borderRadius: 1, opacity: 0.8,
                        }} />
                      </div>

                      {/* Tool calls during streaming */}
                      {streamingTools.length > 0 && (
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4, width: "100%", maxWidth: "88%" }}>
                          {streamingTools.map((t, i) => {
                            const hasOutput = !!(t.status === "completed" && t.payload?.result);
                            const resultText = hasOutput ? (typeof t.payload!.result === "string" ? t.payload!.result : JSON.stringify(t.payload!.result, null, 2)) : null;
                            const truncated = resultText && resultText.length > 600 ? resultText.slice(0, 600) + "\n…" : resultText;
                            return (
                              <details key={i} style={{
                                borderRadius: 6, background: "rgba(255,255,255,0.03)",
                                border: "1px solid var(--line)", fontSize: 11, fontFamily: "var(--mono)",
                              }}>
                                <summary style={{
                                  display: "flex", alignItems: "center", gap: 6, padding: "4px 10px",
                                  cursor: "pointer", listStyle: "none", userSelect: "none",
                                }}>
                                  <span style={{ color: t.status === "completed" ? "var(--ok)" : "var(--accent)", fontSize: 10 }}>
                                    {t.status === "completed" ? "✓" : "⟳"}
                                  </span>
                                  <span style={{ color: "var(--text)" }}>{t.toolName ?? "tool"}</span>
                                  <span style={{ color: "var(--muted)", marginLeft: "auto" }}>{t.status ?? "running"}</span>
                                  {hasOutput && <span style={{ color: "var(--fg-dim)", fontSize: 9 }}>▸ output</span>}
                                </summary>
                                {truncated && (
                                  looksLikeDiff(truncated) ? (
                                    <div style={{ borderTop: "1px solid var(--line)" }}>
                                      <InlineDiff diff={truncated} />
                                    </div>
                                  ) : (
                                    <pre style={{
                                      padding: "6px 10px", margin: 0, fontSize: 10,
                                      maxHeight: 200, overflow: "auto", whiteSpace: "pre-wrap",
                                      wordBreak: "break-word", color: "var(--text-secondary)",
                                      borderTop: "1px solid var(--line)", background: "rgba(0,0,0,0.15)",
                                    }}>
                                      {truncated}
                                    </pre>
                                  )
                                )}
                              </details>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            {/* File chips row */}
            {pendingFiles.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "6px 16px 0" }}>
                {pendingFiles.map((f, i) => {
                  const key = f.name + f.size;
                  const preview = filePreviews.get(key);
                  return (
                    <div key={key} style={{
                      display: "flex", alignItems: "center", gap: 4, padding: "3px 8px 3px 6px",
                      borderRadius: 6, background: "var(--panel-2)", border: "1px solid var(--line)",
                      fontSize: 11, color: "var(--text)", maxWidth: 200,
                    }}>
                      {preview ? (
                        <img src={preview} alt="" style={{ width: 18, height: 18, borderRadius: 3, objectFit: "cover" }} />
                      ) : isImageFile(f) ? (
                        <ImageIcon />
                      ) : (
                        <FileDocIcon />
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {f.name}
                      </span>
                      <span style={{ color: "var(--muted)", fontSize: 10 }}>{formatFileSize(f.size)}</span>
                      <button
                        onClick={() => removeFile(i)}
                        style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--muted)", display: "flex", alignItems: "center", padding: 0 }}
                      >
                        <CloseChipIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Slash command hints */}
            {message.startsWith("/") && !message.includes(" ") && (
              <div style={{
                padding: "6px 16px", borderBottom: "1px solid var(--line)",
                display: "flex", flexWrap: "wrap", gap: 4, background: "rgba(0,0,0,0.2)",
              }}>
                {[
                  { cmd: "/read", hint: "Read a file" },
                  { cmd: "/search", hint: "Search codebase" },
                  { cmd: "/fix", hint: "Fix errors" },
                  { cmd: "/explain", hint: "Explain code" },
                  { cmd: "/test", hint: "Run tests" },
                  { cmd: "/health", hint: "Code health" },
                  { cmd: "/errors", hint: "TypeScript errors" },
                  { cmd: "/security", hint: "Security scan" },
                  { cmd: "/diff", hint: "Git diff" },
                  { cmd: "/deploy", hint: "Deploy" },
                ].filter(c => c.cmd.startsWith(message.toLowerCase())).map(c => (
                  <button
                    key={c.cmd}
                    onClick={() => setMessage(c.cmd + " ")}
                    style={{
                      background: "rgba(56,189,248,0.08)", border: "1px solid rgba(56,189,248,0.15)",
                      borderRadius: 4, padding: "2px 8px", fontSize: 11, cursor: "pointer",
                      color: "var(--accent)", fontFamily: "var(--mono)",
                    }}
                  >
                    <strong>{c.cmd}</strong> <span style={{ color: "var(--muted)", fontSize: 10 }}>{c.hint}</span>
                  </button>
                ))}
              </div>
            )}

            {/* Input bar */}
            <div className="console-input-bar">
              {/* Attach button */}
              <button
                onClick={handleFilePick}
                title="Attach files (images, PDF, JSON, CSV)"
                style={{
                  background: "transparent", border: "none", borderRadius: 8,
                  width: 38, height: 38, display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: "pointer", color: pendingFiles.length > 0 ? "var(--accent)" : "var(--muted)",
                  flexShrink: 0, transition: "color 0.15s",
                }}
              >
                <AttachIcon />
              </button>

              <div className="console-input-wrapper">
                <textarea
                  ref={textareaRef}
                  placeholder={
                    mode === "chat" ? "Ask MigraPilot anything… paste images, drag files"
                    : mode === "plan" ? "Describe what you want to do (plan only)… paste images, drag files"
                    : "Tell MigraPilot what to do… paste images, drag files, / for commands"
                  }
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onPaste={handlePaste}
                  style={{
                    flex: 1,
                    padding: "12px 16px",
                    background: "transparent",
                    border: "none",
                    outline: "none",
                    color: "var(--text)",
                    fontFamily: "var(--sans)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    resize: "none",
                    minHeight: 44,
                    maxHeight: 120,
                  }}
                  rows={1}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px" }}>
                  {mode !== "chat" && (
                    <span style={{
                      fontSize: 10, color: "var(--muted)", fontFamily: "var(--mono)",
                      padding: "2px 6px", background: "rgba(255,255,255,0.04)", borderRadius: 4,
                    }}>
                      {modeInfo.label}
                    </span>
                  )}
                </div>
              </div>
              {sending ? (
                <button
                  className="btn-primary console-send-btn"
                  onClick={() => void handleStop()}
                  title="Stop generation"
                  style={{ background: "var(--danger)", borderColor: "var(--danger)" }}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <rect x="3" y="3" width="10" height="10" rx="2"/>
                  </svg>
                </button>
              ) : (
                <button
                  className="btn-primary console-send-btn"
                  onClick={() => void sendMessage()}
                  disabled={!message.trim()}
                  style={{ opacity: !message.trim() ? 0.4 : 1 }}
                >
                  <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1 1.5L15 8L1 14.5V9L10 8L1 7V1.5Z"/>
                  </svg>
                </button>
              )}
            </div>
          </section>

          {/* Reasoning + Plan (below chat when active) */}
          {lastReasoning && shouldRenderSupportingUi && (
            <ReasoningCard {...lastReasoning} />
          )}

          {planSteps.length > 0 && shouldRenderSupportingUi && (
            <PlanViewer steps={planSteps} title="Execution Plan" />
          )}
        </div>

        {/* ── Right: Proposed Actions + Run Timeline ── */}
        {shouldRenderSupportingUi ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <ConsoleSideRail
              proposed={proposed}
              runs={runs}
              onExecuteAllProposed={() => void executeAllProposed()}
              onExecuteToolCall={(toolName, input, stepIndex) => void executeToolCall(toolName, input, stepIndex)}
              onRefreshState={() => void refreshState()}
            />
            <FileTreePanel onFileClick={(path) => setMessage((prev) => prev ? `${prev} @${path}` : `@${path} `)} />
          </div>
        ) : null}
      </div>

      {/* Blink animation for streaming cursor */}
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}}`}</style>
    </div>
  );
}
