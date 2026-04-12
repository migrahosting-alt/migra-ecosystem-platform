"use client";

import { RunCard } from "./RunCard";
import type { TimelineRun } from "../lib/shared/types";

interface ProposedToolCall {
  toolName: string;
  input: Record<string, unknown>;
}

interface ConsoleSideRailProps {
  proposed: ProposedToolCall[];
  runs: TimelineRun[];
  onExecuteAllProposed: () => void;
  onExecuteToolCall: (toolName: string, input: Record<string, unknown>, stepIndex?: number) => void;
  onRefreshState: () => void;
}

export function ConsoleSideRail({
  proposed,
  runs,
  onExecuteAllProposed,
  onExecuteToolCall,
  onRefreshState,
}: ConsoleSideRailProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {proposed.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              <h2 style={{ margin: 0 }}>Proposed Actions</h2>
              <span className="badge-accent" style={{ fontSize: 10 }}>{proposed.length}</span>
            </div>
            <button className="btn-primary btn-sm" onClick={onExecuteAllProposed}>
              {"▶"} Run All
            </button>
          </div>
          <div style={{ padding: 14, display: "grid", gap: 8 }}>
            {proposed.map((call, index) => (
              <div
                key={`${call.toolName}-${index}`}
                className="proposed-card fade-in"
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 22, height: 22, borderRadius: 6, fontSize: 11, fontWeight: 700,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--accent-glow)", color: "var(--accent)",
                    }}>
                      {index + 1}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", fontFamily: "var(--mono)" }}>
                      {call.toolName}
                    </span>
                  </div>
                  <button
                    className="btn-primary btn-sm"
                    onClick={() => onExecuteToolCall(call.toolName, call.input, index)}
                    style={{ fontSize: 11 }}
                  >
                    {"▶"} Run
                  </button>
                </div>
                <pre className="code" style={{ marginTop: 8, fontSize: 11, maxHeight: 100, overflow: "auto" }}>
                  {JSON.stringify(call.input, null, 2)}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="panel" style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 400 }}>
        <div className="panel-header">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--fg-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
            <h2 style={{ margin: 0 }}>Run Timeline</h2>
            {runs.length > 0 && (
              <span className="badge" style={{ fontSize: 10 }}>{runs.length}</span>
            )}
          </div>
          <button className="btn-ghost btn-sm" onClick={onRefreshState}>
            {"↻"} Refresh
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {runs.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", minHeight: 160, gap: 10,
            }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: "rgba(255,255,255,0.03)", border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--fg-dim)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
              </div>
              <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>No runs yet</div>
              <div style={{ fontSize: 11, color: "var(--fg-dim)", opacity: 0.6 }}>
                Execute a tool call to see results here
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {runs.map((run) => <RunCard key={run.id} run={run} />)}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}