"use client";

import { useState } from "react";

export default function JournalPage() {
  const [runId, setRunId] = useState("");
  const [tool, setTool] = useState("");
  const [environment, setEnvironment] = useState("dev");
  const [classification, setClassification] = useState("all");
  const [entries, setEntries] = useState<Array<Record<string, unknown>>>([]);
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null);

  async function load() {
    const url = new URL("/api/journal/list", window.location.origin);
    if (runId.trim()) {
      url.searchParams.set("runId", runId.trim());
    }
    if (tool.trim()) {
      url.searchParams.set("tool", tool.trim());
    }
    url.searchParams.set("environment", environment);
    if (classification !== "all") {
      url.searchParams.set("classification", classification);
    }
    url.searchParams.set("limit", "200");

    const response = await fetch(url.toString());
    const payload = (await response.json()) as {
      ok: boolean;
      data?: { entries: Array<Record<string, unknown>> };
    };

    if (!payload.ok || !payload.data) {
      setEntries([{ error: payload }]);
      return;
    }

    setEntries(payload.data.entries);
    setSelected(payload.data.entries[0] ?? null);
  }

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Journal Explorer</h2>

      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input placeholder="runId" value={runId} onChange={(event) => setRunId(event.target.value)} />
        <input placeholder="tool" value={tool} onChange={(event) => setTool(event.target.value)} />
        <select value={environment} onChange={(event) => setEnvironment(event.target.value)}>
          <option value="dev">dev</option>
          <option value="staging">staging</option>
          <option value="prod">prod</option>
          <option value="test">test</option>
        </select>
        <select value={classification} onChange={(event) => setClassification(event.target.value)}>
          <option value="all">classification all</option>
          <option value="internal">internal</option>
          <option value="client">client</option>
        </select>
        <button onClick={() => void load()}>Search</button>
      </div>

      <div className="grid-2">
        <div className="panel" style={{ padding: 12 }}>
          <div className="small" style={{ marginBottom: 8, color: "var(--muted)" }}>
            Journal entries ({entries.length})
          </div>
          <div className="scroll" style={{ maxHeight: 460 }}>
            {entries.map((entry, index) => (
              <button
                key={`${String(entry.id ?? index)}`}
                style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 6 }}
                onClick={() => setSelected(entry)}
              >
                {String(entry.ts ?? "no-ts")} | {String(entry.tool ?? "unknown")}
              </button>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding: 12 }}>
          <div className="small" style={{ marginBottom: 8, color: "var(--muted)" }}>
            Run detail
          </div>
          <pre className="code">{JSON.stringify(selected ?? {}, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}
