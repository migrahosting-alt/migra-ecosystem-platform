"use client";

/**
 * InlineDiff — renders unified diff hunks with colored additions/removals.
 * Used inside tool output cards when the tool result contains diff-like content.
 */
export function InlineDiff({ diff }: { diff: string }) {
  const lines = diff.split("\n");

  return (
    <div style={{
      fontFamily: "var(--mono)", fontSize: 11, lineHeight: 1.6,
      borderRadius: 6, overflow: "hidden", border: "1px solid var(--line)",
    }}>
      {lines.map((line, i) => {
        let bg = "transparent";
        let color = "var(--text-secondary)";

        if (line.startsWith("+++") || line.startsWith("---")) {
          bg = "rgba(100,116,139,0.08)";
          color = "var(--fg-dim)";
        } else if (line.startsWith("+")) {
          bg = "rgba(52,211,153,0.1)";
          color = "#34d399";
        } else if (line.startsWith("-")) {
          bg = "rgba(248,113,113,0.1)";
          color = "#f87171";
        } else if (line.startsWith("@@")) {
          bg = "rgba(56,189,248,0.06)";
          color = "var(--accent)";
        }

        return (
          <div
            key={i}
            style={{
              padding: "0 8px",
              background: bg,
              color,
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              minHeight: 18,
            }}
          >
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Checks if text looks like a unified diff.
 */
export function looksLikeDiff(text: string): boolean {
  if (!text) return false;
  const lines = text.split("\n").slice(0, 20);
  let plusMinus = 0;
  let atAt = 0;
  for (const l of lines) {
    if (l.startsWith("+") || l.startsWith("-")) plusMinus++;
    if (l.startsWith("@@")) atAt++;
  }
  return atAt >= 1 || (plusMinus >= 4 && lines.some(l => l.startsWith("diff ") || l.startsWith("---") || l.startsWith("+++")));
}
