"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EditorProvider, useEditorDispatch, useEditor } from "@/components/builder/editor-state";
import { EditorSidebar } from "@/components/builder/editor-sidebar";
import { EditorCanvas } from "@/components/builder/editor-canvas";
import { EditorPropsPanel } from "@/components/builder/editor-props-panel";
import { EditorToolbar } from "@/components/builder/editor-toolbar";

function EditorShell() {
  const dispatch = useEditorDispatch();
  const { site } = useEditor();
  const params = useParams<{ siteId: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/builder/sites/${params.siteId}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error?.message ?? "Failed to load site.");
          return;
        }
        dispatch({ type: "SET_SITE", site: data.site });
      } catch {
        setError("Network error loading site.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.siteId, dispatch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-[var(--ink-muted)]">Loading editor…</p>
      </div>
    );
  }

  if (error || !site) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <p className="text-red-600">{error ?? "Site not found."}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <EditorToolbar />
      <div className="flex flex-1 overflow-hidden">
        <EditorSidebar />
        <EditorCanvas />
        <EditorPropsPanel />
      </div>
    </div>
  );
}

export default function EditorPage() {
  return (
    <EditorProvider>
      <EditorShell />
    </EditorProvider>
  );
}
