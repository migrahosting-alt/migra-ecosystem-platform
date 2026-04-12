"use client";

import { useEditor, useEditorDispatch, useSelectedSection } from "@/components/builder/editor-state";
import { type SectionType } from "@/lib/builder/types";
import { useState, useEffect } from "react";

/**
 * Right sidebar: edit props for the selected section.
 * Renders a JSON-based property editor. Each section type will get a
 * tailored form in a future iteration; for now, structured key-value
 * editing keeps the scope tight.
 */
export function EditorPropsPanel() {
  const { selectedSectionId } = useEditor();
  const selectedSection = useSelectedSection();
  const dispatch = useEditorDispatch();

  if (!selectedSection) {
    return (
      <aside className="w-72 border-l border-[var(--line)] bg-[var(--surface-3)] flex-shrink-0 p-4">
        <p className="text-sm text-[var(--ink-muted)]">Select a section to edit its properties.</p>
      </aside>
    );
  }

  return (
    <aside className="w-72 border-l border-[var(--line)] bg-[var(--surface-3)] flex-shrink-0 overflow-y-auto">
      <div className="p-3 border-b border-[var(--line)]">
        <h3 className="text-xs font-semibold text-[var(--ink-muted)] uppercase tracking-wide">
          {selectedSection.sectionType} Properties
        </h3>
      </div>
      <div className="p-3">
        <PropEditor
          key={selectedSection.id}
          sectionId={selectedSection.id}
          sectionType={selectedSection.sectionType as SectionType}
          propsJson={selectedSection.propsJson}
          onChange={(newProps) => {
            dispatch({
              type: "UPDATE_SECTION_PROPS",
              sectionId: selectedSection.id,
              propsJson: newProps,
            });
          }}
        />
      </div>
    </aside>
  );
}

interface PropEditorProps {
  sectionId: string;
  sectionType: SectionType;
  propsJson: Record<string, unknown>;
  onChange: (props: Record<string, unknown>) => void;
}

function PropEditor({ sectionType, propsJson, onChange }: PropEditorProps) {
  // For Phase 1, render editable fields for common string/number props.
  // Complex nested objects (items arrays) are handled via JSON textarea.
  const [jsonMode, setJsonMode] = useState(false);
  const [rawJson, setRawJson] = useState(JSON.stringify(propsJson, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  // Reset raw JSON when the section changes
  useEffect(() => {
    setRawJson(JSON.stringify(propsJson, null, 2));
    setJsonError(null);
  }, [propsJson]);

  function handleJsonApply() {
    try {
      const parsed = JSON.parse(rawJson);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setJsonError("Must be a JSON object.");
        return;
      }
      setJsonError(null);
      onChange(parsed);
    } catch {
      setJsonError("Invalid JSON.");
    }
  }

  // Simple field editor for top-level string properties
  const stringFields = Object.entries(propsJson).filter(
    ([, v]) => typeof v === "string",
  ) as [string, string][];

  return (
    <div className="space-y-4">
      {/* Quick-edit string fields */}
      {!jsonMode && stringFields.length > 0 && (
        <div className="space-y-3">
          {stringFields.map(([key, value]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-[var(--ink-muted)] mb-1 capitalize">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </label>
              <input
                type="text"
                value={value}
                onChange={(e) => onChange({ ...propsJson, [key]: e.target.value })}
                className="w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-1.5 text-sm text-[var(--ink)] focus:border-[var(--brand-500)] outline-none"
              />
            </div>
          ))}
        </div>
      )}

      {/* Toggle JSON mode */}
      <button
        onClick={() => setJsonMode(!jsonMode)}
        className="text-xs text-[var(--brand-600)] hover:text-[var(--brand-700)] font-medium"
      >
        {jsonMode ? "← Simple View" : "Advanced JSON →"}
      </button>

      {/* JSON editor */}
      {jsonMode && (
        <div>
          <textarea
            value={rawJson}
            onChange={(e) => setRawJson(e.target.value)}
            rows={15}
            spellCheck={false}
            className="w-full rounded-md border border-[var(--line)] bg-white px-2.5 py-2 text-xs font-mono text-[var(--ink)] focus:border-[var(--brand-500)] outline-none resize-y"
          />
          {jsonError && (
            <p className="text-xs text-red-600 mt-1">{jsonError}</p>
          )}
          <button
            onClick={handleJsonApply}
            className="mt-2 rounded-md bg-[var(--brand-600)] px-3 py-1 text-xs font-medium text-white hover:bg-[var(--brand-700)] transition-colors"
          >
            Apply
          </button>
        </div>
      )}
    </div>
  );
}
