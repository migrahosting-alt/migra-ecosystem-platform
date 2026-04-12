"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { enterpriseApi } from "../lib/enterpriseApi";

/* ═════════════════════════════════════════════════════════
   MessageActions — Floating action bar on hover per message
   Copy · Reply · Pin · Bookmark · React · Edit · Retry
   ═════════════════════════════════════════════════════════ */

interface MessageActionsProps {
  messageId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  pinned?: boolean;
  bookmarked?: boolean;
  onRetry?: () => void;
  onEdit?: (messageId: string) => void;
  onReply?: (messageId: string) => void;
  onPinChange?: (messageId: string, pinned: boolean) => void;
  onBookmarkChange?: (messageId: string, bookmarked: boolean) => void;
  onReactionChange?: () => void;
}

export function MessageActions({
  messageId,
  conversationId,
  role,
  content,
  pinned = false,
  bookmarked = false,
  onRetry,
  onEdit,
  onReply,
  onPinChange,
  onBookmarkChange,
  onReactionChange,
}: MessageActionsProps) {
  const [showReactions, setShowReactions] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isPinned, setIsPinned] = useState(pinned);
  const [isBookmarked, setIsBookmarked] = useState(bookmarked);

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const handlePin = useCallback(async () => {
    const next = !isPinned;
    setIsPinned(next);
    await enterpriseApi.togglePin(conversationId, messageId, next);
    onPinChange?.(messageId, next);
  }, [conversationId, messageId, isPinned, onPinChange]);

  const handleBookmark = useCallback(async () => {
    if (isBookmarked) {
      await enterpriseApi.removeBookmark(conversationId, messageId);
    } else {
      await enterpriseApi.addBookmark(conversationId, messageId);
    }
    setIsBookmarked(!isBookmarked);
    onBookmarkChange?.(messageId, !isBookmarked);
  }, [conversationId, messageId, isBookmarked, onBookmarkChange]);

  const handleQuickReact = useCallback(
    async (emoji: string) => {
      await enterpriseApi.addReaction(conversationId, messageId, emoji, emoji === "👍" ? "positive" : emoji === "👎" ? "negative" : "neutral");
      setShowReactions(false);
      onReactionChange?.();
    },
    [conversationId, messageId, onReactionChange]
  );

  const s = styles;

  return (
    <div style={s.bar}>
      {/* Copy */}
      <button style={s.btn} onClick={handleCopy} title="Copy message">
        {copied ? "✓" : "📋"}
      </button>

      {/* React */}
      <div style={{ position: "relative" }}>
        <button style={s.btn} onClick={() => setShowReactions(!showReactions)} title="React">
          😀
        </button>
        {showReactions && (
          <div style={s.reactionPicker}>
            {["👍", "👎", "❤️", "🚀", "🎯", "⚡", "🐛", "💡"].map((e) => (
              <button key={e} style={s.emojiBtn} onClick={() => handleQuickReact(e)}>
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pin */}
      <button style={{ ...s.btn, ...(isPinned ? s.active : {}) }} onClick={handlePin} title={isPinned ? "Unpin" : "Pin"}>
        📌
      </button>

      {/* Bookmark */}
      <button style={{ ...s.btn, ...(isBookmarked ? s.active : {}) }} onClick={handleBookmark} title={isBookmarked ? "Remove bookmark" : "Bookmark"}>
        {isBookmarked ? "🔖" : "🏷️"}
      </button>

      {/* Reply (threading) */}
      {onReply && (
        <button style={s.btn} onClick={() => onReply(messageId)} title="Reply in thread">
          💬
        </button>
      )}

      {/* Edit (user messages only) */}
      {role === "user" && onEdit && (
        <button style={s.btn} onClick={() => onEdit(messageId)} title="Edit message">
          ✏️
        </button>
      )}

      {/* Retry (assistant messages only) */}
      {role === "assistant" && onRetry && (
        <button style={s.btn} onClick={onRetry} title="Retry">
          🔄
        </button>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    gap: 2,
    padding: "2px 4px",
    background: "var(--bg-secondary, #1e1e2e)",
    borderRadius: 8,
    border: "1px solid var(--line, #333)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    position: "absolute",
    top: -8,
    right: 8,
    zIndex: 10,
    opacity: 0,
    transition: "opacity 0.15s",
  },
  btn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    padding: "4px 6px",
    borderRadius: 4,
    transition: "background 0.1s",
    lineHeight: 1,
  },
  active: {
    background: "rgba(99, 102, 241, 0.2)",
  },
  emojiBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 18,
    padding: "4px",
    borderRadius: 4,
    transition: "transform 0.1s",
  },
  reactionPicker: {
    position: "absolute",
    bottom: "100%",
    right: 0,
    display: "flex",
    gap: 2,
    padding: "6px",
    background: "var(--bg-secondary, #1e1e2e)",
    borderRadius: 8,
    border: "1px solid var(--line, #333)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    zIndex: 20,
    flexWrap: "wrap",
    width: 180,
  },
};

/* ═════════════════════════════════════════════════════════
   ReactionBar — Shows aggregated reactions below a message
   ═════════════════════════════════════════════════════════ */

interface ReactionBarProps {
  reactions: Array<{ emoji: string; count: number; userReacted: boolean }>;
  onToggle: (emoji: string) => void;
}

export function ReactionBar({ reactions, onToggle }: ReactionBarProps) {
  if (!reactions || reactions.length === 0) return null;

  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
      {reactions.map((r) => (
        <button
          key={r.emoji}
          onClick={() => onToggle(r.emoji)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            borderRadius: 12,
            fontSize: 12,
            border: r.userReacted ? "1px solid var(--accent, #6366f1)" : "1px solid var(--line, #444)",
            background: r.userReacted ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.04)",
            color: "var(--text, #e0e0e0)",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          <span>{r.emoji}</span>
          <span style={{ fontWeight: 600 }}>{r.count}</span>
        </button>
      ))}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   CostBadge — Shows token usage & cost per message/run
   ═════════════════════════════════════════════════════════ */

interface CostBadgeProps {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  model?: string;
  durationMs?: number;
}

export function CostBadge({ inputTokens, outputTokens, costUsd, model, durationMs }: CostBadgeProps) {
  if (!inputTokens && !outputTokens) return null;

  const total = (inputTokens ?? 0) + (outputTokens ?? 0);
  const dur = durationMs ? `${(durationMs / 1000).toFixed(1)}s` : null;

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 8px",
        fontSize: 10,
        borderRadius: 6,
        background: "rgba(99,102,241,0.08)",
        color: "var(--text-muted, #888)",
        fontFamily: "var(--mono, monospace)",
        marginTop: 4,
      }}
    >
      {model && <span style={{ fontWeight: 600 }}>{model}</span>}
      <span>⬆{inputTokens?.toLocaleString()}</span>
      <span>⬇{outputTokens?.toLocaleString()}</span>
      <span>Σ{total.toLocaleString()}</span>
      {costUsd !== undefined && <span style={{ color: "#4ade80" }}>${costUsd.toFixed(4)}</span>}
      {dur && <span>⏱{dur}</span>}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   ThinkingTimer — Animated elapsed-time indicator
   ═════════════════════════════════════════════════════════ */

interface ThinkingTimerProps {
  startTime: number;
  provider?: string;
  model?: string;
  stage?: string; // "thinking" | "tool_call" | "streaming"
}

export function ThinkingTimer({ startTime, provider, model, stage = "thinking" }: ThinkingTimerProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setElapsed(Date.now() - startTime);
    }, 100);
    return () => clearInterval(timer);
  }, [startTime]);

  const secs = (elapsed / 1000).toFixed(1);
  const dots = ".".repeat(Math.floor(elapsed / 400) % 4);

  const stageLabel =
    stage === "tool_call" ? "Executing tool" :
    stage === "streaming" ? "Generating" :
    "Thinking";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        fontSize: 12,
        color: "var(--text-muted, #888)",
        fontFamily: "var(--mono, monospace)",
      }}
    >
      <span style={{ display: "inline-block", animation: "spin 1s linear infinite", fontSize: 14 }}>⚙️</span>
      <span>{stageLabel}{dots}</span>
      <span style={{ color: "var(--accent, #6366f1)", fontWeight: 600 }}>{secs}s</span>
      {provider && <span style={{ opacity: 0.6 }}>{provider}</span>}
      {model && <span style={{ opacity: 0.5 }}>{model}</span>}
      <style jsx global>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   SlashCommandPalette — Dropdown command palette
   ═════════════════════════════════════════════════════════ */

interface SlashCommandDef {
  name: string;
  description: string;
  category: string;
  args?: string;
}

interface SlashCommandPaletteProps {
  commands: SlashCommandDef[];
  filter: string;
  onSelect: (cmd: SlashCommandDef) => void;
  visible: boolean;
}

export function SlashCommandPalette({ commands, filter, onSelect, visible }: SlashCommandPaletteProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);

  const filtered = commands.filter(
    (c) =>
      c.name.toLowerCase().includes(filter.toLowerCase()) ||
      c.description.toLowerCase().includes(filter.toLowerCase())
  );

  useEffect(() => {
    setSelectedIdx(0);
  }, [filter]);

  // Keyboard nav handled by parent via onKeyDown
  if (!visible || filtered.length === 0) return null;

  const categoryColors: Record<string, string> = {
    system: "#6366f1",
    ops: "#f59e0b",
    inventory: "#10b981",
    debug: "#ef4444",
    network: "#3b82f6",
    security: "#dc2626",
    vcs: "#8b5cf6",
    info: "#06b6d4",
    util: "#64748b",
  };

  return (
    <div
      style={{
        position: "absolute",
        bottom: "100%",
        left: 0,
        width: "100%",
        maxHeight: 300,
        overflowY: "auto",
        background: "var(--bg-secondary, #1a1a2e)",
        border: "1px solid var(--line, #333)",
        borderRadius: 8,
        boxShadow: "0 -4px 20px rgba(0,0,0,0.4)",
        zIndex: 100,
        padding: "4px 0",
      }}
    >
      <div style={{ padding: "6px 12px", fontSize: 10, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1 }}>
        Commands
      </div>
      {filtered.map((cmd, i) => (
        <div
          key={cmd.name}
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => setSelectedIdx(i)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            cursor: "pointer",
            background: i === selectedIdx ? "rgba(99,102,241,0.12)" : "transparent",
            transition: "background 0.1s",
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: 3,
              background: categoryColors[cmd.category] ?? "#666",
            }}
          />
          <code style={{ fontSize: 13, fontWeight: 600, color: "var(--accent, #6366f1)" }}>{cmd.name}</code>
          {cmd.args && <code style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.6 }}>{cmd.args}</code>}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: "var(--text-muted, #888)" }}>{cmd.description}</span>
        </div>
      ))}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   ConversationSidebar — Side panel with conversation list
   ═════════════════════════════════════════════════════════ */

interface ConvListItem {
  id: string;
  title?: string | null;
  createdAt: string;
  archived?: boolean;
  pinned?: boolean;
  tags?: string[];
  lastMessage?: { role: string; preview: string; createdAt: string } | null;
  counts?: { messages: number; reactions: number; bookmarks: number };
}

interface ConversationSidebarProps {
  conversations: ConvListItem[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onSearch: (q: string) => void;
  searchQuery: string;
  showArchived: boolean;
  onToggleArchived: () => void;
  loading?: boolean;
}

export function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onArchive,
  onDelete,
  onPin,
  onSearch,
  searchQuery,
  showArchived,
  onToggleArchived,
  loading = false,
}: ConversationSidebarProps) {
  return (
    <div
      style={{
        width: 280,
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg-secondary, #12121a)",
        borderRight: "1px solid var(--line, #222)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div style={{ padding: "12px", display: "flex", alignItems: "center", gap: 8 }}>
        <button
          onClick={onNew}
          style={{
            flex: 1,
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--accent, #6366f1)",
            background: "rgba(99,102,241,0.1)",
            color: "var(--accent, #6366f1)",
            fontWeight: 600,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          + New Chat
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "0 12px 8px" }}>
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => onSearch(e.target.value)}
          placeholder="Search conversations..."
          style={{
            width: "100%",
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid var(--line, #333)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text, #e0e0e0)",
            fontSize: 12,
            outline: "none",
          }}
        />
      </div>

      {/* Archive toggle */}
      <div style={{ padding: "0 12px 8px", display: "flex", gap: 8 }}>
        <button
          onClick={onToggleArchived}
          style={{
            padding: "4px 8px",
            borderRadius: 4,
            border: "none",
            background: showArchived ? "rgba(99,102,241,0.2)" : "transparent",
            color: "var(--text-muted)",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          {showArchived ? "📁 Archived" : "💬 Active"}
        </button>
      </div>

      {/* Conversation list */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 8px" }}>
        {loading && <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>Loading...</div>}
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            style={{
              padding: "10px 8px",
              borderRadius: 6,
              cursor: "pointer",
              background: c.id === activeId ? "rgba(99,102,241,0.12)" : "transparent",
              borderLeft: c.id === activeId ? "3px solid var(--accent, #6366f1)" : "3px solid transparent",
              marginBottom: 2,
              transition: "background 0.1s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              {c.pinned && <span style={{ fontSize: 10 }}>📌</span>}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: c.id === activeId ? 600 : 400,
                  color: "var(--text, #e0e0e0)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {c.title || "Untitled conversation"}
              </span>
            </div>
            {c.lastMessage && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted, #888)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  marginTop: 2,
                }}
              >
                {c.lastMessage.preview.slice(0, 80)}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 4, fontSize: 10, color: "var(--text-muted, #666)" }}>
              <span>{new Date(c.createdAt).toLocaleDateString()}</span>
              {c.counts && <span>💬{c.counts.messages}</span>}
              {c.tags && c.tags.length > 0 && (
                <span>{c.tags.map((t) => `#${t}`).join(" ")}</span>
              )}
            </div>

            {/* Hover actions */}
            <div style={{ display: "flex", gap: 2, marginTop: 4, opacity: 0.5 }}>
              <button
                onClick={(e) => { e.stopPropagation(); onPin(c.id); }}
                style={{ background: "none", border: "none", fontSize: 10, cursor: "pointer", color: "var(--text-muted)" }}
                title={c.pinned ? "Unpin" : "Pin"}
              >
                📌
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onArchive(c.id); }}
                style={{ background: "none", border: "none", fontSize: 10, cursor: "pointer", color: "var(--text-muted)" }}
                title="Archive"
              >
                📁
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                style={{ background: "none", border: "none", fontSize: 10, cursor: "pointer", color: "var(--text-muted)" }}
                title="Delete"
              >
                🗑️
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   ExportDialog — Export conversation as JSON / Markdown
   ═════════════════════════════════════════════════════════ */

interface ExportDialogProps {
  conversationId: string;
  visible: boolean;
  onClose: () => void;
}

export function ExportDialog({ conversationId, visible, onClose }: ExportDialogProps) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async (format: "json" | "markdown") => {
    setExporting(true);
    try {
      const response = await enterpriseApi.exportConversation(conversationId, format);
      const blob = await response.blob();
      const ext = format === "json" ? "json" : "md";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `migrapilot-${conversationId}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-primary, #1a1a2e)",
          border: "1px solid var(--line, #333)",
          borderRadius: 12,
          padding: "24px",
          width: 360,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: 16, color: "var(--text)" }}>Export Conversation</h3>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            onClick={() => handleExport("json")}
            disabled={exporting}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 8,
              border: "1px solid var(--line, #333)",
              background: "rgba(99,102,241,0.1)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            📄 JSON
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Full data with tool calls
            </div>
          </button>
          <button
            onClick={() => handleExport("markdown")}
            disabled={exporting}
            style={{
              flex: 1,
              padding: "12px",
              borderRadius: 8,
              border: "1px solid var(--line, #333)",
              background: "rgba(16,185,129,0.1)",
              color: "var(--text)",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: 600,
            }}
          >
            📝 Markdown
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Human-readable transcript
            </div>
          </button>
        </div>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 12,
            padding: "8px",
            border: "none",
            background: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   UsagePanel — Session token usage & cost summary
   ═════════════════════════════════════════════════════════ */

interface UsagePanelProps {
  conversationId: string;
  visible: boolean;
}

export function UsagePanel({ conversationId, visible }: UsagePanelProps) {
  const [usage, setUsage] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !conversationId) return;
    setLoading(true);
    enterpriseApi.getUsage(conversationId).then((data) => {
      setUsage(data);
      setLoading(false);
    });
  }, [visible, conversationId]);

  if (!visible) return null;

  return (
    <div
      style={{
        padding: "12px 16px",
        background: "rgba(99,102,241,0.06)",
        borderRadius: 8,
        border: "1px solid var(--line, #222)",
        fontSize: 12,
        fontFamily: "var(--mono, monospace)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8, color: "var(--text)" }}>📊 Session Usage</div>
      {loading && <div style={{ color: "var(--text-muted)" }}>Loading...</div>}
      {usage?.totals && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 16px" }}>
          <Stat label="Input tokens" value={usage.totals.inputTokens.toLocaleString()} />
          <Stat label="Output tokens" value={usage.totals.outputTokens.toLocaleString()} />
          <Stat label="Total tokens" value={usage.totals.totalTokens.toLocaleString()} />
          <Stat label="Est. cost" value={`$${usage.totals.estimatedCostUsd.toFixed(4)}`} color="#4ade80" />
          <Stat label="Runs" value={usage.totals.runs} />
          <Stat label="Tool calls" value={`${usage.totals.successfulTools}✓ ${usage.totals.failedTools}✗`} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div>
      <div style={{ color: "var(--text-muted, #888)", fontSize: 10 }}>{label}</div>
      <div style={{ color: color ?? "var(--text, #e0e0e0)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   PinnedMessagesPanel — Shows all pinned messages
   ═════════════════════════════════════════════════════════ */

interface PinnedMessagesPanelProps {
  conversationId: string;
  visible: boolean;
  onJumpTo: (messageId: string) => void;
  onClose: () => void;
}

export function PinnedMessagesPanel({ conversationId, visible, onJumpTo, onClose }: PinnedMessagesPanelProps) {
  const [pinned, setPinned] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible || !conversationId) return;
    setLoading(true);
    enterpriseApi.getPinned(conversationId).then((data) => {
      setPinned(data.messages ?? []);
      setLoading(false);
    });
  }, [visible, conversationId]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 320,
        height: "100%",
        background: "var(--bg-secondary, #12121a)",
        borderLeft: "1px solid var(--line, #222)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
      }}
    >
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>📌 Pinned Messages</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {loading && <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>Loading...</div>}
        {pinned.map((msg) => {
          const content = typeof msg.contentJson === "object" ? (msg.contentJson as any)?.text ?? "" : String(msg.contentJson);
          return (
            <div
              key={msg.id}
              onClick={() => onJumpTo(msg.id)}
              style={{
                padding: "10px",
                borderRadius: 6,
                marginBottom: 4,
                background: "rgba(255,255,255,0.03)",
                cursor: "pointer",
                transition: "background 0.1s",
              }}
            >
              <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 4 }}>
                {msg.role === "user" ? "You" : "MigraPilot"} · {new Date(msg.createdAt).toLocaleString()}
              </div>
              <div style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {content.slice(0, 150)}
              </div>
            </div>
          );
        })}
        {!loading && pinned.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            No pinned messages yet.<br />Pin important messages to find them quickly.
          </div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   BookmarksPanel — Shows all bookmarks for current user
   ═════════════════════════════════════════════════════════ */

interface BookmarksPanelProps {
  visible: boolean;
  onJumpTo: (convId: string, messageId: string) => void;
  onClose: () => void;
}

export function BookmarksPanel({ visible, onJumpTo, onClose }: BookmarksPanelProps) {
  const [bookmarks, setBookmarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    enterpriseApi.listBookmarks().then((data) => {
      setBookmarks(data.bookmarks ?? []);
      setLoading(false);
    });
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        width: 320,
        height: "100%",
        background: "var(--bg-secondary, #12121a)",
        borderLeft: "1px solid var(--line, #222)",
        display: "flex",
        flexDirection: "column",
        zIndex: 50,
      }}
    >
      <div style={{ padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--line)" }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>🔖 Bookmarks</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16 }}>✕</button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
        {loading && <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>Loading...</div>}
        {bookmarks.map((bm) => {
          const content = bm.message?.contentJson
            ? typeof bm.message.contentJson === "object"
              ? (bm.message.contentJson as any)?.text ?? ""
              : String(bm.message.contentJson)
            : "";
          return (
            <div
              key={bm.id}
              onClick={() => onJumpTo(bm.conversationId, bm.messageId)}
              style={{
                padding: "10px",
                borderRadius: 6,
                marginBottom: 4,
                background: "rgba(255,255,255,0.03)",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text)" }}>
                  {bm.label || bm.conversation?.title || "Conversation"}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                  {new Date(bm.createdAt).toLocaleDateString()}
                </span>
              </div>
              {bm.note && <div style={{ fontSize: 11, color: "var(--accent)", marginBottom: 4 }}>{bm.note}</div>}
              <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {content.slice(0, 120)}
              </div>
            </div>
          );
        })}
        {!loading && bookmarks.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>
            No bookmarks yet.<br />Bookmark messages to find them later.
          </div>
        )}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   KeyboardShortcuts — Global shortcut reference overlay
   ═════════════════════════════════════════════════════════ */

const SHORTCUTS = [
  { keys: "Ctrl+Enter", description: "Send message", scope: "input" as const },
  { keys: "Ctrl+N", description: "New conversation", scope: "global" as const },
  { keys: "Ctrl+K", description: "Open command palette / slash", scope: "global" as const },
  { keys: "Ctrl+S", description: "Search conversations", scope: "global" as const },
  { keys: "Ctrl+E", description: "Export conversation", scope: "global" as const },
  { keys: "Ctrl+B", description: "Toggle sidebar", scope: "global" as const },
  { keys: "Ctrl+P", description: "Show pinned messages", scope: "global" as const },
  { keys: "Ctrl+/", description: "Show keyboard shortcuts", scope: "global" as const },
  { keys: "Ctrl+L", description: "Clear / new conversation", scope: "global" as const },
  { keys: "Escape", description: "Close panel / cancel", scope: "global" as const },
  { keys: "↑ Arrow", description: "Edit last message", scope: "input" as const },
  { keys: "Ctrl+Shift+C", description: "Copy last response", scope: "global" as const },
];

interface KeyboardShortcutsPanelProps {
  visible: boolean;
  onClose: () => void;
}

export function KeyboardShortcutsPanel({ visible, onClose }: KeyboardShortcutsPanelProps) {
  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-primary, #1a1a2e)",
          border: "1px solid var(--line, #333)",
          borderRadius: 12,
          padding: "20px 24px",
          width: 420,
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: 16, color: "var(--text)" }}>⌨️ Keyboard Shortcuts</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {SHORTCUTS.map((s) => (
            <div key={s.keys} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0" }}>
              <span style={{ fontSize: 13, color: "var(--text)" }}>{s.description}</span>
              <kbd
                style={{
                  padding: "2px 8px",
                  borderRadius: 4,
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid var(--line, #444)",
                  fontSize: 11,
                  fontFamily: "var(--mono, monospace)",
                  color: "var(--accent, #6366f1)",
                }}
              >
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          style={{
            width: "100%",
            marginTop: 16,
            padding: "8px",
            border: "none",
            background: "rgba(99,102,241,0.1)",
            borderRadius: 6,
            color: "var(--text-muted)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Close (Esc)
        </button>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   MessageSearchPanel — Search across all messages
   ═════════════════════════════════════════════════════════ */

interface MessageSearchPanelProps {
  visible: boolean;
  onClose: () => void;
  onJumpTo: (convId: string, messageId: string) => void;
}

export function MessageSearchPanel({ visible, onClose, onJumpTo }: MessageSearchPanelProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const data = await enterpriseApi.searchMessages(q);
    setResults(data.results ?? []);
    setLoading(false);
  }, []);

  const handleChange = (val: string) => {
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(val), 300);
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-primary, #1a1a2e)",
          border: "1px solid var(--line, #333)",
          borderRadius: 12,
          width: 520,
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ padding: "16px", borderBottom: "1px solid var(--line)" }}>
          <input
            autoFocus
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            placeholder="Search all messages..."
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid var(--line, #333)",
              background: "rgba(255,255,255,0.04)",
              color: "var(--text)",
              fontSize: 14,
              outline: "none",
            }}
          />
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
          {loading && <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12, textAlign: "center" }}>Searching...</div>}
          {results.map((r) => {
            const content = typeof r.content_json === "object" ? (r.content_json as any)?.text ?? JSON.stringify(r.content_json) : String(r.content_json);
            return (
              <div
                key={r.id}
                onClick={() => onJumpTo(r.conversation_id, r.id)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 6,
                  marginBottom: 2,
                  cursor: "pointer",
                  transition: "background 0.1s",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)" }}>
                    {r.conv_title || r.conversation_id.slice(0, 8)} · {r.role}
                  </span>
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{new Date(r.created_at).toLocaleString()}</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                  {content.slice(0, 300)}
                </div>
              </div>
            );
          })}
          {!loading && query.length >= 2 && results.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--text-muted)", fontSize: 12 }}>No results found.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   FeedbackDialog — Detailed feedback for a message (RLHF)
   ═════════════════════════════════════════════════════════ */

interface FeedbackDialogProps {
  conversationId: string;
  messageId: string;
  visible: boolean;
  onClose: () => void;
}

export function FeedbackDialog({ conversationId, messageId, visible, onClose }: FeedbackDialogProps) {
  const [sentiment, setSentiment] = useState<"positive" | "negative" | "neutral">("neutral");
  const [feedback, setFeedback] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    const emoji = sentiment === "positive" ? "👍" : sentiment === "negative" ? "👎" : "💭";
    await enterpriseApi.addReaction(conversationId, messageId, emoji, sentiment, feedback || undefined);
    setSubmitting(false);
    onClose();
  };

  if (!visible) return null;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-primary, #1a1a2e)",
          border: "1px solid var(--line, #333)",
          borderRadius: 12,
          padding: "24px",
          width: 400,
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
      >
        <h3 style={{ margin: "0 0 16px", fontSize: 16, color: "var(--text)" }}>Rate this response</h3>

        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(["positive", "neutral", "negative"] as const).map((s) => {
            const emoji = s === "positive" ? "👍" : s === "negative" ? "👎" : "🤷";
            const label = s.charAt(0).toUpperCase() + s.slice(1);
            return (
              <button
                key={s}
                onClick={() => setSentiment(s)}
                style={{
                  flex: 1,
                  padding: "12px",
                  borderRadius: 8,
                  border: `2px solid ${sentiment === s ? "var(--accent)" : "var(--line)"}`,
                  background: sentiment === s ? "rgba(99,102,241,0.12)" : "transparent",
                  cursor: "pointer",
                  fontSize: 20,
                  textAlign: "center",
                }}
              >
                {emoji}
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{label}</div>
              </button>
            );
          })}
        </div>

        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="What could be improved? (optional)"
          style={{
            width: "100%",
            minHeight: 80,
            padding: "10px",
            borderRadius: 8,
            border: "1px solid var(--line, #333)",
            background: "rgba(255,255,255,0.04)",
            color: "var(--text)",
            fontSize: 13,
            resize: "vertical",
            outline: "none",
            fontFamily: "inherit",
          }}
        />

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--text-muted)",
              cursor: "pointer",
              fontSize: 13,
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            style={{
              flex: 1,
              padding: "8px",
              borderRadius: 6,
              border: "none",
              background: "var(--accent, #6366f1)",
              color: "#fff",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            {submitting ? "Submitting..." : "Submit"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   ChatHeader — Conversation header with title & actions
   ═════════════════════════════════════════════════════════ */

interface ChatHeaderProps {
  conversationId?: string | null;
  title?: string | null;
  onToggleSidebar: () => void;
  onShowPinned: () => void;
  onShowBookmarks: () => void;
  onShowUsage: () => void;
  onShowExport: () => void;
  onShowSearch: () => void;
  onShowShortcuts: () => void;
  onEditTitle: (title: string) => void;
  sidebarOpen: boolean;
}

export function ChatHeader({
  conversationId,
  title,
  onToggleSidebar,
  onShowPinned,
  onShowBookmarks,
  onShowUsage,
  onShowExport,
  onShowSearch,
  onShowShortcuts,
  onEditTitle,
  sidebarOpen,
}: ChatHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(title ?? "");

  const handleSave = () => {
    onEditTitle(editValue);
    setEditing(false);
  };

  const hdrBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    fontSize: 14,
    padding: "4px 8px",
    borderRadius: 4,
    color: "var(--text-muted, #888)",
    transition: "color 0.15s",
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 16px",
        borderBottom: "1px solid var(--line, #222)",
        background: "var(--bg-secondary, #12121a)",
        minHeight: 44,
      }}
    >
      <button onClick={onToggleSidebar} style={hdrBtn} title="Toggle sidebar (Ctrl+B)">
        {sidebarOpen ? "◀" : "☰"}
      </button>

      {/* Title — editable */}
      {editing ? (
        <input
          autoFocus
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSave}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
          style={{
            flex: 1,
            background: "transparent",
            border: "1px solid var(--line)",
            borderRadius: 4,
            color: "var(--text)",
            fontSize: 14,
            fontWeight: 600,
            padding: "2px 6px",
            outline: "none",
          }}
        />
      ) : (
        <span
          onClick={() => { if (conversationId) { setEditValue(title ?? ""); setEditing(true); } }}
          style={{
            flex: 1,
            fontSize: 14,
            fontWeight: 600,
            color: "var(--text, #e0e0e0)",
            cursor: conversationId ? "pointer" : "default",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title || "MigraPilot Console"}
        </span>
      )}

      <button onClick={onShowSearch} style={hdrBtn} title="Search (Ctrl+S)">🔍</button>
      <button onClick={onShowPinned} style={hdrBtn} title="Pinned (Ctrl+P)">📌</button>
      <button onClick={onShowBookmarks} style={hdrBtn} title="Bookmarks">🔖</button>
      <button onClick={onShowUsage} style={hdrBtn} title="Usage / Cost">📊</button>
      <button onClick={onShowExport} style={hdrBtn} title="Export (Ctrl+E)">📥</button>
      <button onClick={onShowShortcuts} style={hdrBtn} title="Shortcuts (Ctrl+/)">⌨️</button>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════
   EditedBadge — Inline indicator that a message was edited
   ═════════════════════════════════════════════════════════ */

export function EditedBadge({ editedAt }: { editedAt?: string | null }) {
  if (!editedAt) return null;
  return (
    <span
      style={{
        fontSize: 10,
        color: "var(--text-muted, #666)",
        fontStyle: "italic",
        marginLeft: 6,
      }}
      title={`Edited at ${new Date(editedAt).toLocaleString()}`}
    >
      (edited)
    </span>
  );
}

/* ═════════════════════════════════════════════════════════
   PinBadge — Inline indicator that a message is pinned
   ═════════════════════════════════════════════════════════ */

export function PinBadge({ pinned }: { pinned?: boolean }) {
  if (!pinned) return null;
  return <span style={{ fontSize: 10, marginLeft: 4 }}>📌</span>;
}
