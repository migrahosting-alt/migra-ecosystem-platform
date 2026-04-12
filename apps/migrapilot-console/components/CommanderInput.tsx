"use client";

import { useState, useCallback } from "react";
import { pilotApiUrl } from "../lib/shared/pilot-api";

interface CommanderAnalysis {
  interpretedGoal: string;
  impactedEntities: {
    tenants?: string[];
    domains?: string[];
    services?: string[];
  };
  riskLevel: "low" | "medium" | "high";
  expectedTier: number;
  confidence: number;
  recommendation: string;
}

interface CommanderResult {
  analysis: CommanderAnalysis;
  missionProposal: {
    missionId: string;
    status: "proposed";
  };
}

interface CommanderInputProps {
  onResult?: (result: CommanderResult) => void;
}

const QUICK_TEMPLATES = [
  "Investigate critical drift in production",
  "Rollback last failed mission",
  "Scale tenant pod",
  "Re-run failed deployment",
];

const RISK_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#ef4444",
};

export function CommanderInput({ onResult }: CommanderInputProps) {
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CommanderResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (text?: string) => {
      const input = (text ?? goal).trim();
      if (!input) return;
      setLoading(true);
      setError(null);
      setResult(null);
      try {
        const res = await fetch(pilotApiUrl("/api/commander/intent"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ goal: input }),
        });
        const json = await res.json();
        if (json.ok) {
          setResult(json.data);
          onResult?.(json.data);
        } else {
          setError(json.error ?? "Commander failed");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        setLoading(false);
      }
    },
    [goal, onResult],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div>
      {/* Input */}
      <div style={{ position: "relative", marginBottom: "1rem" }}>
        <input
          type="text"
          placeholder="Tell MigraPilot what you want to do…"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          style={{
            width: "100%",
            padding: "0.85rem 1rem",
            fontSize: "1rem",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "rgba(255,255,255,0.04)",
            color: "#eee",
            outline: "none",
          }}
        />
        <button
          onClick={() => void submit()}
          disabled={loading || !goal.trim()}
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            padding: "0.4rem 1rem",
            borderRadius: 6,
            border: "none",
            background: "#3b82f6",
            color: "#fff",
            fontSize: "0.85rem",
            cursor: loading ? "wait" : "pointer",
            opacity: loading || !goal.trim() ? 0.5 : 1,
          }}
        >
          {loading ? "Analyzing…" : "Send"}
        </button>
      </div>

      {/* Quick templates */}
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.25rem" }}>
        {QUICK_TEMPLATES.map((t) => (
          <button
            key={t}
            onClick={() => {
              setGoal(t);
              void submit(t);
            }}
            disabled={loading}
            style={{
              padding: "0.3rem 0.7rem",
              fontSize: "0.75rem",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "transparent",
              color: "#aaa",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <p style={{ color: "#ef4444", fontSize: "0.85rem" }}>{error}</p>
      )}

      {/* Analysis result */}
      {result && <AnalysisPanel result={result} />}
    </div>
  );
}

function AnalysisPanel({ result }: { result: CommanderResult }) {
  const { analysis, missionProposal } = result;
  const riskColor = RISK_COLORS[analysis.riskLevel] ?? "#888";

  return (
    <div
      style={{
        padding: "1rem",
        borderRadius: 8,
        border: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
        <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>Analysis</h3>
        <span
          style={{
            fontSize: "0.75rem",
            padding: "0.15rem 0.6rem",
            borderRadius: 12,
            background: riskColor,
            color: "#fff",
          }}
        >
          {analysis.riskLevel.toUpperCase()} risk
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.6rem", fontSize: "0.82rem", marginBottom: "0.75rem" }}>
        <Detail label="Interpreted goal" value={analysis.interpretedGoal} />
        <Detail label="Expected tier" value={`Tier ${analysis.expectedTier}`} />
        <Detail
          label="Confidence"
          value={`${Math.round(analysis.confidence * 100)}%`}
        />
        <Detail label="Mission ID" value={missionProposal.missionId} />
      </div>

      {/* Impacted entities */}
      {(analysis.impactedEntities.services?.length ||
        analysis.impactedEntities.domains?.length ||
        analysis.impactedEntities.tenants?.length) && (
        <div style={{ marginBottom: "0.75rem" }}>
          <span style={{ fontSize: "0.78rem", color: "#888" }}>Impacted entities:</span>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginTop: "0.25rem" }}>
            {analysis.impactedEntities.services?.map((s) => (
              <Tag key={s} label={s} color="#3b82f6" />
            ))}
            {analysis.impactedEntities.domains?.map((d) => (
              <Tag key={d} label={d} color="#8b5cf6" />
            ))}
            {analysis.impactedEntities.tenants?.map((t) => (
              <Tag key={t} label={t} color="#22c55e" />
            ))}
          </div>
        </div>
      )}

      {/* Recommendation */}
      <p style={{ fontSize: "0.82rem", color: "#ccc", margin: "0 0 0.75rem", lineHeight: 1.4 }}>
        {analysis.recommendation}
      </p>

      {/* Actions */}
      <div style={{ display: "flex", gap: "0.5rem" }}>
        <a
          href={`/missions/${missionProposal.missionId}`}
          style={{
            padding: "0.4rem 1rem",
            borderRadius: 6,
            background: "#3b82f6",
            color: "#fff",
            fontSize: "0.82rem",
            textDecoration: "none",
          }}
        >
          Review Plan
        </a>
        <button
          onClick={async () => {
            try {
              await fetch(pilotApiUrl(`/api/mission/${missionProposal.missionId}/execute`), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
              });
            } catch { /* silent */ }
          }}
          style={{
            padding: "0.4rem 1rem",
            borderRadius: 6,
            border: "1px solid #22c55e",
            background: "transparent",
            color: "#22c55e",
            fontSize: "0.82rem",
            cursor: "pointer",
          }}
        >
          Execute Now
        </button>
        <a
          href={`/missions/${missionProposal.missionId}/modify`}
          style={{
            padding: "0.4rem 1rem",
            borderRadius: 6,
            border: "1px solid rgba(255,255,255,0.12)",
            background: "transparent",
            color: "#aaa",
            fontSize: "0.82rem",
            textDecoration: "none",
          }}
        >
          Modify
        </a>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span style={{ fontSize: "0.72rem", color: "#888" }}>{label}</span>
      <br />
      <span style={{ color: "#ddd" }}>{value}</span>
    </div>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: "0.72rem",
        padding: "0.1rem 0.5rem",
        borderRadius: 12,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {label}
    </span>
  );
}
