"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { pilotApiUrl } from "../../../lib/shared/pilot-api";

interface Snapshot {
  snapshotId: string;
  ts: string;
  environment: string;
  classification: "internal" | "client" | "all";
  source: "inventory";
  note: string | null;
  registryHash: string | null;
  classificationSummary: {
    internal: number;
    client: number;
  };
  state: {
    tenants: Array<Record<string, unknown>>;
    pods: Array<Record<string, unknown>>;
    domains: Array<Record<string, unknown>>;
    services: Array<Record<string, unknown>>;
    topology: {
      edges: Array<Record<string, unknown>>;
    };
  };
}

interface SnapshotMeta {
  snapshotId: string;
  prevSnapshotId: string | null;
}

export default function DriftSnapshotDetailPage() {
  const params = useParams<{ snapshotId: string }>();
  const snapshotId = params.snapshotId;

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [meta, setMeta] = useState<SnapshotMeta | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [snapshotRes, listRes] = await Promise.all([
      fetch(pilotApiUrl(`/api/drift/snapshots/${snapshotId}`), { cache: "no-store" }),
      fetch(pilotApiUrl("/api/drift/snapshots?limit=400"), { cache: "no-store" })
    ]);

    const snapshotPayload = (await snapshotRes.json()) as {
      ok: boolean;
      data?: { snapshot: Snapshot };
      error?: { message?: string };
    };

    if (!snapshotPayload.ok || !snapshotPayload.data) {
      setMessage(snapshotPayload.error?.message ?? "Snapshot not found");
      return;
    }

    setSnapshot(snapshotPayload.data.snapshot);

    const listPayload = (await listRes.json()) as {
      ok: boolean;
      data?: { snapshots: SnapshotMeta[] };
    };

    if (listPayload.ok && listPayload.data) {
      const found = listPayload.data.snapshots.find((item) => item.snapshotId === snapshotId) ?? null;
      setMeta(found);
    }
  }

  useEffect(() => {
    if (!snapshotId) return;
    void load();
  }, [snapshotId]);

  const counts = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    return {
      tenants: snapshot.state.tenants.length,
      pods: snapshot.state.pods.length,
      domains: snapshot.state.domains.length,
      services: snapshot.state.services.length,
      edges: snapshot.state.topology.edges.length
    };
  }, [snapshot]);

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Snapshot Detail</h2>
      {message ? <div className="small">{message}</div> : null}

      {snapshot ? (
        <>
          <div className="panel" style={{ padding: 12, marginTop: 10 }}>
            <div style={{ fontWeight: 600 }}>{snapshot.snapshotId}</div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
              {new Date(snapshot.ts).toLocaleString()} | env {snapshot.environment} | class {snapshot.classification}
            </div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
              registryHash: {snapshot.registryHash ?? "n/a"}
            </div>
            <div className="small" style={{ color: "var(--muted)", marginTop: 4 }}>
              internal {snapshot.classificationSummary.internal} / client {snapshot.classificationSummary.client}
            </div>
            {snapshot.note ? <div className="small" style={{ marginTop: 6 }}>note: {snapshot.note}</div> : null}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <Link href="/drift">
                <button>Back</button>
              </Link>
              {meta?.prevSnapshotId ? (
                <Link href={`/drift/diff?from=${meta.prevSnapshotId}&to=${snapshot.snapshotId}`}>
                  <button>Diff With Previous</button>
                </Link>
              ) : null}
            </div>
          </div>

          {counts ? (
            <div className="panel" style={{ padding: 12, marginTop: 12 }}>
              <div className="small" style={{ color: "var(--muted)" }}>
                counts: tenants {counts.tenants}, pods {counts.pods}, domains {counts.domains}, services {counts.services}, edges {counts.edges}
              </div>
            </div>
          ) : null}

          <div className="panel" style={{ padding: 12, marginTop: 12 }}>
            <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>Snapshot state</div>
            <pre className="code">{JSON.stringify(snapshot.state, null, 2)}</pre>
          </div>
        </>
      ) : null}
    </section>
  );
}
