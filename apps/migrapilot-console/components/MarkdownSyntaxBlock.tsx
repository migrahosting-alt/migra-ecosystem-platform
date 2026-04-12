"use client";

import { useState, useCallback } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { pilotApiUrl } from "../lib/shared/pilot-api";

function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export function MarkdownSyntaxBlock({
  language,
  children,
}: {
  language: string;
  children: string;
}) {
  const [copied, setCopied] = useState(false);
  const [applied, setApplied] = useState<"idle" | "applying" | "done" | "error">("idle");

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  const handleApply = useCallback(async () => {
    // Extract file path from first line comment like "// filepath: src/foo.ts" or "# filepath: src/foo.ts"
    const firstLine = children.split("\n")[0] ?? "";
    const pathMatch = firstLine.match(/(?:\/\/|#|--|<!--)\s*(?:filepath|file|path):\s*(.+?)(?:\s*-->)?$/i);
    if (!pathMatch) {
      // If no filepath annotation, copy to clipboard instead
      await handleCopy();
      return;
    }
    const filePath = pathMatch[1].trim();
    const codeContent = children.split("\n").slice(1).join("\n");

    setApplied("applying");
    try {
      const res = await fetch(pilotApiUrl("/api/pilot/chat/stream"), {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({
          message: `Apply this code to ${filePath}:\n\`\`\`${language}\n${codeContent}\n\`\`\``,
          dryRun: false,
        }),
      });
      setApplied(res.ok ? "done" : "error");
    } catch {
      setApplied("error");
    }
    setTimeout(() => setApplied("idle"), 3000);
  }, [children, language, handleCopy]);

  return (
    <div style={{ position: "relative", margin: "8px 0" }}>
      {/* Action buttons */}
      <div style={{
        position: "absolute", top: 4, right: 4, display: "flex", gap: 4, zIndex: 2,
      }}>
        <button
          onClick={() => void handleCopy()}
          title="Copy code"
          style={{
            background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer",
            color: copied ? "#34d399" : "#94a3b8", fontFamily: "var(--mono)",
            transition: "all 0.15s",
          }}
        >
          {copied ? "✓ Copied" : "Copy"}
        </button>
        <button
          onClick={() => void handleApply()}
          title="Apply code to file"
          style={{
            background: "rgba(56,189,248,0.1)", border: "1px solid rgba(56,189,248,0.2)",
            borderRadius: 4, padding: "3px 8px", fontSize: 10, cursor: "pointer",
            color: applied === "done" ? "#34d399" : applied === "error" ? "#f87171" : "#38bdf8",
            fontFamily: "var(--mono)", transition: "all 0.15s",
          }}
        >
          {applied === "done" ? "✓ Applied" : applied === "error" ? "✗ Failed" : applied === "applying" ? "…" : "Apply"}
        </button>
      </div>

      {/* Language label */}
      {language !== "text" && (
        <div style={{
          position: "absolute", top: 4, left: 12, fontSize: 9, color: "rgba(148,163,184,0.6)",
          fontFamily: "var(--mono)", textTransform: "uppercase", letterSpacing: 0.5,
        }}>
          {language}
        </div>
      )}

      <SyntaxHighlighter
        style={vscDarkPlus as any}
        language={language}
        PreTag="div"
        customStyle={{
          borderRadius: 8,
          fontSize: 12,
          padding: "28px 12px 12px",
          border: "1px solid var(--line)",
        }}
      >
        {children}
      </SyntaxHighlighter>
    </div>
  );
}