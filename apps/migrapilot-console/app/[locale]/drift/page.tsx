"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { pilotApiUrl } from "@/lib/shared/pilot-api";

type DriftSeverity = "info" | "warn" | "critical";
type DriftClassification = "internal" | "client" | "all";
type DriftEnvironment = "dev" | "stage" | "staging" | "prod" | "test";

interface SnapshotMeta {
  snapshotId: string;
  ts: string;
  environment: string;
  classification: DriftClassification;
  note: string | null;
  prevSnapshotId: string | null;
  diffId: string | null;
  severity: DriftSeverity | null;
  affectedTenants: string[];
}

export default function DriftPage() {
  const [environment, setEnvironment] = useState<DriftEnvironment>("prod");
  const [classification, setClassification] = useState<DriftClassification>("all");
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [fromSnapshotId, setFromSnapshotId] = useState("");
  const [toSnapshotId, setToSnapshotId] = useState("");

  async function loadSnapshots() {
    const params = new URLSearchParams({
      env: environment,
      classification,
      limit: "200"
    });
    const response = await fetch(pilotApiUrl(`/api/drift/snapshots?${params.toString()}`), { cache: "no-store" });
    const payload = (await response.json()) as {
      ok: boolean;
      data?: { snapshots: SnapshotMeta[] };
      error?: { message?: string };
    };

    if (!payload.ok || !payload.data) {
      setMessage(payload.error?.message ?? "Failed to load snapshots");
      return;
    }

    setSnapshots(payload.data.snapshots);
    if (!fromSnapshotId && payload.data.snapshots[1]) {
      setFromSnapshotId(payload.data.snapshots[1].snapshotId);
    }
    if (!toSnapshotId && payload.data.snapshots[0]) {
      setToSnapshotId(payload.data.snapshots[0].snapshotId);
    }
  }

  async function captureSnapshot() {
    setCapturing(true);
    try {
      const response = await fetch(pilotApiUrl("/api/drift/snapshot"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          environment,
          classification,
          note: note.trim() || undefined
        })
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: {
          snapshotId: string;
          severity: DriftSeverity | null;
          diffSummary: {
            severity: DriftSeverity;
            affectedTenants: string[];
          } | null;
        };
        error?: { message?: string };
      };

      if (!payload.ok || !payload.data) {
        setMessage(payload.error?.message ?? "Snapshot capture failed");
        return;
      }

      setMessage(
        `Captured ${payload.data.snapshotId}${payload.data.severity ? ` (${payload.data.severity})` : ""}`
      );
      setNote("");
      await loadSnapshots();
    } finally {
      setCapturing(false);
    }
  }

  useEffect(() => {
    void loadSnapshots();
  }, [environment, classification]);

  const lastSeverity = snapshots[0]?.severity ?? null;
  const lastAffectedTenants = useMemo(() => snapshots[0]?.affectedTenants ?? [], [snapshots]);

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Drift Dashboard</h2>
      <p className="small" style={{ color: "var(--muted)" }}>
        Capture deterministic inventory snapshots and inspect drift diffs.
      </p>
      {message ? <div className="small" style={{ marginBottom: 10 }}>{message}</div> : null}

      <div className="panel" style={{ padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <select value={environment} onChange={(event) => setEnvironment(event.target.value as DriftEnvironment)}>
            <option value="dev">dev</option>
            <option value="stage">stage</option>
            <option value="staging">staging</option>
            <option value="prod">prod</option>
            <option value="test">test</option>
          </select>
          <select value={classification} onChange={(event) => setClassification(event.target.value as DriftClassification)}>
            <option value="all">classification: all</option>
            <option value="internal">internal</option>
            <option value="client">client</option>
          </select>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="optional note"
            style={{ minWidth: 220 }}
          />
          <button onClick={() => void captureSnapshot()} disabled={capturing}>
            {capturing ? "Capturing..." : "Capture Snapshot"}
          </button>
          <button onClick={() => void loadSnapshots()}>Refresh</button>
        </div>

        <div className="small" style={{ marginTop: 10, color: "var(--muted)" }}>
          last drift severity: {lastSeverity ?? "none"} | affected tenants: {lastAffectedTenants.join(", ") || "none"}
        </div>
      </div>

      <div className="panel" style={{ padding: 12, marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <label className="small">from</label>
          <select value={fromSnapshotId} onChange={(event) => setFromSnapshotId(event.target.value)}>
            <option value="">select snapshot</option>
            {snapshots.map((snapshot) => (
              <option key={`from-${snapshot.snapshotId}`} value={snapshot.snapshotId}>
                {snapshot.snapshotId}
              </option>
            ))}
          </select>
          <label className="small">to</label>
          <select value={toSnapshotId} onChange={(event) => setToSnapshotId(event.target.value)}>
            <option value="">select snapshot</option>
            {snapshots.map((snapshot) => (
              <option key={`to-${snapshot.snapshotId}`} value={snapshot.snapshotId}>
                {snapshot.snapshotId}
              </option>
            ))}
          </select>
          <Link href={fromSnapshotId && toSnapshotId ? `/drift/diff?from=${fromSnapshotId}&to=${toSnapshotId}` : "/drift"}>
            <button disabled={!fromSnapshotId || !toSnapshotId}>View Diff</button>
          </Link>
        </div>
      </div>

      <div className="panel" style={{ padding: 12, marginTop: 12 }}>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
          Recent snapshots ({snapshots.length})
        </div>
        <div className="scroll" style={{ maxHeight: 520 }}>
          <table className="table">
            <thead>
              <tr>
                <th>snapshotId</th>
                <th>ts</th>
                <th>env/class</th>
                <th>severity</th>
                <th>affectedTenants</th>
                <th>actions</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.map((snapshot) => (
                <tr key={snapshot.snapshotId}>
                  <td>{snapshot.snapshotId}</td>
                  <td>{new Date(snapshot.ts).toLocaleString()}</td>
                  <td>{snapshot.environment} / {snapshot.classification}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        color:
                          snapshot.severity === "critical"
                            ? "var(--danger)"
                            : snapshot.severity === "warn"
                              ? "var(--warn)"
                              : "var(--muted)"
                      }}
                    >
                      {snapshot.severity ?? "n/a"}
                    </span>
                  </td>
                  <td>{snapshot.affectedTenants.join(", ") || "-"}</td>
                  <td style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <Link href={`/drift/${snapshot.snapshotId}`}>
                      <button>Open</button>
                    </Link>
                    {snapshot.prevSnapshotId ? (
                      <Link href={`/drift/diff?from=${snapshot.prevSnapshotId}&to=${snapshot.snapshotId}`}>
                        <button>Diff Prev</button>
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={6} className="small" style={{ color: "var(--muted)" }}>
                    No snapshots captured yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
