"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { ModeSwitch, type PilotMode, getModeColor } from "./ModeSwitch";
import { CommandPalette, type PaletteCommand } from "./CommandPalette";
import { ApprovalModal } from "./ApprovalModal";
import { DiffViewer } from "./DiffViewer";
import { type PolicyDecision } from "./PolicyTimeline";
import { type EngineeringState } from "./EngineeringStatePanel";
import { StatusPills, type SystemMode } from "./StatusPills";
import { EmptyStateDashboard } from "./EmptyStateDashboard";
import { ReadOnlyBanner, type ReadOnlyInfo } from "./ReadOnlyBanner";
import { AuthGate } from "./AuthGate";
import { VerificationCard, type VerificationData, type VerificationAttempt } from "./VerificationCard";
import { RightDrawer } from "./RightDrawer";

/* ── Types ── */
type Message = { id: string; role: string; contentJson: any; createdAt: string };
type ToolCall = {
  id: string;
  toolName: string;
  argsJson: any;
  status: string;
  startedAt: string;
  endedAt?: string;
  result?: { ok: boolean; resultJson?: any; errorJson?: any };
};
type Run = { id: string; status: string; startedAt: string; toolCalls: ToolCall[] };
type Conversation = { id: string; createdAt: string; messages: Message[]; runs: Run[] };

const API_BASE = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

/* ── Helpers ── */
function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}
function hasToken(): boolean {
  return typeof window !== "undefined" && Boolean(localStorage.getItem("token"));
}
function redact(v: unknown): unknown {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(redact);
  const o: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>))
    o[k] = /(secret|token|password|apiKey|authorization)/i.test(k) ? "•••" : redact(val);
  return o;
}
function timeAgo(d: string) {
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(d).toLocaleDateString();
}
function statusColor(s: string) {
  if (/completed|success/i.test(s)) return "var(--success)";
  if (/failed|error/i.test(s)) return "var(--danger)";
  if (/pending|running|started/i.test(s)) return "var(--warning)";
  return "var(--fg-dim)";
}

/* ── Provider badge ── */
function ProviderBadge({ tag }: { tag: string }) {
  const map: Record<string, { icon: string; color: string; label: string }> = {
    local:  { icon: "\uD83D\uDFE2", color: "#4ec9b0", label: "Local" },
    sonnet: { icon: "\uD83D\uDFE1", color: "#569cd6", label: "Sonnet" },
    opus:   { icon: "\uD83D\uDD34", color: "#c586c0", label: "Opus" },
  };
  const info = map[tag] ?? { icon: "\u26AA", color: "#888", label: tag };
  return (
    <span style={{ fontSize: 10, padding: "1px 5px", borderRadius: 3, border: `1px solid ${info.color}`, color: info.color, fontWeight: 600 }}>
      {info.icon} {info.label}
    </span>
  );
}

/* ── Inline SVG icons (no deps) ── */
const CopilotIcon = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
    <path d="M8 1L2 4.5V11.5L8 15L14 11.5V4.5L8 1Z" stroke="#0078d4" strokeWidth="1.2" fill="none"/>
    <path d="M8 5.5V10.5M5.5 7L8 5.5L10.5 7" stroke="#0078d4" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const UserIcon = () => (
  <svg width="20" height="20" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="5.5" r="3" stroke="#858585" strokeWidth="1.2"/>
    <path d="M2.5 14C2.5 11 5 9 8 9C11 9 13.5 11 13.5 14" stroke="#858585" strokeWidth="1.2" strokeLinecap="round"/>
  </svg>
);
const ToolIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M14.3 1.7L12 4L10.6 4L9.5 2.9L11.2 1.2C10 .7 8.5.9 7.5 1.9C6.3 3.1 6.2 5 7.2 6.3L1.5 12L4 14.5L9.7 8.8C11 9.8 12.9 9.7 14.1 8.5C15.1 7.5 15.3 6 14.8 4.8L12.9 6.7H11.5L10.4 5.6V4.2L12.3 2.3" stroke="#569cd6" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);
const SendIcon = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
    <path d="M1 1.5L15 8L1 14.5V9L10 8L1 7V1.5Z"/>
  </svg>
);
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
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 2V14M2 8H14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg>
);

/* ── Styles as objects ── */
const S = {
  shell: { display: "flex", height: "100vh", overflow: "hidden" } as const,

  /* ── Sidebar ── */
  sidebar: {
    width: 260, minWidth: 260, maxWidth: 260, display: "flex", flexDirection: "column" as const,
    background: "var(--bg-sidebar)", borderRight: "1px solid var(--border)",
  },
  sidebarHeader: {
    padding: "12px 14px 8px", display: "flex", alignItems: "center", gap: 8,
    borderBottom: "1px solid var(--border)",
  },
  sidebarTitle: { fontSize: 12, fontWeight: 600, color: "var(--fg-bright)", letterSpacing: ".3px", textTransform: "uppercase" as const, flex: 1 },
  newBtn: {
    background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", cursor: "pointer",
    color: "var(--fg)", display: "flex", alignItems: "center", gap: 4, fontSize: 12,
  },
  searchBox: {
    margin: "8px 10px", padding: "5px 10px", background: "var(--bg-input)", border: "1px solid var(--border)",
    borderRadius: 4, color: "var(--fg)", fontSize: 12, outline: "none", width: "calc(100% - 20px)",
  },
  convoList: { flex: 1, overflowY: "auto" as const, padding: "0 6px 8px" },
  convoItem: (active: boolean) => ({
    width: "100%", textAlign: "left" as const, background: active ? "var(--bg-active)" : "transparent",
    border: "none", borderRadius: 6, padding: "8px 10px", margin: "2px 0", cursor: "pointer",
    color: active ? "var(--fg-bright)" : "var(--fg)", display: "block",
  }),
  convoDate: { fontSize: 11, color: "var(--fg-dim)", marginBottom: 2 },
  convoSnip: { fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, lineHeight: "1.4" },

  /* ── Main chat ── */
  main: { flex: 1, display: "flex", flexDirection: "column" as const, minWidth: 0 },
  topBar: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  topTitle: { fontSize: 13, fontWeight: 600, color: "var(--fg-bright)", display: "flex", alignItems: "center", gap: 8 },
  dryLabel: { fontSize: 12, display: "flex", alignItems: "center", gap: 6, color: "var(--fg-dim)", cursor: "pointer", userSelect: "none" as const },
  dryCheck: { accentColor: "var(--accent)" },

  msgArea: { flex: 1, overflowY: "auto" as const, padding: "12px 0" },
  msgRow: (isUser: boolean) => ({
    display: "flex", gap: 10, padding: "10px 20px", alignItems: "flex-start",
    background: isUser ? "transparent" : "var(--bg-sidebar)",
  }),
  avatar: {
    width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, background: "var(--bg-active)",
  },
  msgBody: { flex: 1, minWidth: 0 },
  msgRole: { fontSize: 11, fontWeight: 600, color: "var(--fg-dim)", marginBottom: 2, textTransform: "uppercase" as const, letterSpacing: ".4px" },
  msgText: { fontSize: 13, lineHeight: "1.55", color: "var(--fg-bright)", whiteSpace: "pre-wrap" as const, wordBreak: "break-word" as const },

  /* ── Tool card inline in chat ── */
  toolCard: {
    margin: "6px 0", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden",
    background: "var(--bg-input)",
  },
  toolHeader: (ok: boolean | null) => ({
    display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", fontSize: 12, fontWeight: 600,
    color: ok === true ? "var(--success)" : ok === false ? "var(--danger)" : "var(--info)",
    borderBottom: "1px solid var(--border)",
  }),
  toolStatus: { marginLeft: "auto", fontWeight: 400, fontSize: 11 },
  toolDetails: { padding: 0, margin: 0, borderTop: "none" },
  toolSummary: { padding: "6px 12px", cursor: "pointer", fontSize: 12, color: "var(--fg-dim)", listStyle: "none", userSelect: "none" as const },
  toolPre: {
    margin: 0, padding: "8px 12px", fontSize: 12, fontFamily: "var(--mono)", color: "var(--fg)",
    whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const, background: "var(--bg)", maxHeight: 260, overflowY: "auto" as const,
  },
  copyBtn: {
    display: "block", width: "100%", padding: "5px 0", background: "none", border: "none",
    borderTop: "1px solid var(--border)", color: "var(--fg-dim)", cursor: "pointer", fontSize: 11,
    textAlign: "center" as const,
  },

  /* ── Approval card ── */
  approvalCard: {
    margin: "8px 20px", border: "1px solid var(--warning)", borderRadius: 8, padding: "12px 16px",
    background: "rgba(220,220,170,0.06)",
  },
  approvalTitle: { fontSize: 13, fontWeight: 600, color: "var(--warning)", marginBottom: 4 },
  approvalExpiry: { fontSize: 11, color: "var(--fg-dim)", marginBottom: 10 },
  approvalBtns: { display: "flex", gap: 8 },
  approvalBtn: (approve: boolean) => ({
    padding: "5px 16px", borderRadius: 4, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600,
    background: approve ? "var(--accent)" : "var(--bg-active)", color: approve ? "#fff" : "var(--fg)",
  }),

  /* ── Auth banner ── */
  authBanner: {
    margin: "0 20px 8px", padding: "10px 14px", borderRadius: 6, fontSize: 12,
    background: "rgba(220,220,170,0.08)", border: "1px solid var(--warning)", color: "var(--warning)",
  },

  /* ── Streaming indicator ── */
  cursor: { display: "inline-block", width: 7, height: 14, background: "var(--fg-dim)", marginLeft: 2, animation: "blink 1s step-end infinite" },

  /* ── Input area ── */
  inputArea: {
    borderTop: "1px solid var(--border)", padding: "10px 16px", display: "flex", gap: 8,
    alignItems: "flex-end", flexShrink: 0, background: "var(--bg)",
  },
  inputWrap: {
    flex: 1, display: "flex", background: "var(--bg-input)", border: "1px solid var(--border)",
    borderRadius: 8, overflow: "hidden", alignItems: "flex-end",
  },
  textarea: {
    flex: 1, padding: "10px 14px", background: "transparent", border: "none", outline: "none",
    color: "var(--fg-bright)", fontFamily: "var(--font)", fontSize: 13, lineHeight: "1.45",
    resize: "none" as const, minHeight: 40, maxHeight: 160,
  },
  sendBtn: (active: boolean) => ({
    background: active ? "var(--accent)" : "var(--bg-active)", border: "none", borderRadius: 6,
    width: 34, height: 34, display: "flex", alignItems: "center", justifyContent: "center",
    cursor: active ? "pointer" : "default", color: active ? "#fff" : "var(--fg-dim)",
    flexShrink: 0, transition: "background .15s",
  }),

  /* ── Attach button ── */
  attachBtn: {
    background: "transparent", border: "none", borderRadius: 6, width: 34, height: 34,
    display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
    color: "var(--fg-dim)", flexShrink: 0, transition: "color .15s",
  } as React.CSSProperties,

  /* ── File chips row ── */
  fileChipsRow: {
    display: "flex", gap: 6, flexWrap: "wrap" as const, padding: "6px 16px 0",
  },
  fileChip: {
    display: "flex", alignItems: "center", gap: 4, padding: "3px 8px 3px 6px",
    borderRadius: 6, background: "var(--bg-active)", border: "1px solid var(--border)",
    fontSize: 11, color: "var(--fg)", maxWidth: 200,
  },
  fileChipName: {
    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" as const, flex: 1,
  },
  fileChipClose: {
    background: "transparent", border: "none", cursor: "pointer", color: "var(--fg-dim)",
    display: "flex", alignItems: "center", padding: 0, borderRadius: 3,
  } as React.CSSProperties,

  /* ── Drag overlay ── */
  dragOverlay: {
    position: "absolute" as const, inset: 0, background: "rgba(0,120,212,0.12)",
    border: "2px dashed var(--accent)", borderRadius: 8, zIndex: 50,
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, fontWeight: 600, color: "var(--accent)", pointerEvents: "none" as const,
  },
};

/* ── Markdown renderer for assistant messages ── */
function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="md-msg" style={{ fontSize: 13, lineHeight: "1.55", color: "var(--fg-bright)", wordBreak: "break-word" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const inline = !match && !String(children).includes("\n");
            if (inline) {
              return <code style={{ background: "var(--bg-active)", padding: "1px 5px", borderRadius: 3, fontSize: 12, fontFamily: "var(--mono)" }} {...rest}>{children}</code>;
            }
            return (
              <SyntaxHighlighter
                style={vscDarkPlus as any}
                language={match?.[1] ?? "text"}
                PreTag="div"
                customStyle={{ margin: "8px 0", borderRadius: 6, fontSize: 12, padding: 12 }}
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            );
          },
          p({ children }) { return <p style={{ margin: "6px 0" }}>{children}</p>; },
          ul({ children }) { return <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ul>; },
          ol({ children }) { return <ol style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ol>; },
          li({ children }) { return <li style={{ marginBottom: 2 }}>{children}</li>; },
          h1({ children }) { return <h1 style={{ fontSize: 18, fontWeight: 700, margin: "12px 0 6px", color: "var(--fg-bright)" }}>{children}</h1>; },
          h2({ children }) { return <h2 style={{ fontSize: 16, fontWeight: 700, margin: "10px 0 4px", color: "var(--fg-bright)" }}>{children}</h2>; },
          h3({ children }) { return <h3 style={{ fontSize: 14, fontWeight: 700, margin: "8px 0 4px", color: "var(--fg-bright)" }}>{children}</h3>; },
          table({ children }) { return <table style={{ borderCollapse: "collapse", margin: "8px 0", fontSize: 12, width: "100%" }}>{children}</table>; },
          th({ children }) { return <th style={{ border: "1px solid var(--border)", padding: "4px 8px", background: "var(--bg-active)", fontWeight: 600, textAlign: "left" }}>{children}</th>; },
          td({ children }) { return <td style={{ border: "1px solid var(--border)", padding: "4px 8px" }}>{children}</td>; },
          a({ children, href }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", textDecoration: "underline" }}>{children}</a>; },
          blockquote({ children }) { return <blockquote style={{ borderLeft: "3px solid var(--accent)", paddingLeft: 12, margin: "6px 0", color: "var(--fg-dim)" }}>{children}</blockquote>; },
          strong({ children }) { return <strong style={{ fontWeight: 700, color: "var(--fg-bright)" }}>{children}</strong>; },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ── Allowed file types for upload ── */
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf", "application/json", "text/csv", "text/yaml", "application/x-yaml"];
const ALLOWED_EXTENSIONS = ".jpg,.jpeg,.png,.webp,.pdf,.json,.csv,.yaml,.yml";
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_FILES = 6;

function isImageFile(f: File) { return f.type.startsWith("image/"); }
function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

/* ── Component ── */
export function PilotShell() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [query, setQuery] = useState("");
  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [streamingTools, setStreamingTools] = useState<any[]>([]);
  const [sending, setSending] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [pendingApproval, setPendingApproval] = useState<{ toolName: string; approvalId: string; expiresAt: string; argsJson?: any; blastRadius?: string; rollbackHint?: string } | null>(null);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [activeProvider, setActiveProvider] = useState<{ tag: string; model: string; reason: string } | null>(null);
  const [pilotMode, setPilotMode] = useState<PilotMode>("operator");
  const [showPalette, setShowPalette] = useState(false);
  const [paletteFilter, setPaletteFilter] = useState("");
  const [showDiff, setShowDiff] = useState<{ diff: string; title: string } | null>(null);
  const [sourceCitations, setSourceCitations] = useState<Array<{ source: string; content: string; score: number; tags: string[] }>>([]);
  const [showSources, setShowSources] = useState(false);
  const [policyDecisions, setPolicyDecisions] = useState<PolicyDecision[]>([]);
  const [showPolicy, setShowPolicy] = useState(false);
  const [engState, setEngState] = useState<EngineeringState | null>(null);
  const [showEngState, setShowEngState] = useState(false);

  /* ── New V2 state ── */
  const [systemMode, setSystemMode] = useState<SystemMode>("normal");
  const [readOnlyInfo, setReadOnlyInfo] = useState<ReadOnlyInfo | null>(null);
  const [verifications, setVerifications] = useState<Map<string, VerificationData>>(new Map());
  const [isAuthenticated, setIsAuthenticated] = useState(hasToken());
  const [operatorInfo, setOperatorInfo] = useState<{ email: string; role: string } | null>(null);
  const [showOperatorMenu, setShowOperatorMenu] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* ── File attachment state ── */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [filePreviews, setFilePreviews] = useState<Map<string, string>>(new Map());

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
  }, []);

  /* ── Data loading ── */
  async function loadConversations(search = "") {
    if (!hasToken()) { setConversations([]); setAuthHint("Set a JWT in localStorage to get started."); setIsAuthenticated(false); return; }
    setIsAuthenticated(true);
    const r = await fetch(`${API_BASE}/api/pilot/conversations?search=${encodeURIComponent(search)}`, { headers: getAuthHeader() });
    if (r.status === 401) { setConversations([]); setAuthHint("Token expired — set a fresh JWT and reload."); setIsAuthenticated(false); return; }
    const d = await r.json(); setAuthHint(null); setConversations(d.items ?? []);
    if (!selectedId && d.items?.[0]?.id) setSelectedId(d.items[0].id);
  }

  function handleTokenSet(_token: string) {
    setIsAuthenticated(true);
    setAuthHint(null);
    loadConversations();
    fetchOperator();
  }

  async function fetchOperator() {
    if (!hasToken()) return;
    try {
      const r = await fetch(`${API_BASE}/api/auth/me`, { headers: getAuthHeader() });
      if (r.ok) {
        const d = await r.json();
        setOperatorInfo({ email: d.operator?.email ?? "unknown", role: d.operator?.role ?? "operator" });
      }
    } catch { /* offline */ }
  }
  async function loadConversation(id: string) {
    if (!hasToken()) return;
    const r = await fetch(`${API_BASE}/api/pilot/conversations/${id}`, { headers: getAuthHeader() });
    if (!r.ok) return;
    setConversation((await r.json()).conversation);
  }

  useEffect(() => { loadConversations(); fetchOperator(); }, []);
  useEffect(() => { if (selectedId) loadConversation(selectedId); }, [selectedId]);
  useEffect(scrollToEnd, [conversation, streamingText, streamingTools]);

  /* ── Actions ── */
  async function newConversation() {
    if (!hasToken()) { setAuthHint("Set a JWT first."); return; }
    const r = await fetch(`${API_BASE}/api/pilot/conversations`, { method: "POST", headers: { "content-type": "application/json", ...getAuthHeader() }, body: "{}" });
    if (r.status === 401) { setAuthHint("Token expired."); return; }
    const d = await r.json(); await loadConversations(); setSelectedId(d.conversation.id);
    setConversation(null); setStreamingText(""); setStreamingTools([]);
  }

  async function sendMessage() {
    const msg = input.trim();
    if (!msg || sending) return;
    if (!hasToken()) { setAuthHint("Set a JWT first."); return; }
    setSending(true); setStreamingText(""); setStreamingTools([]); setPendingApproval(null); setActiveProvider(null); setSourceCitations([]); setPolicyDecisions([]); setVerifications(new Map());

    let fetchOpts: RequestInit;
    if (pendingFiles.length > 0) {
      // Use multipart FormData when files are attached
      const form = new FormData();
      if (selectedId) form.append("conversationId", selectedId);
      form.append("message", msg);
      form.append("dryRun", String(dryRun));
      for (const f of pendingFiles) form.append("files", f);
      fetchOpts = { method: "POST", headers: { ...getAuthHeader() }, body: form };
    } else {
      fetchOpts = {
        method: "POST", headers: { "content-type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ conversationId: selectedId, message: msg, dryRun }),
      };
    }

    const r = await fetch(`${API_BASE}/api/pilot/chat/stream`, fetchOpts);
    if (r.status === 401) { setAuthHint("Token expired."); setSending(false); return; }
    setInput(""); setPendingFiles([]); filePreviews.forEach(url => URL.revokeObjectURL(url)); setFilePreviews(new Map());

    const reader = r.body?.getReader(); if (!reader) { setSending(false); return; }
    let buf = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += new TextDecoder().decode(value, { stream: true });
      const chunks = buf.split("\n\n"); buf = chunks.pop() ?? "";
      for (const c of chunks) {
        const lines = c.split("\n");
        const ev = lines.find(l => l.startsWith("event:"))?.slice(6).trim();
        const dr = lines.find(l => l.startsWith("data:"))?.slice(5).trim();
        if (!ev || !dr) continue;
        try {
          const p = JSON.parse(dr);
          if (ev === "conversation" && !selectedId) setSelectedId(p.conversationId);
          if (ev === "provider") { setActiveProvider({ tag: p.tag, model: p.model, reason: p.reason }); }
          if (ev === "token") { setStreamingText(prev => prev + p.text); scrollToEnd(); }
          if (ev === "tool") {
            setStreamingTools(prev => [...prev, p]);
            const err = p?.payload?.error;
            if (err?.code === "APPROVAL_REQUIRED" && err?.approvalRequest) {
              setPendingApproval({
                ...err.approvalRequest,
                argsJson: p?.payload?.args,
                blastRadius: p?.payload?.blastRadius,
                rollbackHint: p?.payload?.rollbackHint,
              });
            }
            scrollToEnd();
          }
          if (ev === "policy_decision") {
            setPolicyDecisions(prev => [...prev, {
              ruleId: p.ruleId,
              verdict: p.verdict,
              reason: p.reason,
              toolName: p.toolName,
              ts: p.ts ?? new Date().toISOString(),
            }]);
          }
          if (ev === "memory_update") {
            if (p.state) setEngState(p.state);
          }
          /* ── Verification events (V2) ── */
          if (ev === "verification") {
            setVerifications(prev => {
              const next = new Map(prev);
              const existing = next.get(p.toolCallId);
              next.set(p.toolCallId, {
                toolCallId: p.toolCallId,
                toolName: p.toolName ?? existing?.toolName ?? "unknown",
                verifyWith: p.verifyWith ?? existing?.verifyWith ?? "unknown",
                strictness: p.strictness ?? existing?.strictness ?? "soft",
                status: p.verified ? "verified" : p.status === "started" ? "verifying" : "failed",
                attempts: existing?.attempts ?? [],
                currentAttempt: p.attempts ?? existing?.currentAttempt ?? 0,
                maxAttempts: p.maxAttempts ?? existing?.maxAttempts ?? 5,
                durationMs: p.durationMs ?? existing?.durationMs,
                summary: p.summary ?? existing?.summary,
                startedAt: p.startedAt ?? existing?.startedAt,
                nextAttemptAt: p.nextAttemptAt ?? existing?.nextAttemptAt,
              });
              return next;
            });
          }
          if (ev === "verification_attempt") {
            setVerifications(prev => {
              const next = new Map(prev);
              const existing = next.get(p.toolCallId);
              if (existing) {
                const attempt: VerificationAttempt = {
                  attempt: p.attempt ?? existing.attempts.length + 1,
                  maxAttempts: p.maxAttempts ?? existing.maxAttempts,
                  waitMs: p.waitMs,
                  status: p.passed ? "success" : p.attempt < (p.maxAttempts ?? existing.maxAttempts) ? "waiting" : "failed",
                };
                next.set(p.toolCallId, {
                  ...existing,
                  currentAttempt: attempt.attempt,
                  attempts: [...existing.attempts, attempt],
                  nextAttemptAt: p.nextAttemptAt ?? existing.nextAttemptAt,
                });
              }
              return next;
            });
          }
          if (ev === "read_only_mode") {
            setSystemMode("read-only");
            setReadOnlyInfo({
              failedToolCallId: p.failedToolCallId ?? "unknown",
              failedToolName: p.failedToolName ?? p.toolName,
              reason: p.reason ?? "Hard verification failed",
              timestamp: new Date().toISOString(),
            });
          }
          if (ev === "done") { setStreamingText(""); setStreamingTools([]); if (selectedId) await loadConversation(selectedId); await loadConversations(query); }
        } catch { /* ignore malformed */ }
      }
    }
    setSending(false); setStreamingTools([]);
  }

  async function approve(status: "approve" | "deny") {
    if (!pendingApproval || !hasToken()) return;
    await fetch(`${API_BASE}/api/approvals/${pendingApproval.approvalId}/${status}`, { method: "POST", headers: getAuthHeader() });
    setPendingApproval(null); if (selectedId) await loadConversation(selectedId);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (showPalette) return; sendMessage(); }
    if (e.key === "Escape" && showPalette) { setShowPalette(false); }
  }
  function autoGrow() {
    const ta = taRef.current; if (!ta) return; ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
  }

  /* ── File handling ── */
  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList).filter(f => {
      if (!ALLOWED_MIME.includes(f.type)) return false;
      if (f.size > MAX_FILE_SIZE) return false;
      return true;
    });
    setPendingFiles(prev => {
      const combined = [...prev, ...files].slice(0, MAX_FILES);
      // Generate image previews
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

  // Show palette when "/" is typed at start of input
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const val = e.target.value;
    setInput(val);
    autoGrow();
    if (val.startsWith("/")) {
      setShowPalette(true);
      setPaletteFilter(val.slice(1));
    } else {
      setShowPalette(false);
    }
  }

  function handlePaletteSelect(cmd: PaletteCommand) {
    setInput(cmd.template);
    setShowPalette(false);
    taRef.current?.focus();
  }

  // Cmd+K shortcut for command palette
  useEffect(() => {
    function handleGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowPalette(prev => !prev);
        setPaletteFilter("");
        taRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleGlobalKey);
    return () => window.removeEventListener("keydown", handleGlobalKey);
  }, []);

  /* ── Build chat items from conversation ── */
  const allRuns = conversation?.runs ?? [];
  const toolCallMap = new Map<string, ToolCall>();
  for (const run of allRuns) for (const tc of run.toolCalls) toolCallMap.set(tc.id, tc);

  /* ── Derived values ── */
  const modeColor = getModeColor(pilotMode);
  const hasMessages = (conversation?.messages?.length ?? 0) > 0;
  const showEmptyState = !authHint && !conversation && isAuthenticated;
  const showAuthGate = !!authHint || !isAuthenticated;
  const verificationsArray = Array.from(verifications.values());

  /* ── Render ── */
  return (
    <div style={S.shell}>
      <style>{`@keyframes blink{0%,100%{opacity:1}50%{opacity:0}} details>summary::-webkit-details-marker{display:none}`}</style>

      {/* ── Sidebar ── */}
      <aside style={S.sidebar}>
        <div style={S.sidebarHeader}>
          <CopilotIcon />
          <span style={S.sidebarTitle}>MigraPilot</span>
          <button style={S.newBtn} onClick={newConversation} title="New chat"><PlusIcon /> New</button>
        </div>
        <input style={S.searchBox} value={query}
          onChange={e => { setQuery(e.target.value); loadConversations(e.target.value); }}
          placeholder="Search conversations…"
        />
        <div style={S.convoList}>
          {conversations.map(c => {
            const snip = c.messages?.[0]?.contentJson?.text;
            return (
              <button key={c.id} style={S.convoItem(c.id === selectedId)} onClick={() => setSelectedId(c.id)}>
                <div style={S.convoDate}>{timeAgo(c.createdAt)}</div>
                <div style={S.convoSnip}>{snip ? (snip.length > 60 ? snip.slice(0, 60) + "…" : snip) : c.id.slice(0, 12)}</div>
              </button>
            );
          })}
          {conversations.length === 0 && !authHint && (
            <div style={{ textAlign: "center", padding: 20, color: "var(--fg-dim)", fontSize: 12 }}>No conversations yet</div>
          )}
        </div>
      </aside>

      {/* ── Main ── */}
      <div style={S.main}>
        {/* top bar — themed by mode */}
        <div style={{ ...S.topBar, borderBottom: `2px solid ${modeColor}20` }}>
          <div style={S.topTitle}><CopilotIcon /> MigraPilot</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <ModeSwitch mode={pilotMode} onChange={setPilotMode} />
            <StatusPills
              isAuthenticated={isAuthenticated}
              activeProvider={activeProvider}
              systemMode={systemMode}
              policyEnforced={true}
              dryRun={dryRun}
            />
            <button
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", cursor: "pointer", color: showSources ? modeColor : "var(--fg-dim)", fontSize: 11, fontWeight: 600 }}
              onClick={() => setShowSources(v => !v)}
              title="Toggle source citations panel"
            >
              📚 Sources
            </button>
            <button
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", cursor: "pointer", color: showPolicy ? modeColor : "var(--fg-dim)", fontSize: 11, fontWeight: 600 }}
              onClick={() => setShowPolicy(v => !v)}
              title="Toggle policy timeline"
            >
              🛡️ Policy
            </button>
            <button
              style={{ background: "none", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", cursor: "pointer", color: showEngState ? modeColor : "var(--fg-dim)", fontSize: 11, fontWeight: 600 }}
              onClick={() => setShowEngState(v => !v)}
              title="Toggle engineering state"
            >
              🧠 State
            </button>
            <label style={S.dryLabel}>
              <input type="checkbox" checked={dryRun} onChange={e => setDryRun(e.target.checked)} style={S.dryCheck} />
              Dry run
            </label>

            {/* ── Operator Identity ── */}
            {operatorInfo && (
              <div style={{ position: "relative" as const }}>
                <button
                  style={{
                    background: "none", border: "1px solid var(--border)", borderRadius: 6,
                    padding: "4px 10px", cursor: "pointer", color: "var(--fg-bright)", fontSize: 11,
                    fontWeight: 600, display: "flex", alignItems: "center", gap: 6,
                  }}
                  onClick={() => setShowOperatorMenu(v => !v)}
                  title="Operator menu"
                >
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#3fb950", flexShrink: 0 }} />
                  {operatorInfo.email.split("@")[0]}
                  <span style={{
                    fontSize: 9, padding: "1px 5px", borderRadius: 3,
                    background: operatorInfo.role === "admin" ? "rgba(0,120,212,0.15)" : "rgba(255,255,255,0.08)",
                    color: operatorInfo.role === "admin" ? "#569cd6" : "var(--fg-dim)",
                    fontWeight: 700, textTransform: "uppercase" as const,
                  }}>
                    {operatorInfo.role}
                  </span>
                </button>

                {showOperatorMenu && (
                  <div style={{
                    position: "absolute" as const, top: "100%", right: 0, marginTop: 4, zIndex: 999,
                    background: "var(--bg-sidebar)", border: "1px solid var(--border)", borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.3)", minWidth: 180, overflow: "hidden",
                  }}>
                    <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--fg-dim)" }}>
                      {operatorInfo.email}
                    </div>
                    <button
                      style={{ width: "100%", padding: "8px 14px", background: "none", border: "none", color: "var(--fg)", fontSize: 12, cursor: "pointer", textAlign: "left" as const }}
                      onClick={() => {
                        navigator.clipboard.writeText(localStorage.getItem("token") ?? "");
                        setShowOperatorMenu(false);
                      }}
                    >
                      📋 Copy Token
                    </button>
                    <button
                      style={{ width: "100%", padding: "8px 14px", background: "none", border: "none", color: "#f85149", fontSize: 12, cursor: "pointer", textAlign: "left" as const }}
                      onClick={() => {
                        localStorage.removeItem("token");
                        setIsAuthenticated(false);
                        setOperatorInfo(null);
                        setShowOperatorMenu(false);
                        setConversations([]);
                        setConversation(null);
                        setSelectedId(null);
                        setAuthHint("Signed out.");
                      }}
                    >
                      🚪 Sign Out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Read-Only Banner ── */}
        {readOnlyInfo && (
          <ReadOnlyBanner
            info={readOnlyInfo}
            onViewDetails={() => {
              /* scroll to the failed verification card */
              const el = document.getElementById(`vc-${readOnlyInfo.failedToolCallId}`);
              el?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onRollback={async () => {
              /* Call POST /api/system/rollback_last — SSE stream */
              try {
                const r = await fetch(`${API_BASE}/api/system/rollback_last`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", ...getAuthHeader() },
                });
                if (!r.ok) return;
                const reader = r.body?.getReader();
                if (!reader) return;
                let buf = "";
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
                      if (ev === "read_only_mode" && !p.enabled) {
                        setSystemMode("normal");
                        setReadOnlyInfo(null);
                      }
                    } catch { /* ignore */ }
                  }
                }
              } catch { /* network error */ }
            }}
          />
        )}

        {/* messages area */}
        <div style={S.msgArea}>
          {/* Auth Gate (replaces old banner) */}
          {showAuthGate && (
            <AuthGate hint={authHint} onTokenSet={handleTokenSet} />
          )}

          {/* Empty State Dashboard */}
          {showEmptyState && (
            <EmptyStateDashboard
              isAuthenticated={isAuthenticated}
              onQuickAction={(prompt) => {
                setInput(prompt);
                taRef.current?.focus();
              }}
              onReadOnlyTriggered={(info) => {
                setReadOnlyInfo(info);
              }}
              onSystemModeChange={(mode) => {
                setSystemMode(mode);
                if (mode === "normal") setReadOnlyInfo(null);
              }}
            />
          )}

          {conversation?.messages?.map(m => {
            const isUser = m.role === "user";
            const text = m.contentJson?.text ?? JSON.stringify(m.contentJson);
            return (
              <div key={m.id} style={S.msgRow(isUser)}>
                <div style={S.avatar}>{isUser ? <UserIcon /> : <CopilotIcon />}</div>
                <div style={S.msgBody}>
                  <div style={S.msgRole}>{isUser ? "You" : "MigraPilot"}</div>
                  {isUser
                    ? <div style={S.msgText}>{text}</div>
                    : <MarkdownMessage text={text} />
                  }
                </div>
              </div>
            );
          })}

          {/* Tool cards from loaded runs */}
          {allRuns.flatMap(run => run.toolCalls).map(tc => (
            <div key={tc.id} style={{ padding: "0 20px" }}>
              <div style={S.toolCard}>
                <div style={S.toolHeader(tc.result ? tc.result.ok : null)}>
                  <ToolIcon />
                  <span>{tc.toolName}</span>
                  <span style={{ ...S.toolStatus, color: statusColor(tc.status) }}>{tc.status}</span>
                </div>
                <details style={S.toolDetails}>
                  <summary style={S.toolSummary}>▸ Arguments</summary>
                  <pre style={S.toolPre}>{JSON.stringify(redact(tc.argsJson), null, 2)}</pre>
                </details>
                {tc.result && (
                  <details style={S.toolDetails}>
                    <summary style={S.toolSummary}>▸ Result</summary>
                    <pre style={S.toolPre}>{JSON.stringify(redact(tc.result), null, 2)}</pre>
                  </details>
                )}
                <button style={S.copyBtn}
                  onClick={() => navigator.clipboard.writeText(JSON.stringify({ args: redact(tc.argsJson), result: redact(tc.result) }, null, 2))}>
                  Copy JSON
                </button>
              </div>
            </div>
          ))}

          {/* Live streaming tool events */}
          {streamingTools.map((t, i) => (
            <div key={`st-${i}`} style={{ padding: "0 20px" }}>
              <div style={S.toolCard}>
                <div style={S.toolHeader(t.payload?.ok ?? null)}>
                  <ToolIcon />
                  <span>{t.toolName}</span>
                  <span style={{ ...S.toolStatus, color: statusColor(t.status) }}>{t.status}</span>
                </div>
              </div>
            </div>
          ))}

          {/* ── Verification Cards (V2) ── */}
          {verificationsArray.map((v) => (
            <div key={v.toolCallId} id={`vc-${v.toolCallId}`}>
              <VerificationCard data={v} />
            </div>
          ))}

          {/* Streaming text */}
          {streamingText && (
            <div style={S.msgRow(false)}>
              <div style={S.avatar}><CopilotIcon /></div>
              <div style={S.msgBody}>
                <div style={{ ...S.msgRole, display: "flex", alignItems: "center", gap: 6 }}>
                  MigraPilot
                  {activeProvider && <ProviderBadge tag={activeProvider.tag} />}
                </div>
                <div><MarkdownMessage text={streamingText} /><span style={S.cursor} /></div>
              </div>
            </div>
          )}

          {/* Enhanced approval modal */}
          {pendingApproval && (
            <ApprovalModal
              toolName={pendingApproval.toolName}
              approvalId={pendingApproval.approvalId}
              expiresAt={pendingApproval.expiresAt}
              argsJson={pendingApproval.argsJson}
              blastRadius={pendingApproval.blastRadius}
              rollbackHint={pendingApproval.rollbackHint}
              onApprove={() => approve("approve")}
              onDeny={() => approve("deny")}
              onClose={() => setPendingApproval(null)}
            />
          )}

          <div ref={endRef} />
        </div>

        {/* Input */}
        {/* Input area with file support */}
        <div
          style={{ ...S.inputArea, position: "relative" as const, flexDirection: "column" as const, gap: 0, padding: 0 }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div style={S.dragOverlay}>Drop files here (images, PDFs, JSON, CSV, YAML)</div>
          )}
          <CommandPalette
            visible={showPalette}
            filter={paletteFilter}
            onSelect={handlePaletteSelect}
            onClose={() => setShowPalette(false)}
            mode={pilotMode}
          />

          {/* File chips */}
          {pendingFiles.length > 0 && (
            <div style={S.fileChipsRow}>
              {pendingFiles.map((f, i) => {
                const preview = filePreviews.get(f.name + f.size);
                return (
                  <div key={f.name + f.size + i} style={S.fileChip}>
                    {preview
                      ? <img src={preview} alt="" style={{ width: 20, height: 20, borderRadius: 3, objectFit: "cover" }} />
                      : (isImageFile(f) ? <ImageIcon /> : <FileDocIcon />)
                    }
                    <span style={S.fileChipName} title={f.name}>{f.name}</span>
                    <span style={{ color: "var(--fg-dim)", fontSize: 10, flexShrink: 0 }}>{formatFileSize(f.size)}</span>
                    <button style={S.fileChipClose} onClick={() => removeFile(i)} title="Remove"><CloseChipIcon /></button>
                  </div>
                );
              })}
            </div>
          )}

          {/* Input row */}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end", padding: "10px 16px" }}>
            <input ref={fileInputRef} type="file" accept={ALLOWED_EXTENSIONS} multiple style={{ display: "none" }} onChange={handleFileInputChange} />
            <button
              style={S.attachBtn}
              onClick={handleFilePick}
              title={`Attach files (${MAX_FILES - pendingFiles.length} remaining)`}
              disabled={pendingFiles.length >= MAX_FILES}
            >
              <AttachIcon />
            </button>
            <div style={S.inputWrap}>
              <textarea ref={taRef} style={S.textarea} value={input}
                onChange={handleInputChange}
                onKeyDown={handleKey}
                onPaste={handlePaste}
                placeholder={`Ask MigraPilot… (paste images, drag files, / for commands)`} rows={1}
              />
            </div>
            <button style={S.sendBtn(!!input.trim() && !sending)} onClick={sendMessage} disabled={sending || !input.trim()} title="Send message">
              {sending
                ? <span style={{ width: 14, height: 14, border: "2px solid var(--fg-dim)", borderTop: "2px solid var(--accent)", borderRadius: "50%", display: "inline-block", animation: "blink .6s linear infinite" }} />
                : <SendIcon />}
            </button>
          </div>
        </div>
      </div>

      {/* ── Right Drawers ── */}
      <RightDrawer title="Sources" icon="📚" visible={showSources} onClose={() => setShowSources(false)} accentColor={modeColor}>
        <div style={{ padding: "8px 10px" }}>
          {sourceCitations.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-dim)", fontSize: 12 }}>No source citations for this message</div>
          ) : (
            sourceCitations.map((c, i) => (
              <div key={i} style={{ border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8, overflow: "hidden", background: "var(--bg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11 }}>
                  <span style={{ fontWeight: 600, color: "var(--fg-bright)", fontFamily: "var(--mono)" }}>{c.source}</span>
                  <span style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: c.score >= 10 ? "rgba(46,160,67,0.15)" : c.score >= 5 ? "rgba(210,153,34,0.15)" : "rgba(139,148,158,0.1)", color: c.score >= 10 ? "#3fb950" : c.score >= 5 ? "#d29922" : "var(--fg-dim)", fontWeight: 600 }}>score: {c.score}</span>
                </div>
                <div style={{ padding: "8px 12px", fontSize: 12, color: "var(--fg)", lineHeight: "1.5", maxHeight: 120, overflowY: "auto", whiteSpace: "pre-wrap" }}>{c.content}</div>
                {c.tags.length > 0 && (
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap", padding: "4px 12px 8px" }}>
                    {c.tags.map((t, j) => <span key={j} style={{ fontSize: 10, padding: "1px 6px", borderRadius: 3, background: "var(--bg-active)", color: "var(--fg-dim)" }}>{t}</span>)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </RightDrawer>

      <RightDrawer title="Policy" icon="🛡️" visible={showPolicy} onClose={() => setShowPolicy(false)} accentColor={modeColor} width={300}>
        <div style={{ padding: "8px 10px" }}>
          {policyDecisions.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-dim)", fontSize: 12 }}>No policy decisions yet</div>
          ) : (
            policyDecisions.map((d, i) => (
              <div key={i} style={{ padding: "8px 10px", margin: "4px 0", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-input)" }}>
                <div>
                  <span style={{ display: "inline-block", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 3, marginRight: 6, color: "#fff", background: d.verdict === "allow" ? "var(--success)" : d.verdict === "deny" ? "var(--danger)" : "var(--warning)" }}>{d.verdict.toUpperCase()}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--fg-bright)" }}>{d.ruleId}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--fg-dim)", marginTop: 3, lineHeight: "1.4" }}>{d.reason}</div>
                {d.toolName && <div style={{ fontSize: 11, color: "var(--fg-dim)", marginTop: 2, fontFamily: "var(--mono)" }}>{d.toolName}</div>}
                {d.ts && <div style={{ fontSize: 10, color: "var(--fg-dim)", marginTop: 2, opacity: 0.7 }}>{new Date(d.ts).toLocaleTimeString()}</div>}
              </div>
            ))
          )}
        </div>
      </RightDrawer>

      <RightDrawer title="State" icon="🧠" visible={showEngState} onClose={() => setShowEngState(false)} accentColor={modeColor}>
        <div style={{ padding: "8px 10px" }}>
          {engState ? (
            Object.entries(engState).filter(([, v]) => v && v.length > 0).map(([key, items]) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--fg-bright)", textTransform: "uppercase" as const, letterSpacing: ".4px", marginBottom: 4 }}>
                  {key === "architecture" ? "🏗️" : key === "implemented" ? "✅" : key === "todos" ? "📋" : key === "risks" ? "⚠️" : "📝"} {key}
                  <span style={{ fontSize: 10, color: "var(--fg-dim)", fontWeight: 400, marginLeft: 4 }}>({items!.length})</span>
                </div>
                {items!.map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 6, padding: "3px 0", fontSize: 12, color: "var(--fg)", lineHeight: "1.45" }}>
                    <div style={{ marginTop: 4, width: 6, height: 6, borderRadius: "50%", background: key === "risks" ? "var(--danger)" : key === "todos" ? "var(--warning)" : "var(--success)", flexShrink: 0 }} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            ))
          ) : (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-dim)", fontSize: 12 }}>No engineering state recorded yet</div>
          )}
        </div>
      </RightDrawer>

      {/* Diff viewer overlay */}
      {showDiff && (
        <DiffViewer
          diff={showDiff.diff}
          title={showDiff.title}
          onClose={() => setShowDiff(null)}
        />
      )}
    </div>
  );
}
