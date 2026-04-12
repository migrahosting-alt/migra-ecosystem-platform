"use client";

import { useEditor, useEditorDispatch } from "@/components/builder/editor-state";
import Link from "next/link";
import { VIEWPORT_WIDTHS, type Viewport } from "@/lib/builder/types";

const viewports: { key: Viewport; label: string; icon: string }[] = [
  { key: "desktop", label: "Desktop", icon: "🖥" },
  { key: "tablet", label: "Tablet", icon: "📱" },
  { key: "mobile", label: "Mobile", icon: "📲" },
];

export function EditorToolbar() {
  const { site, viewport, unsavedChanges, saving, publishing } = useEditor();
  const dispatch = useEditorDispatch();

  if (!site) return null;

  async function handleSave() {
    if (!site) return;
    dispatch({ type: "SET_SAVING", saving: true });

    try {
      // Save each page's sections
      for (const page of site.pages) {
        for (const section of page.sections) {
          await fetch(`/api/builder/sections/${section.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ propsJson: section.propsJson, isVisible: section.isVisible }),
          });
        }
      }
      dispatch({ type: "MARK_SAVED" });
    } catch {
      dispatch({ type: "SET_SAVING", saving: false });
    }
  }

  async function handlePublish() {
    if (!site) return;
    dispatch({ type: "SET_PUBLISHING", publishing: true });

    try {
      // Save first
      await handleSave();

      const res = await fetch(`/api/builder/sites/${site.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error?.message ?? "Publish failed.");
      }
    } catch {
      alert("Network error during publish.");
    } finally {
      dispatch({ type: "SET_PUBLISHING", publishing: false });
    }
  }

  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] bg-white px-4 py-2">
      {/* Left: site name + back link */}
      <div className="flex items-center gap-3">
        <Link
          href="/app/builder/sites"
          className="text-sm text-[var(--ink-muted)] hover:text-[var(--ink)] transition-colors"
        >
          ← Sites
        </Link>
        <span className="text-[var(--line)]">|</span>
        <span className="font-semibold text-[var(--ink)] text-sm">{site.name}</span>
        {unsavedChanges && (
          <span className="text-xs text-amber-600 font-medium">unsaved</span>
        )}
      </div>

      {/* Center: viewport toggle */}
      <div className="flex items-center gap-1 bg-[var(--surface)] rounded-lg p-0.5">
        {viewports.map((v) => (
          <button
            key={v.key}
            onClick={() => dispatch({ type: "SET_VIEWPORT", viewport: v.key })}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              viewport === v.key
                ? "bg-white text-[var(--ink)] shadow-sm"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
            title={`${v.label} (${VIEWPORT_WIDTHS[v.key]}px)`}
          >
            {v.icon} {v.label}
          </button>
        ))}
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-2">
        <Link
          href={`/app/builder/sites/${site.id}/deployments`}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface)] transition-colors"
        >
          Deployments
        </Link>
        <button
          onClick={handleSave}
          disabled={saving || !unsavedChanges}
          className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-medium text-[var(--ink)] hover:bg-[var(--surface)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={handlePublish}
          disabled={publishing}
          className="rounded-lg bg-[var(--brand-600)] px-4 py-1.5 text-xs font-medium text-white hover:bg-[var(--brand-700)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
      </div>
    </div>
  );
}
