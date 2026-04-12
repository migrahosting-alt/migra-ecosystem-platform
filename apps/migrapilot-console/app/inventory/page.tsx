"use client";

import { useEffect, useState } from "react";

type Resource = "tenants" | "pods" | "domains" | "services";

export default function InventoryPage() {
  const [resource, setResource] = useState<Resource>("tenants");
  const [classification, setClassification] = useState<"all" | "internal" | "client">("all");
  const [environment, setEnvironment] = useState<"prod" | "staging" | "dev">("prod");
  const [payload, setPayload] = useState<Record<string, unknown> | null>(null);
  const [overlay, setOverlay] = useState<Record<string, unknown> | null>(null);

  async function load() {
    const url = new URL(`/api/inventory/${resource}`, window.location.origin);
    if (classification !== "all") {
      url.searchParams.set("classification", classification);
    }
    url.searchParams.set("environment", environment);
    url.searchParams.set("limit", "100");

    const response = await fetch(url.toString());
    const result = (await response.json()) as {
      ok: boolean;
      data?: { payload: Record<string, unknown>; overlay: Record<string, unknown> };
    };

    if (!result.ok || !result.data) {
      setPayload({ error: result });
      setOverlay(null);
      return;
    }

    setPayload(result.data.payload);
    setOverlay(result.data.overlay);
  }

  useEffect(() => {
    void load();
  }, [resource, classification, environment]);

  async function copyId(value: string) {
    await navigator.clipboard.writeText(value);
  }

  const rows = Array.isArray(payload?.items)
    ? (payload?.items as Array<Record<string, unknown>>)
    : resource === "services"
      ? ((payload?.services as Array<Record<string, unknown>>) ?? [])
      : [];

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Inventory Explorer</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <select value={resource} onChange={(event) => setResource(event.target.value as Resource)}>
          <option value="tenants">tenants</option>
          <option value="pods">pods</option>
          <option value="domains">domains</option>
          <option value="services">services/topology</option>
        </select>

        <select
          value={classification}
          onChange={(event) => setClassification(event.target.value as "all" | "internal" | "client")}
        >
          <option value="all">classification: all</option>
          <option value="internal">internal</option>
          <option value="client">client</option>
        </select>

        <select value={environment} onChange={(event) => setEnvironment(event.target.value as "prod" | "staging" | "dev")}> 
          <option value="prod">prod</option>
          <option value="staging">staging</option>
          <option value="dev">dev</option>
        </select>

        <button onClick={() => void load()}>Refresh</button>
      </div>

      {overlay ? (
        <div className="small" style={{ marginBottom: 10, color: "var(--muted)" }}>
          tool {String(overlay.toolName)} | effectiveTier {String(overlay.effectiveTier)} | runner {String(overlay.runnerType)}
        </div>
      ) : null}

      <div className="grid-2">
        <div className="panel" style={{ padding: 12 }}>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            Structured view
          </div>

          <table className="table">
            <thead>
              <tr>
                <th>ID</th>
                <th>classification</th>
                <th>ownerOrg</th>
                <th>copy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const id =
                  (row.tenantId as string | undefined) ??
                  (row.podId as string | undefined) ??
                  (row.domain as string | undefined) ??
                  (row.serviceId as string | undefined) ??
                  `row-${index}`;
                return (
                  <tr key={`${resource}-${id}`}> 
                    <td>{id}</td>
                    <td>{String(row.classification ?? "-")}</td>
                    <td>{String(row.ownerOrg ?? "-")}</td>
                    <td>
                      <button onClick={() => void copyId(id)}>Copy ID</button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="small" style={{ color: "var(--muted)" }}>
                    No rows for selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="panel" style={{ padding: 12 }}>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            Raw payload
          </div>
          <pre className="code">{JSON.stringify(payload ?? {}, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}
