"use client";

import { useEffect, useState, useCallback } from "react";
import {
  fetchEdges,
  type V1EdgeRoute,
  type V1DomainRecord,
} from "@/lib/api/pilotV1";

const STATUS_COLOR: Record<string, string> = {
  active: "#4ade80",
  draining: "#fbbf24",
  inactive: "#6b7280",
  pending: "#fbbf24",
  suspended: "#f87171",
  expired: "#f87171",
};

const SSL_COLOR: Record<string, string> = {
  active: "#4ade80",
  pending: "#fbbf24",
  expired: "#f87171",
  none: "#6b7280",
};

export default function EdgeControlPage() {
  const [routes, setRoutes] = useState<V1EdgeRoute[]>([]);
  const [domains, setDomains] = useState<V1DomainRecord[]>([]);
  const [routeStats, setRouteStats] = useState({ total: 0, active: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"routes" | "domains">("routes");

  const loadData = useCallback(async () => {
    try {
      const res = await fetchEdges();
      setRoutes(res.routes.items);
      setRouteStats({ total: res.routes.total, active: res.routes.active });
      setDomains(res.domains.items);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div style={{ padding: 32, color: "var(--fg-dim)" }}>
        Loading edge control data...
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
        Edge Control
      </h1>
      <p style={{ color: "var(--fg-dim)", marginBottom: 24 }}>
        Route registry, domain management, and TLS status (§14 — Edge Control Engine)
      </p>

      {/* Stats */}
      <div style={{ display: "flex", gap: 16, marginBottom: 24 }}>
        <div
          style={{
            padding: "12px 20px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700 }}>{routeStats.total}</div>
          <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>Routes</div>
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: "var(--ok)" }}>
            {routeStats.active}
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>Active Routes</div>
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700 }}>{domains.length}</div>
          <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>Domains</div>
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, color: "#4ade80" }}>
            {domains.filter((d) => d.sslStatus === "active").length}
          </div>
          <div style={{ fontSize: 12, color: "var(--fg-dim)" }}>SSL Active</div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16 }}>
        {(["routes", "domains"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: tab === t ? "var(--accent)" : "transparent",
              color: tab === t ? "#fff" : "var(--fg-dim)",
              cursor: "pointer",
              fontWeight: tab === t ? 600 : 400,
              fontSize: 13,
            }}
          >
            {t === "routes" ? "Routes" : "Domains"}
          </button>
        ))}
      </div>

      {/* Routes table */}
      {tab === "routes" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Domain</th>
                <th style={{ padding: "8px 12px" }}>Path</th>
                <th style={{ padding: "8px 12px" }}>Upstream</th>
                <th style={{ padding: "8px 12px" }}>TLS</th>
                <th style={{ padding: "8px 12px" }}>Status</th>
                <th style={{ padding: "8px 12px" }}>Server</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{r.domain}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace" }}>{r.path}</td>
                  <td style={{ padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>
                    {r.upstream}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ textTransform: "uppercase", fontSize: 11 }}>
                      {r.tlsPolicy}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: STATUS_COLOR[r.status] ?? "var(--fg-dim)",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: STATUS_COLOR[r.status] ?? "#6b7280",
                        }}
                      />
                      {r.status}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--fg-dim)" }}>
                    {r.server}
                  </td>
                </tr>
              ))}
              {routes.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "var(--fg-dim)",
                      fontStyle: "italic",
                    }}
                  >
                    No edge routes registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Domains table */}
      {tab === "domains" && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                <th style={{ padding: "8px 12px" }}>Domain</th>
                <th style={{ padding: "8px 12px" }}>Status</th>
                <th style={{ padding: "8px 12px" }}>DNS Managed</th>
                <th style={{ padding: "8px 12px" }}>SSL</th>
                <th style={{ padding: "8px 12px" }}>SSL Expiry</th>
              </tr>
            </thead>
            <tbody>
              {domains.map((d) => (
                <tr
                  key={d.id}
                  style={{ borderBottom: "1px solid var(--border)" }}
                >
                  <td style={{ padding: "8px 12px", fontWeight: 600 }}>{d.domain}</td>
                  <td style={{ padding: "8px 12px" }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        color: STATUS_COLOR[d.status] ?? "var(--fg-dim)",
                      }}
                    >
                      <span
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: "50%",
                          background: STATUS_COLOR[d.status] ?? "#6b7280",
                        }}
                      />
                      {d.status}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    {d.dnsManaged ? (
                      <span style={{ color: "#4ade80" }}>Managed</span>
                    ) : (
                      <span style={{ color: "var(--fg-dim)" }}>External</span>
                    )}
                  </td>
                  <td style={{ padding: "8px 12px" }}>
                    <span style={{ color: SSL_COLOR[d.sslStatus] ?? "var(--fg-dim)" }}>
                      {d.sslStatus}
                    </span>
                  </td>
                  <td style={{ padding: "8px 12px", color: "var(--fg-dim)" }}>
                    {d.sslExpiry ?? "—"}
                  </td>
                </tr>
              ))}
              {domains.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{
                      padding: 24,
                      textAlign: "center",
                      color: "var(--fg-dim)",
                      fontStyle: "italic",
                    }}
                  >
                    No domain records registered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
