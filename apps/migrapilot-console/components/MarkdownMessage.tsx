"use client";

import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const CodeBlock = dynamic(() => import("./MarkdownSyntaxBlock").then((mod) => mod.MarkdownSyntaxBlock), {
  ssr: false,
  loading: () => <pre className="code" style={{ fontSize: 12, margin: "8px 0" }}>Loading code block…</pre>,
});

/**
 * Renders assistant (or any) text as rich Markdown with:
 *   - GFM (tables, strikethrough, task lists, autolinks)
 *   - Syntax-highlighted fenced code blocks (VS Code Dark+ theme)
 *   - Styled inline code, tables, blockquotes, lists, headings
 */
export function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="md-msg">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code(props) {
            const { children, className, ...rest } = props;
            const match = /language-(\w+)/.exec(className || "");
            const inline = !match && !String(children).includes("\n");
            if (inline) {
              return (
                <code
                  style={{
                    background: "rgba(255,255,255,0.06)",
                    padding: "1px 5px",
                    borderRadius: 3,
                    fontSize: 12,
                    fontFamily: "var(--mono)",
                  }}
                  {...rest}
                >
                  {children}
                </code>
              );
            }
            return (
              <CodeBlock language={match?.[1] ?? "text"}>
                {String(children).replace(/\n$/, "")}
              </CodeBlock>
            );
          },
          p({ children }) {
            return <p style={{ margin: "6px 0" }}>{children}</p>;
          },
          ul({ children }) {
            return <ul style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ul>;
          },
          ol({ children }) {
            return <ol style={{ margin: "4px 0", paddingLeft: 20 }}>{children}</ol>;
          },
          li({ children }) {
            return <li style={{ marginBottom: 2 }}>{children}</li>;
          },
          h1({ children }) {
            return (
              <h1
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  margin: "12px 0 6px",
                  color: "var(--text)",
                }}
              >
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  margin: "10px 0 4px",
                  color: "var(--text)",
                }}
              >
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  margin: "8px 0 4px",
                  color: "var(--text)",
                }}
              >
                {children}
              </h3>
            );
          },
          table({ children }) {
            return (
              <table
                style={{
                  borderCollapse: "collapse",
                  margin: "8px 0",
                  fontSize: 12,
                  width: "100%",
                }}
              >
                {children}
              </table>
            );
          },
          th({ children }) {
            return (
              <th
                style={{
                  border: "1px solid var(--line)",
                  padding: "4px 8px",
                  background: "var(--panel-2)",
                  fontWeight: 600,
                  textAlign: "left",
                }}
              >
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td style={{ border: "1px solid var(--line)", padding: "4px 8px" }}>
                {children}
              </td>
            );
          },
          a({ children, href }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote
                style={{
                  borderLeft: "3px solid var(--accent)",
                  paddingLeft: 12,
                  margin: "6px 0",
                  color: "var(--muted)",
                }}
              >
                {children}
              </blockquote>
            );
          },
          strong({ children }) {
            return (
              <strong style={{ fontWeight: 700, color: "var(--text)" }}>
                {children}
              </strong>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
