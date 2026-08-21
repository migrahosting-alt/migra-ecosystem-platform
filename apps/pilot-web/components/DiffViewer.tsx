"use client";

/**
 * DiffViewer — renders unified diffs with syntax highlighting.
 *
 * Used for repo.applyPatch previews and change review.
 * Accepts a standard unified diff string.
 */

interface DiffViewerProps {
  diff: string;
  title?: string;
  onClose?: () => void;
}

const S = {
  overlay: {
    position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.6)",
    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
  },
  modal: {
    background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 12,
    width: "min(900px, 90vw)", maxHeight: "80vh", display: "flex", flexDirection: "column" as const,
    overflow: "hidden",
  },
  header: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 16px", borderBottom: "1px solid var(--border)", flexShrink: 0,
  },
  title: { fontSize: 13, fontWeight: 700, color: "var(--fg-bright)" },
  closeBtn: {
    background: "none", border: "none", color: "var(--fg-dim)", cursor: "pointer",
    fontSize: 18, lineHeight: 1, padding: "2px 6px",
  },
  body: {
    flex: 1, overflowY: "auto" as const, fontFamily: "var(--mono)", fontSize: 12,
    lineHeight: "1.6", padding: 0,
  },
  line: (type: "add" | "remove" | "header" | "context") => ({
    padding: "1px 16px",
    background:
      type === "add" ? "rgba(46,160,67,0.12)" :
      type === "remove" ? "rgba(248,81,73,0.12)" :
      type === "header" ? "rgba(86,156,214,0.08)" :
      "transparent",
    color:
      type === "add" ? "#3fb950" :
      type === "remove" ? "#f85149" :
      type === "header" ? "#569cd6" :
      "var(--fg)",
    whiteSpace: "pre" as const,
    borderLeft: type === "add" ? "3px solid #3fb950" :
      type === "remove" ? "3px solid #f85149" :
      "3px solid transparent",
  }),
  lineNum: {
    display: "inline-block", width: 48, textAlign: "right" as const,
    color: "var(--fg-dim)", marginRight: 12, fontSize: 11, userSelect: "none" as const,
  },
  stats: {
    padding: "8px 16px", borderTop: "1px solid var(--border)", fontSize: 11,
    color: "var(--fg-dim)", display: "flex", gap: 16, flexShrink: 0,
  },
};

function parseDiff(diff: string) {
  const lines = diff.split("\n");
  const parsed: Array<{ type: "add" | "remove" | "header" | "context"; text: string; oldNum?: number; newNum?: number }> = [];
  let oldLine = 0;
  let newLine = 0;
  let additions = 0;
  let deletions = 0;

  for (const line of lines) {
    if (line.startsWith("@@")) {
      // @@ -a,b +c,d @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) { oldLine = parseInt(match[1]); newLine = parseInt(match[2]); }
      parsed.push({ type: "header", text: line });
    } else if (line.startsWith("---") || line.startsWith("+++")) {
      parsed.push({ type: "header", text: line });
    } else if (line.startsWith("+")) {
      parsed.push({ type: "add", text: line, newNum: newLine });
      newLine++;
      additions++;
    } else if (line.startsWith("-")) {
      parsed.push({ type: "remove", text: line, oldNum: oldLine });
      oldLine++;
      deletions++;
    } else {
      parsed.push({ type: "context", text: line, oldNum: oldLine, newNum: newLine });
      oldLine++;
      newLine++;
    }
  }

  return { parsed, additions, deletions };
}

export function DiffViewer({ diff, title, onClose }: DiffViewerProps) {
  const { parsed, additions, deletions } = parseDiff(diff);

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        <div style={S.header}>
          <span style={S.title}>{title ?? "Diff Preview"}</span>
          {onClose && <button style={S.closeBtn} onClick={onClose}>✕</button>}
        </div>
        <div style={S.body}>
          {parsed.map((line, i) => (
            <div key={i} style={S.line(line.type)}>
              <span style={S.lineNum}>
                {line.type === "remove" ? line.oldNum : ""}
                {line.type === "context" ? line.oldNum : ""}
              </span>
              <span style={S.lineNum}>
                {line.type === "add" ? line.newNum : ""}
                {line.type === "context" ? line.newNum : ""}
              </span>
              {line.text}
            </div>
          ))}
        </div>
        <div style={S.stats}>
          <span style={{ color: "#3fb950" }}>+{additions} additions</span>
          <span style={{ color: "#f85149" }}>-{deletions} deletions</span>
          <span>{parsed.filter(l => l.type !== "header").length} lines</span>
        </div>
      </div>
    </div>
  );
}
