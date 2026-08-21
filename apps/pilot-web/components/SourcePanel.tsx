"use client";

/**
 * SourcePanel — shows RAG source citations alongside chat messages.
 *
 * When the AI uses knowledge from ingested docs, this panel shows
 * the source file, chunk content, and relevance score.
 */

interface SourceCitation {
  source: string;
  content: string;
  score: number;
  tags: string[];
}

interface SourcePanelProps {
  citations: SourceCitation[];
  visible: boolean;
  onClose: () => void;
}

const S = {
  panel: {
    width: 320, minWidth: 260, maxWidth: 400, display: "flex", flexDirection: "column" as const,
    background: "var(--bg-sidebar)", borderLeft: "1px solid var(--border)",
    flexShrink: 0,
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  title: {
    fontSize: 12, fontWeight: 600, color: "var(--fg-bright)",
    letterSpacing: ".3px", textTransform: "uppercase" as const,
  },
  closeBtn: {
    background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer",
    fontSize: 16, lineHeight: 1,
  },
  body: { flex: 1, overflowY: "auto" as const, padding: "8px 10px" },
  card: {
    border: "1px solid var(--border)", borderRadius: 8, marginBottom: 8,
    overflow: "hidden", background: "var(--bg)",
  },
  cardHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "8px 12px", borderBottom: "1px solid var(--border)", fontSize: 11,
  },
  source: { fontWeight: 600, color: "var(--fg-bright)", fontFamily: "var(--mono)" },
  score: (score: number) => ({
    fontSize: 10, padding: "1px 6px", borderRadius: 3,
    background: score >= 10 ? "rgba(46,160,67,0.15)" : score >= 5 ? "rgba(210,153,34,0.15)" : "rgba(139,148,158,0.1)",
    color: score >= 10 ? "#3fb950" : score >= 5 ? "#d29922" : "var(--fg-dim)",
    fontWeight: 600,
  }),
  content: {
    padding: "8px 12px", fontSize: 12, color: "var(--fg)", lineHeight: "1.5",
    maxHeight: 120, overflowY: "auto" as const, whiteSpace: "pre-wrap" as const,
  },
  tags: {
    display: "flex", gap: 4, flexWrap: "wrap" as const,
    padding: "4px 12px 8px",
  },
  tag: {
    fontSize: 10, padding: "1px 6px", borderRadius: 3,
    background: "var(--bg-active)", color: "var(--fg-dim)",
  },
  empty: {
    padding: 24, textAlign: "center" as const, color: "var(--fg-dim)", fontSize: 12,
  },
};

export function SourcePanel({ citations, visible, onClose }: SourcePanelProps) {
  if (!visible) return null;

  return (
    <div style={S.panel}>
      <div style={S.header}>
        <span style={S.title}>📚 Sources</span>
        <button style={S.closeBtn} onClick={onClose}>✕</button>
      </div>
      <div style={S.body}>
        {citations.length === 0 ? (
          <div style={S.empty}>No source citations for this message</div>
        ) : (
          citations.map((c, i) => (
            <div key={i} style={S.card}>
              <div style={S.cardHeader}>
                <span style={S.source}>{c.source}</span>
                <span style={S.score(c.score)}>score: {c.score}</span>
              </div>
              <div style={S.content}>{c.content}</div>
              {c.tags.length > 0 && (
                <div style={S.tags}>
                  {c.tags.map((t, j) => <span key={j} style={S.tag}>{t}</span>)}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
