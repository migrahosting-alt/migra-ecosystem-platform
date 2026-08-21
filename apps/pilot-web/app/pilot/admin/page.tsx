"use client";

import { useEffect, useState } from "react";

/* ── Types ── */
interface ProviderStat {
  tag: string;
  runs: number;
  avgDurationMs: number;
  toolCalls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
}

interface RunRow {
  id: string;
  conversationId: string;
  status: string;
  provider: string;
  model: string;
  startedAt: string;
  endedAt: string | null;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costEstimate: number;
  escalationReason: string | null;
  toolCallCount: number;
  toolCallsFailed: number;
}

interface AdminData {
  totalRuns: number;
  grandTotalTokens: number;
  grandTotalCost: number;
  providers: ProviderStat[];
  runs: RunRow[];
}

const API = process.env.NEXT_PUBLIC_PILOT_API_BASE ?? "http://localhost:3377";

export default function PilotAdminPage() {
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/api/pilot/admin/stats`)
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setData(j.data);
        else setError(j.error ?? "Unknown error");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <h1 style={styles.h1}>MigraPilot Admin</h1>
        <span style={styles.badge}>3-Brain LLM Dashboard</span>
      </header>

      {loading && <p style={styles.dim}>Loading...</p>}
      {error && <p style={styles.error}>Error: {error}</p>}

      {data && (
        <>
          {/* ── Summary Cards ── */}
          <section style={styles.cardRow}>
            <Card label="Total Runs" value={data.totalRuns} />
            <Card label="Total Tokens" value={data.grandTotalTokens.toLocaleString()} />
            <Card label="Est. Cost" value={`$${data.grandTotalCost.toFixed(4)}`} color="#dcdcaa" />
          </section>

          {/* ── Provider Breakdown ── */}
          <section style={styles.section}>
            <h2 style={styles.h2}>Provider Usage</h2>
            <table style={styles.table}>
              <thead>
                <tr>
                  <Th>Provider</Th>
                  <Th>Runs</Th>
                  <Th>Avg Duration</Th>
                  <Th>Input Tok</Th>
                  <Th>Output Tok</Th>
                  <Th>Total Tok</Th>
                  <Th>Cost</Th>
                  <Th>Tool Calls</Th>
                  <Th>Failures</Th>
                </tr>
              </thead>
              <tbody>
                {data.providers.map((p) => (
                  <tr key={p.tag}>
                    <Td>{tagBadge(p.tag)}</Td>
                    <Td>{p.runs}</Td>
                    <Td>{p.avgDurationMs}ms</Td>
                    <Td>{p.inputTokens.toLocaleString()}</Td>
                    <Td>{p.outputTokens.toLocaleString()}</Td>
                    <Td style={{ fontWeight: 600 }}>{p.totalTokens.toLocaleString()}</Td>
                    <Td style={{ color: "#dcdcaa" }}>${p.totalCost.toFixed(4)}</Td>
                    <Td>{p.toolCalls}</Td>
                    <Td style={p.failures > 0 ? { color: "#f48771" } : undefined}>{p.failures}</Td>
                  </tr>
                ))}
                {data.providers.length === 0 && (
                  <tr><Td colSpan={9}>No runs yet</Td></tr>
                )}
              </tbody>
            </table>
          </section>

          {/* ── Recent Runs ── */}
          <section style={styles.section}>
            <h2 style={styles.h2}>Recent Runs (last 100)</h2>
            <div style={styles.tableScroll}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <Th>Run ID</Th>
                    <Th>Provider</Th>
                    <Th>Model</Th>
                    <Th>Status</Th>
                    <Th>Duration</Th>
                    <Th>Tokens</Th>
                    <Th>Cost</Th>
                    <Th>Escalation</Th>
                    <Th>Tools</Th>
                    <Th>Started</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.runs.map((r) => (
                    <tr key={r.id}>
                      <Td><code style={styles.code}>{r.id.slice(0, 8)}</code></Td>
                      <Td>{tagBadge(r.provider)}</Td>
                      <Td style={styles.dim}>{r.model}</Td>
                      <Td>{statusBadge(r.status)}</Td>
                      <Td>{r.durationMs != null ? `${r.durationMs}ms` : "\u2014"}</Td>
                      <Td>{r.totalTokens.toLocaleString()}</Td>
                      <Td style={{ color: "#dcdcaa" }}>${r.costEstimate.toFixed(4)}</Td>
                      <Td style={styles.dim}>{r.escalationReason ?? "\u2014"}</Td>
                      <Td>
                        {r.toolCallCount}
                        {r.toolCallsFailed > 0 && <span style={{ color: "#f48771" }}> ({r.toolCallsFailed} fail)</span>}
                      </Td>
                      <Td style={styles.dim}>{new Date(r.startedAt).toLocaleString()}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ── Helpers ── */
function Card({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.cardValue, color: color ?? "#4ec9b0" }}>{value}</div>
      <div style={styles.cardLabel}>{label}</div>
    </div>
  );
}

function tagBadge(tag: string) {
  const map: Record<string, { color: string; icon: string }> = {
    local:  { color: "#4ec9b0", icon: "\uD83D\uDFE2" },
    sonnet: { color: "#569cd6", icon: "\uD83D\uDFE1" },
    opus:   { color: "#c586c0", icon: "\uD83D\uDD34" },
  };
  const info = map[tag] ?? { color: "#888", icon: "\u26AA" };
  return (
    <span style={{ ...styles.tag, borderColor: info.color, color: info.color }}>
      {info.icon} {tag}
    </span>
  );
}

function statusBadge(status: string) {
  const color =
    status === "COMPLETED" ? "#4ec9b0" :
    status === "RUNNING" ? "#dcdcaa" :
    status === "PENDING_APPROVAL" ? "#ce9178" :
    "#f48771";
  return <span style={{ color, fontWeight: 600 }}>{status}</span>;
}

function Th({ children, ...rest }: React.ThHTMLAttributes<HTMLTableCellElement> & { children: React.ReactNode }) {
  return <th style={styles.th} {...rest}>{children}</th>;
}

function Td({ children, style: extra, ...rest }: React.TdHTMLAttributes<HTMLTableCellElement> & { children: React.ReactNode }) {
  return <td style={{ ...styles.td, ...extra }} {...rest}>{children}</td>;
}

/* ── Styles -- VS Code dark theme ── */
const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "#1e1e1e",
    color: "#cccccc",
    fontFamily: "var(--vscode-font-family, 'Segoe UI', system-ui, sans-serif)",
    fontSize: 13,
    padding: "24px 32px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 24,
    borderBottom: "1px solid #333",
    paddingBottom: 12,
  },
  h1: { fontSize: 18, fontWeight: 600, color: "#e7e7e7", margin: 0 },
  h2: { fontSize: 14, fontWeight: 600, color: "#e7e7e7", margin: "0 0 8px" },
  badge: {
    fontSize: 11,
    padding: "2px 8px",
    borderRadius: 4,
    background: "#333",
    color: "#9cdcfe",
  },
  dim: { color: "#888" },
  error: { color: "#f48771" },
  cardRow: { display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" as const },
  card: {
    background: "#252526",
    border: "1px solid #333",
    borderRadius: 6,
    padding: "16px 24px",
    minWidth: 160,
  },
  cardValue: { fontSize: 24, fontWeight: 700 },
  cardLabel: { fontSize: 11, color: "#888", marginTop: 4 },
  section: { marginBottom: 24 },
  tableScroll: { overflowX: "auto" as const },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    background: "#252526",
    borderRadius: 6,
  },
  th: {
    textAlign: "left" as const,
    padding: "8px 12px",
    fontSize: 11,
    fontWeight: 600,
    color: "#9cdcfe",
    borderBottom: "1px solid #333",
    whiteSpace: "nowrap" as const,
  },
  td: {
    padding: "6px 12px",
    borderBottom: "1px solid #2a2a2a",
    whiteSpace: "nowrap" as const,
  },
  code: {
    fontFamily: "var(--vscode-editor-font-family, 'Cascadia Code', 'Fira Code', monospace)",
    fontSize: 12,
    color: "#ce9178",
  },
  tag: {
    display: "inline-block",
    padding: "1px 6px",
    border: "1px solid",
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600,
  },
};
