"use client";

import { useMemo, useState } from "react";

interface DiffResponse {
  ok: boolean;
  data?: {
    payload: {
      diff?: string;
      truncated?: boolean;
    };
    overlay: {
      effectiveTier: number;
      jobId?: string;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

function splitDiffFiles(diff: string): Array<{ file: string; body: string }> {
  if (!diff.trim()) {
    return [];
  }
  const chunks = diff.split("diff --git ");
  return chunks
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const line = chunk.split("\n")[0] ?? "unknown";
      const file = line.split(" b/")[1] ?? line;
      return {
        file,
        body: `diff --git ${chunk}`
      };
    });
}

export default function DiffsPage() {
  const [path, setPath] = useState("");
  const [staged, setStaged] = useState(false);
  const [diff, setDiff] = useState("");
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [patch, setPatch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [overlayTier, setOverlayTier] = useState<number | null>(null);

  const files = useMemo(() => splitDiffFiles(diff), [diff]);

  async function loadDiff() {
    const url = new URL("/api/repo/diff", window.location.origin);
    if (path.trim()) {
      url.searchParams.set("path", path.trim());
    }
    if (staged) {
      url.searchParams.set("staged", "1");
    }

    const response = await fetch(url.toString());
    const payload = (await response.json()) as DiffResponse;
    if (!payload.ok || !payload.data) {
      setMessage(payload.error?.message ?? "Failed to load diff");
      return;
    }

    const diffText = payload.data.payload.diff ?? "";
    setDiff(diffText);
    setSelectedFile(splitDiffFiles(diffText)[0]?.file ?? null);
    setOverlayTier(payload.data.overlay.effectiveTier);
    setMessage(payload.data.payload.truncated ? "Diff truncated by maxBytes" : null);
  }

  async function applyPatch() {
    if (!patch.trim()) {
      setMessage("Paste a patch first");
      return;
    }
    const response = await fetch("/api/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        toolName: "repo.applyPatch",
        runnerTarget: "local",
        environment: "dev",
        operator: { operatorId: "bonex", role: "owner" },
        toolInput: {
          patch,
          idempotencyKey: `patch-${Date.now()}`
        }
      })
    });

    if (response.ok) {
      setMessage("Apply patch submitted. Check Journal/Console for final result.");
    } else {
      setMessage(`Apply patch request failed: HTTP ${response.status}`);
    }
  }

  const selectedDiff = selectedFile
    ? files.find((file) => file.file === selectedFile)?.body ?? ""
    : diff;

  return (
    <section className="panel" style={{ padding: 16 }}>
      <h2 style={{ marginTop: 0 }}>Diff Viewer</h2>
      <p className="small" style={{ color: "var(--muted)" }}>
        Review unified diff and stage patch application through policy-gated execution.
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          placeholder="optional path"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          style={{ width: 300 }}
        />
        <label className="small">
          <input
            type="checkbox"
            checked={staged}
            onChange={(event) => setStaged(event.target.checked)}
            style={{ marginRight: 6 }}
          />
          staged
        </label>
        <button onClick={() => void loadDiff()}>Load diff</button>
        {overlayTier !== null ? <span className="badge">effectiveTier {overlayTier}</span> : null}
      </div>

      {message ? <div style={{ marginTop: 10 }} className="small">{message}</div> : null}

      <div className="grid-2" style={{ marginTop: 14 }}>
        <div className="panel" style={{ padding: 12 }}>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            Files ({files.length})
          </div>
          <div className="scroll" style={{ maxHeight: 380 }}>
            {files.map((file) => (
              <button
                key={file.file}
                style={{
                  display: "block",
                  textAlign: "left",
                  width: "100%",
                  marginBottom: 6,
                  background: selectedFile === file.file ? "rgba(57, 196, 255, 0.2)" : "rgba(57, 196, 255, 0.08)"
                }}
                onClick={() => setSelectedFile(file.file)}
              >
                {file.file}
              </button>
            ))}
          </div>
        </div>

        <div className="panel" style={{ padding: 12 }}>
          <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
            Unified diff
          </div>
          <pre className="code" style={{ minHeight: 380 }}>{selectedDiff || "No diff loaded"}</pre>
        </div>
      </div>

      <div className="panel" style={{ marginTop: 14, padding: 12 }}>
        <div className="small" style={{ color: "var(--muted)", marginBottom: 8 }}>
          Apply patch (gated)
        </div>
        <textarea
          placeholder="Paste patch for repo.applyPatch"
          value={patch}
          onChange={(event) => setPatch(event.target.value)}
          style={{ width: "100%", minHeight: 160 }}
        />
        <button style={{ marginTop: 10 }} onClick={() => void applyPatch()}>
          Apply Patch
        </button>
      </div>
    </section>
  );
}
