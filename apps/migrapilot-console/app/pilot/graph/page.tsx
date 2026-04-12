"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchGraphNodes,
  fetchImpact,
  fetchDependencies,
  type V1GraphNode,
  type V1ImpactResponse,
  type V1DependenciesResponse,
} from "@/lib/api/pilotV1";

/* ── Colors ── */
const TYPE_COLOR: Record<string, string> = {
  SERVICE: "#4ade80",
  INFRASTRUCTURE_NODE: "#60a5fa",
  TENANT: "#fbbf24",
  DOMAIN: "#a78bfa",
  DNS_ZONE: "#818cf8",
  CERTIFICATE: "#34d399",
  ROUTE: "#f472b6",
  PRODUCT: "#fb923c",
  MAILBOX: "#38bdf8",
  STORAGE_BUCKET: "#94a3b8",
  PHONE_NUMBER: "#e879f9",
  HOSTING_SITE: "#2dd4bf",
  DEPLOYMENT_RELEASE: "#a3e635",
  INCIDENT: "#f87171",
  BILLING_ACCOUNT: "#fcd34d",
  OTHER: "#6b7280",
};

const STATUS_DOT: Record<string, string> = {
  healthy: "#4ade80",
  active: "#4ade80",
  operational: "#4ade80",
  degraded: "#fbbf24",
  unhealthy: "#f87171",
  down: "#f87171",
  unknown: "#6b7280",
};

const BLAST_COLOR: Record<string, string> = {
  none: "#4ade80",
  low: "#fbbf24",
  medium: "#fb923c",
  high: "#f87171",
};

export default function ResourceGraphPage() {
  const [nodes, setNodes] = useState<V1GraphNode[]>([]);
  const [typeBreakdown, setTypeBreakdown] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<V1GraphNode | null>(null);
  const [impact, setImpact] = useState<V1ImpactResponse | null>(null);
  const [deps, setDeps] = useState<V1DependenciesResponse | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const [filterType, setFilterType] = useState<string>("all");

  const loadNodes = useCallback(async () => {
    try {
      const res = await fetchGraphNodes();
      setNodes(res.nodes);
      setTypeBreakdown(res.typeBreakdown);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNodes();
  }, [loadNodes]);

  async function analyzeNode(node: V1GraphNode) {
    setSelectedNode(node);
    setAnalysisLoading(true);
    try {
      const [i, d] = await Promise.all([
        fetchImpact(node.id),
        fetchDependencies(node.id),
      ]);
      setImpact(i);
      setDeps(d);
    } catch (err) {
      setError(String(err));
    } finally {
      setAnalysisLoading(false);
    }
  }

  const filteredNodes =
    filterType === "all"
      ? nodes
      : nodes.filter((n) => n.nodeType === filterType);

  if (loading) {
    return (
      <div style={{ padding: 32, color: "var(--fg-dim)" }}>
        Loading resource graph...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, color: "var(--danger)" }}>
        Error: {error}
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1200 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>
        Resource Graph
      </h1>
      <p style={{ color: "var(--fg-dim)", marginBottom: 24 }}>
        Platform resource nodes and dependency analysis (§16 — Resource Graph Engine)
      </p>

      {/* Type breakdown chips */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        <button
          onClick={() => setFilterType("all")}
          style={{
            padding: "4px 12px",
            borderRadius: 12,
            border: filterType === "all" ? "2px solid var(--accent)" : "1px solid var(--border)",
            background: "transparent",
            color: "var(--fg)",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          All ({nodes.length})
        </button>
        {Object.entries(typeBreakdown)
          .sort(([, a], [, b]) => b - a)
          .map(([type, count]) => (
            <button
              key={type}
              onClick={() => setFilterType(type)}
              style={{
                padding: "4px 12px",
                borderRadius: 12,
                border: filterType === type ? "2px solid var(--accent)" : "1px solid var(--border)",
                background: "transparent",
                color: TYPE_COLOR[type] ?? "var(--fg)",
                cursor: "pointer",
                fontSize: 12,
              }}
            >
              {type} ({count})
            </button>
          ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        {/* Node list */}
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12 }}>
            Nodes ({filteredNodes.length})
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {filteredNodes.map((node) => (
              <button
                key={node.id}
                onClick={() => analyzeNode(node)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  border:
                    selectedNode?.id === node.id
                      ? "2px solid var(--accent)"
                      : "1px solid var(--border)",
                  borderRadius: 8,
                  background: selectedNode?.id === node.id ? "var(--bg-hover)" : "var(--bg-card)",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--fg)",
                  width: "100%",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: STATUS_DOT[node.status] ?? STATUS_DOT.unknown,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {node.displayName}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--fg-dim)" }}>
                    <span style={{ color: TYPE_COLOR[node.nodeType] ?? "var(--fg-dim)" }}>
                      {node.nodeType}
                    </span>
                    {node.product && (
                      <span> · {node.product}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
            {filteredNodes.length === 0 && (
              <div style={{ color: "var(--fg-dim)", fontStyle: "italic", padding: 16 }}>
                No resource nodes found. Seed the resource graph to see nodes here.
              </div>
            )}
          </div>
        </div>

        {/* Analysis panel */}
        <div>
          {selectedNode ? (
            analysisLoading ? (
              <div style={{ color: "var(--fg-dim)", padding: 16 }}>
                Analyzing {selectedNode.displayName}...
              </div>
            ) : (
              <div>
                <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                  {selectedNode.displayName}
                </h2>
                <div style={{ fontSize: 12, color: "var(--fg-dim)", marginBottom: 16 }}>
                  {selectedNode.nodeType} · {selectedNode.status}
                  {selectedNode.product && ` · ${selectedNode.product}`}
                </div>

                {/* Blast radius */}
                {impact && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-card)",
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Blast Radius
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontSize: 20,
                          fontWeight: 700,
                          color: BLAST_COLOR[impact.blastRadius] ?? "var(--fg)",
                        }}
                      >
                        {impact.blastRadius.toUpperCase()}
                      </span>
                      <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                        ({impact.impactedCount} resource{impact.impactedCount !== 1 ? "s" : ""} affected)
                      </span>
                    </div>
                    {impact.impactedCount > 0 && (
                      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                        {impact.impactedResources.map((r) => (
                          <div
                            key={r.id}
                            style={{
                              fontSize: 12,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: STATUS_DOT[r.status] ?? STATUS_DOT.unknown,
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ color: TYPE_COLOR[r.nodeType] ?? "var(--fg-dim)" }}>
                              {r.nodeType}
                            </span>
                            <span>{r.displayName}</span>
                            <span style={{ color: "var(--fg-dim)" }}>
                              ({r.relationship})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Dependencies */}
                {deps && (
                  <div
                    style={{
                      padding: "12px 16px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg-card)",
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                      Dependencies ({deps.dependencyCount})
                    </div>
                    {deps.dependencyCount === 0 ? (
                      <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>
                        No upstream dependencies recorded.
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {deps.dependencies.map((d) => (
                          <div
                            key={d.id}
                            style={{
                              fontSize: 12,
                              display: "flex",
                              alignItems: "center",
                              gap: 6,
                            }}
                          >
                            <span
                              style={{
                                width: 6,
                                height: 6,
                                borderRadius: "50%",
                                background: STATUS_DOT[d.status] ?? STATUS_DOT.unknown,
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ color: TYPE_COLOR[d.nodeType] ?? "var(--fg-dim)" }}>
                              {d.nodeType}
                            </span>
                            <span>{d.displayName}</span>
                            <span style={{ color: "var(--fg-dim)" }}>
                              ({d.relationship})
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          ) : (
            <div
              style={{
                color: "var(--fg-dim)",
                padding: 32,
                textAlign: "center",
                border: "1px dashed var(--border)",
                borderRadius: 8,
              }}
            >
              Select a node to analyze impact and dependencies
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
