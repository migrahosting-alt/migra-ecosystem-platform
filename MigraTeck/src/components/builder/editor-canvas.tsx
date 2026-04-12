"use client";

import { useEditor, useSelectedPage } from "@/components/builder/editor-state";
import { RenderPage } from "@/components/builder/SectionRenderer";
import { VIEWPORT_WIDTHS } from "@/lib/builder/types";

export function EditorCanvas() {
  const { viewport, site } = useEditor();
  const selectedPage = useSelectedPage();

  if (!site || !selectedPage) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[var(--surface)]">
        <p className="text-[var(--ink-muted)]">Select a page to preview.</p>
      </div>
    );
  }

  const width = VIEWPORT_WIDTHS[viewport];

  return (
    <div className="flex-1 overflow-auto bg-[var(--surface)] p-6">
      <div
        className="mx-auto bg-white shadow-lg rounded-lg overflow-hidden transition-all duration-300"
        style={{ maxWidth: `${width}px`, minHeight: "600px" }}
      >
        <RenderPage
          sections={selectedPage.sections.map((s) => ({
            id: s.id,
            sectionType: s.sectionType,
            propsJson: s.propsJson,
            sortOrder: s.sortOrder,
            isVisible: s.isVisible,
          }))}
        />
      </div>
    </div>
  );
}
