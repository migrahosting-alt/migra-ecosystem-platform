"use client";

import { useState, useCallback } from "react";
import { pilotApiUrl } from "../lib/shared/pilot-api";

function getAuthHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const t = localStorage.getItem("token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children?: TreeNode[];
  loaded?: boolean;
}

async function fetchDir(dirPath: string): Promise<TreeNode[]> {
  const res = await fetch(pilotApiUrl("/api/pilot/chat/stream"), {
    method: "POST",
    headers: { "content-type": "application/json", ...getAuthHeader() },
    body: JSON.stringify({
      message: `Run repo.listDir for the path "${dirPath}" and return only the raw JSON result with no commentary.`,
      dryRun: false,
    }),
  });

  // Parse SSE to extract tool result
  const text = await res.text();
  const entries: TreeNode[] = [];

  // Try to extract file listing from response
  const lines = text.split("\n");
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    try {
      const data = JSON.parse(line.slice(5).trim());
      if (data?.result?.entries) {
        for (const e of data.result.entries) {
          entries.push({
            name: e.name ?? e,
            path: `${dirPath}/${e.name ?? e}`.replace(/\/+/g, "/"),
            isDir: (e.name ?? e).endsWith("/") || e.type === "directory",
          });
        }
      }
    } catch { /* skip */ }
  }

  // Fallback: try simple API approach
  if (entries.length === 0) {
    try {
      const listRes = await fetch(pilotApiUrl("/api/pilot/repo/list"), {
        method: "POST",
        headers: { "content-type": "application/json", ...getAuthHeader() },
        body: JSON.stringify({ path: dirPath }),
      });
      if (listRes.ok) {
        const body = await listRes.json();
        const items = body?.data?.entries ?? body?.data ?? body?.entries ?? [];
        for (const item of items) {
          const name = typeof item === "string" ? item : item.name;
          entries.push({
            name: name.replace(/\/$/, ""),
            path: `${dirPath}/${name}`.replace(/\/+$/, "").replace(/\/+/g, "/"),
            isDir: name.endsWith("/") || item.type === "directory",
          });
        }
      }
    } catch { /* best effort */ }
  }

  return entries.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function TreeItem({ node, onFileClick, depth = 0 }: { node: TreeNode; onFileClick: (path: string) => void; depth?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<TreeNode[]>(node.children ?? []);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!node.isDir) {
      onFileClick(node.path);
      return;
    }
    if (!expanded && children.length === 0) {
      setLoading(true);
      const items = await fetchDir(node.path);
      setChildren(items);
      setLoading(false);
    }
    setExpanded(prev => !prev);
  }, [node, expanded, children.length, onFileClick]);

  return (
    <div>
      <div
        onClick={() => void toggle()}
        style={{
          display: "flex", alignItems: "center", gap: 4,
          padding: "2px 6px 2px " + (8 + depth * 14) + "px",
          cursor: "pointer", fontSize: 12, fontFamily: "var(--mono)",
          color: node.isDir ? "var(--accent)" : "var(--text)",
          borderRadius: 3, transition: "background 0.1s",
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.04)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      >
        <span style={{ width: 14, textAlign: "center", fontSize: 10, opacity: 0.6 }}>
          {node.isDir ? (expanded ? "▾" : "▸") : "·"}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
        {loading && <span style={{ fontSize: 9, color: "var(--muted)" }}>…</span>}
      </div>
      {expanded && children.map(child => (
        <TreeItem key={child.path} node={child} onFileClick={onFileClick} depth={depth + 1} />
      ))}
    </div>
  );
}

interface FileTreePanelProps {
  onFileClick: (filePath: string) => void;
  rootPath?: string;
}

export function FileTreePanel({ onFileClick, rootPath = "." }: FileTreePanelProps) {
  const [roots, setRoots] = useState<TreeNode[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    const items = await fetchDir(rootPath);
    setRoots(items);
    setLoaded(true);
    setLoading(false);
  }, [rootPath]);

  return (
    <section className="panel" style={{ display: "flex", flexDirection: "column", maxHeight: 500 }}>
      <div className="panel-header">
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
          <h2 style={{ margin: 0, fontSize: 13 }}>Files</h2>
        </div>
        <button className="btn-ghost btn-sm" onClick={() => void loadRoot()} style={{ fontSize: 11 }}>
          {loading ? "…" : "↻"}
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {!loaded ? (
          <div
            onClick={() => void loadRoot()}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              height: 80, cursor: "pointer", color: "var(--fg-dim)", fontSize: 12,
            }}
          >
            {loading ? "Loading…" : "Click to load workspace files"}
          </div>
        ) : roots.length === 0 ? (
          <div style={{ padding: 12, color: "var(--fg-dim)", fontSize: 12, textAlign: "center" }}>
            No files found
          </div>
        ) : (
          roots.map(node => (
            <TreeItem key={node.path} node={node} onFileClick={onFileClick} />
          ))
        )}
      </div>
    </section>
  );
}
